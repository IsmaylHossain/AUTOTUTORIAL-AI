import { chromium, Browser, BrowserContext, Page } from "playwright";
import type { Video } from "playwright";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { ffmpegPath, waitForMediaDuration } from "./media";
import { dir, get, remove, save, settings } from "./store";
type PageTrack = { page: Page; video: Video | null; videoStartedAt: number };
type WindowSegment = { page: Page; startAt: number; endAt?: number };
type Session = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  started: number;
  videoStartedAt: number;
  ready: boolean;
  activating: boolean;
  mainNavigationResponded: boolean;
  paused: boolean;
  pausedAt: number;
  pausedMs: number;
  screenshotChain: Promise<void>;
  captureSeq: number;
  pendingCaptures: Map<
    string,
    { path: string; promise: Promise<void>; activeMs: number }
  >;
  pageTracks: Map<Page, PageTrack>;
  windowSegments: WindowSegment[];
  activePage: Page;
  stopping: boolean;
};
const globalKey = "__autotutorialRecorderSessions";
const sessions: Map<string, Session> =
  (globalThis as any)[globalKey] ?? new Map<string, Session>();
(globalThis as any)[globalKey] = sessions;
function actionsPath(id: string) {
  return path.join(dir(id), "actions.json");
}
function countActions(id: string) {
  const p = actionsPath(id);
  return fs.existsSync(p)
    ? fs.readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean).length
    : 0;
}
function redactSecrets(value: any) {
  if (typeof value !== "string") return value;
  const patterns = [
    /AIza[0-9A-Za-z_-]{20,}/g,
    /AQ\.[0-9A-Za-z._-]{10,}/g,
    /sk-[A-Za-z0-9_-]{20,}/g,
    /ghp_[A-Za-z0-9]{20,}/g,
    /xox[baprs]-[A-Za-z0-9-]{20,}/g,
    /Bearer\s+[A-Za-z0-9._-]{16,}/gi,
    /password\s*[:=]\s*\S+/gi,
  ];
  let out = value;
  for (const re of patterns) out = out.replace(re, "[REDACTED]");
  return out;
}
async function activateAfterLoad(id: string, session: Session) {
  if (session.ready || session.activating || session.page.isClosed()) return;
  session.activating = true;
  try {
    await session.page
      .waitForLoadState("domcontentloaded", { timeout: 8000 })
      .catch(() => {});
    await session.page
      .evaluate(async () => {
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        if (document.fonts?.ready)
          await Promise.race([
            document.fonts.ready,
            new Promise((resolve) => setTimeout(resolve, 600)),
          ]);
      })
      .catch(() => {});
    if (session.page.isClosed()) return;
    session.started = Date.now();
    session.ready = true;
    markActivePage(session, session.activePage, session.started);
    const tutorial = get(id);
    if (tutorial) {
      tutorial.recordingStartedAt = session.started;
      tutorial.videoStartOffsetMs = Math.max(
        0,
        session.started - session.videoStartedAt,
      );
      tutorial.pauseIntervals = [];
      tutorial.status = "recording";
      tutorial.stage = "recording";
      tutorial.progress = 0;
      tutorial.message = "Website loaded. Recording started.";
      save(tutorial);
    }
    await session.page
      .evaluate(() => {
        (window as any).__autotutorialBeginCapture?.();
      })
      .catch(() => {});
  } finally {
    session.activating = false;
  }
}
async function safeScreenshot(page: Page, target: string) {
  if (page.isClosed()) return;
  try {
    await page
      .evaluate(() => {
        document
          .querySelectorAll(
            'input[type=password],input[autocomplete*=\"current-password\"],input[autocomplete*=\"cc-number\"],input[autocomplete*=\"cc-csc\"],textarea',
          )
          .forEach((el: any) => {
            if ((el.type || "").toLowerCase() === "email") return;
            if (
              /password|passcode|token|secret|api[_ -]?key|credit.?card|cvv|ssn|authorization/i.test(
                `${el.name || ""} ${el.id || ""} ${el.getAttribute?.("autocomplete") || ""} ${el.getAttribute?.("aria-label") || ""}`,
              ) ||
              el.type === "password"
            ) {
              el.dataset.autotutorialMask = el.style.filter;
              el.style.filter = "blur(12px)";
            }
          });
      })
      .catch(() => {});
    await page.screenshot({
      path: target,
      fullPage: false,
      animations: "disabled",
    });
    await page
      .evaluate(() =>
        document
          .querySelectorAll("[data-autotutorial-mask]")
          .forEach((el: any) => {
            el.style.filter = el.dataset.autotutorialMask || "";
            delete el.dataset.autotutorialMask;
          }),
      )
      .catch(() => {});
  } catch {}
}
function screenshotName(n: number) {
  return `screen-${String(n).padStart(3, "0")}.png`;
}
function pendingScreenshotName(token: string) {
  const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return `.pending-${safeToken || "capture"}.png`;
}
function queueScreenshot(s: Session, page: Page, target: string) {
  s.screenshotChain = s.screenshotChain.then(() =>
    safeScreenshot(page, target),
  );
}
function elapsed(s: Session) {
  return Math.max(
    0,
    Math.floor(
      (Date.now() -
        s.started -
        s.pausedMs -
        (s.paused ? Date.now() - s.pausedAt : 0)) /
        1000,
    ),
  );
}
function activeMs(s: Session) {
  return Math.max(
    0,
    Date.now() -
      s.started -
      s.pausedMs -
      (s.paused ? Date.now() - s.pausedAt : 0),
  );
}

function activeMsAt(s: Session, timestamp: number) {
  if (!Number.isFinite(timestamp)) return activeMs(s);
  return Math.max(
    0,
    Math.min(activeMs(s), timestamp - s.started - s.pausedMs),
  );
}

function markActivePage(session: Session, page: Page, timestamp = Date.now()) {
  if (page.isClosed()) return;
  session.activePage = page;
  if (!session.ready) return;
  const startAt = Math.max(session.started, timestamp);
  const current = session.windowSegments.at(-1);
  if (current?.page === page && !current.endAt) return;
  if (current && !current.endAt) current.endAt = Math.max(current.startAt, startAt);
  session.windowSegments.push({ page, startAt });
}

function retainPageVideo(session: Session, page: Page, videoStartedAt = Date.now()) {
  const existing = session.pageTracks.get(page);
  let video: Video | null = null;
  try {
    video = page.video();
  } catch {}
  if (existing) {
    if (video) existing.video = video;
    return existing;
  }
  const track = { page, video, videoStartedAt };
  session.pageTracks.set(page, track);
  return track;
}

function runFfmpeg(args: string[]) {
  const binary = ffmpegPath();
  if (!binary) throw new Error("FFmpeg is required to combine window recordings.");
  return new Promise<void>((resolve, reject) => {
    const process = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    process.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-16000);
    });
    process.on("error", reject);
    process.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(stderr || `FFmpeg exited with ${code}`)),
    );
  });
}

async function combineWindowVideos(id: string, session: Session, stoppedAt: number) {
  const finalSegment = session.windowSegments.at(-1);
  if (finalSegment && !finalSegment.endAt)
    finalSegment.endAt = Math.max(finalSegment.startAt, stoppedAt);
  const videoByPage = new Map<Page, string>();
  for (const track of session.pageTracks.values()) {
    try {
      const video = track.video;
      if (!video) continue;
      const file = await video.path();
      if (file && fs.existsSync(file)) {
        await waitForMediaDuration(file, 15000, 1024);
        videoByPage.set(track.page, file);
      }
    } catch {}
  }
  const usedFiles = new Set(videoByPage.values());
  const unclaimedFiles = fs
    .readdirSync(dir(id))
    .filter((name) => name.endsWith(".webm"))
    .map((name) => {
      const file = path.join(dir(id), name);
      return { file, createdAt: fs.statSync(file).birthtimeMs };
    })
    .filter(({ file }) => !usedFiles.has(file));
  for (const track of session.pageTracks.values()) {
    if (videoByPage.has(track.page) || !unclaimedFiles.length) continue;
    unclaimedFiles.sort(
      (left, right) =>
        Math.abs(left.createdAt - track.videoStartedAt) -
        Math.abs(right.createdAt - track.videoStartedAt),
    );
    const [{ file }] = unclaimedFiles.splice(0, 1);
    await waitForMediaDuration(file, 15000, 1024);
    videoByPage.set(track.page, file);
  }
  const segments = session.windowSegments
    .map((segment) => {
      const track = session.pageTracks.get(segment.page);
      const file = videoByPage.get(segment.page);
      const endAt = segment.endAt || stoppedAt;
      if (!track || !file || endAt - segment.startAt < 50) return null;
      return {
        file,
        start: Math.max(0, (segment.startAt - track.videoStartedAt) / 1000),
        end: Math.max(0, (endAt - track.videoStartedAt) / 1000),
      };
    })
    .filter((segment): segment is { file: string; start: number; end: number } =>
      !!segment && segment.end > segment.start,
    );
  if (!segments.length) return latestVideo(id);
  if (videoByPage.size <= 1) return segments[0].file;
  const output = path.join(dir(id), "recording-windows.mp4");
  const args = ["-y"];
  for (const segment of segments) args.push("-i", segment.file);
  const graph = segments.map(
    (segment, index) =>
      `[${index}:v]trim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},setpts=PTS-STARTPTS,scale=1440:820:force_original_aspect_ratio=decrease,pad=1440:820:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v${index}]`,
  );
  graph.push(
    `${segments.map((_, index) => `[v${index}]`).join("")}concat=n=${segments.length}:v=1:a=0[vout]`,
  );
  args.push(
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[vout]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-r",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output,
  );
  await runFfmpeg(args);
  return output;
}
export async function startRecording(id: string, url: string) {
  const d = dir(id);
  // Remove profiles created by older versions. Each recording now uses a new
  // non-persistent context, so cookies and other site data die with the session.
  fs.rmSync(path.join(d, "browser-profile"), { recursive: true, force: true });
  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"],
  });
  let context: BrowserContext;
  try {
    context = await browser.newContext({
      viewport: null,
      recordVideo: { dir: d, size: { width: 1440, height: 820 } },
    });
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
  const cursorOverlay = path.resolve(process.cwd(), "lib/cursor-overlay.js");
  if (fs.existsSync(cursorOverlay))
    await context.addInitScript({ path: cursorOverlay });
  const inject = path.resolve(process.cwd(), "lib/recorder-inject.js");
  if (fs.existsSync(inject)) await context.addInitScript({ path: inject });
  const page = await context.newPage();
  const session: Session = {
    browser,
    context,
    page,
    started: 0,
    videoStartedAt: Date.now(),
    ready: false,
    activating: false,
    mainNavigationResponded: false,
    paused: false,
    pausedAt: 0,
    pausedMs: 0,
    screenshotChain: Promise.resolve(),
    captureSeq: countActions(id),
    pendingCaptures: new Map(),
    pageTracks: new Map(),
    windowSegments: [],
    activePage: page,
    stopping: false,
  };
  retainPageVideo(session, page, session.videoStartedAt);
  sessions.set(id, session);
  const t = get(id);
  if (t) {
    t.status = "recording";
    t.stage = "loading";
    t.progress = 0;
    t.message = "Loading website before recording…";
    save(t);
  }
  const attachedPages = new WeakSet<Page>();
  const attachPage = (targetPage: Page) => {
    if (attachedPages.has(targetPage)) return;
    attachedPages.add(targetPage);
    targetPage.on("console", async (msg) => {
      const text = msg.text();
      const isCapture = text.startsWith("AUTOTUTORIAL_CAPTURE:");
      const isAction = text.startsWith("AUTOTUTORIAL_ACTION:");
      const isWindow = text.startsWith("AUTOTUTORIAL_WINDOW:");
      if (!isCapture && !isAction && !isWindow) return;
      try {
        const current = sessions.get(id);
        if (!current) return;
        if (isWindow) {
          const event = JSON.parse(text.slice("AUTOTUTORIAL_WINDOW:".length));
          if (event.state === "focus")
            markActivePage(current, targetPage, Number(event.ts) || Date.now());
          return;
        }
        if (!current.ready) return;
        if (isCapture) {
          const capture = JSON.parse(
            text.slice("AUTOTUTORIAL_CAPTURE:".length),
          );
          markActivePage(current, targetPage, Number(capture.ts) || Date.now());
          const token = String(capture.token || "");
          if (!token || current.pendingCaptures.has(token)) return;
          if (current.paused) {
            await Promise.allSettled(
              targetPage.frames().map((frame) =>
                frame.evaluate((captureToken) => {
                  (window as any).__autotutorialReleaseCapture?.(captureToken);
                }, token),
              ),
            );
            return;
          }
          const capturePath = path.join(d, pendingScreenshotName(token));
          const capturePromise = safeScreenshot(targetPage, capturePath);
          current.pendingCaptures.set(token, {
            path: capturePath,
            promise: capturePromise,
            activeMs: activeMs(current),
          });
          await capturePromise;
          await Promise.allSettled(
            targetPage.frames().map((frame) =>
              frame.evaluate((captureToken) => {
                (window as any).__autotutorialReleaseCapture?.(captureToken);
              }, token),
            ),
          );
          return;
        }
        if (current.paused) return;
        const action = JSON.parse(text.slice("AUTOTUTORIAL_ACTION:".length));
        markActivePage(current, targetPage, Number(action.ts) || Date.now());
        if (["input", "select", "change"].includes(action.type))
          action.value = undefined;
        action.text = redactSecrets(action.text);
        action.fieldLabel = redactSecrets(action.fieldLabel);
        action.activeMs = activeMsAt(current, Number(action.interactionTs));
        delete action.interactionTs;
        const captureToken = String(action.captureToken || "");
        const pendingCapture = captureToken
          ? current.pendingCaptures.get(captureToken)
          : undefined;
        delete action.captureToken;
        if (
          pendingCapture &&
          ["click", "select", "change"].includes(action.type)
        ) {
          const n = ++current.captureSeq;
          await pendingCapture.promise;
          const destination = path.join(
            d,
            "screenshots",
            screenshotName(n),
          );
          if (fs.existsSync(pendingCapture.path))
            fs.renameSync(pendingCapture.path, destination);
          else await safeScreenshot(targetPage, destination);
          action.screenshotMs = pendingCapture.activeMs;
          action.screenshot = screenshotName(n);
          current.pendingCaptures.delete(captureToken);
        } else if (action.type === "click") {
          const n = ++current.captureSeq;
          current.screenshotChain = current.screenshotChain.then(() =>
            safeScreenshot(
              targetPage,
              path.join(d, "screenshots", screenshotName(n)),
            ),
          );
          await current.screenshotChain;
          action.screenshotMs = activeMs(current);
          action.screenshot = screenshotName(n);
        } else if (["input", "select", "change"].includes(action.type)) {
          const n = ++current.captureSeq;
          queueScreenshot(
            current,
            targetPage,
            path.join(d, "screenshots", screenshotName(n)),
          );
          action.screenshot = screenshotName(n);
        }
        const p = actionsPath(id);
        fs.appendFileSync(p, JSON.stringify(action) + "\n");
        if (action.type === "move") return;
        const tt = get(id);
        if (tt) {
          tt.status = "recording";
          tt.stage = "recording";
          tt.message = `${countActions(id)} actions captured`;
          save(tt);
        }
      } catch {}
    });
    targetPage.on("load", () => {
      const current = sessions.get(id);
      if (!current) return;
      retainPageVideo(current, targetPage);
      if (
        !current.ready &&
        current.mainNavigationResponded &&
        targetPage === current.page
      ) {
        void activateAfterLoad(id, current);
        return;
      }
      if (current.ready)
        targetPage
          .evaluate((paused) => {
            (window as any).__autotutorialStart?.();
            (window as any).__autotutorialSetPaused?.(paused);
          }, current.paused)
          .catch(() => {});
    });
    targetPage.on("close", () => {
      const current = sessions.get(id);
      if (!current) return;
      retainPageVideo(current, targetPage);
      if (current.stopping || current.activePage !== targetPage) return;
      const fallback = current.context
        .pages()
        .filter((candidate) => !candidate.isClosed() && candidate !== targetPage)
        .at(-1);
      if (fallback) markActivePage(current, fallback);
    });
    targetPage.on("popup", (popup) => {
      const current = session;
      retainPageVideo(current, popup);
      markActivePage(current, popup);
      attachPage(popup);
      popup
        .evaluate((paused) => {
          (window as any).__autotutorialStart?.();
          (window as any).__autotutorialSetPaused?.(paused);
        }, current.paused)
        .catch(() => {});
    });
  };
  attachPage(page);
  context.on("page", (p) => {
    const current = session;
    retainPageVideo(current, p);
    markActivePage(current, p);
    attachPage(p);
    p.evaluate((paused) => {
      (window as any).__autotutorialStart?.();
      (window as any).__autotutorialSetPaused?.(paused);
    }, !!current?.paused).catch(() => {});
  });
  context.on("close", () => {
    const current = sessions.get(id);
    if (current) {
      if (current.stopping) {
        sessions.delete(id);
        return;
      }
      if (current.paused) {
        const tt = get(id);
        if (tt) {
          const arr = tt.pauseIntervals || [];
          const last = arr[arr.length - 1];
          if (last && !last.endMs) last.endMs = Date.now() - current.started;
          tt.pauseIntervals = arr;
          save(tt);
        }
      }
      sessions.delete(id);
      const tt = get(id);
      if (tt && tt.status === "recording") {
        tt.stage = "interrupted";
        tt.status = "interrupted";
        tt.message =
          "The browser session ended. Captured actions are still saved; recovery is available.";
        save(tt);
      }
    }
  });
  page.on("response", (response) => {
    try {
      if (
        response.request().isNavigationRequest() &&
        response.request().frame() === page.mainFrame()
      ) {
        session.mainNavigationResponded = true;
        if (page.isClosed()) return;
        void page
          .waitForLoadState("domcontentloaded", { timeout: 30000 })
          .then(() => activateAfterLoad(id, session))
          .catch(() => {});
      }
    } catch {}
  });
  void page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    .then(() => activateAfterLoad(id, session))
    .catch((e: any) => {
      const tutorial = get(id);
      if (tutorial && sessions.has(id)) {
        tutorial.stage = "loading";
        tutorial.message = `Browser opened, but the website did not finish loading: ${e?.message || "navigation failed"}. Capture will begin if the page loads.`;
        save(tutorial);
      }
    });
  return { started: true };
}
export function status(id: string) {
  const s = sessions.get(id),
    t = get(id),
    connected = !!s && s.context.pages().some((page) => !page.isClosed());
  if (t && t.status === "recording" && !s) {
    t.status = "interrupted";
    t.stage = "interrupted";
    t.message =
      "The recording server session was interrupted. Captured files remain available for recovery.";
    save(t);
  }
  return {
    id,
    url: t?.url,
    actions: countActions(id),
    elapsed: s
      ? s.ready
        ? elapsed(s)
        : 0
      : t?.recordingStartedAt
        ? Math.max(0, Math.floor((Date.now() - t.recordingStartedAt) / 1000))
        : 0,
    paused: !!s?.paused,
    loading: !!s && !s.ready,
    connected,
    interrupted: t?.status === "interrupted",
    hasRecording:
      !!t?.recording ||
      fs.readdirSync(dir(id)).some((x) => x.endsWith(".webm")),
  };
}
function latestVideo(id: string) {
  const d = dir(id);
  const vids = fs
    .readdirSync(d)
    .filter((x) => x.endsWith(".webm"))
    .map((x) => ({ x, mtime: fs.statSync(path.join(d, x)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return vids[0] ? path.join(d, vids[0].x) : undefined;
}
export async function stopRecording(id: string) {
  const s = sessions.get(id);
  if (!s) {
    const t = get(id),
      video =
        t?.recording && fs.existsSync(t.recording)
          ? t.recording
          : latestVideo(id);
    if (video) {
      if (t) {
        t.status = "processing";
        t.stage = "recorded";
        t.progress = 5;
        t.recording = video;
        save(t);
      }
      return video;
    }
    throw new Error("Recording session not found");
  }
  if (s.paused) {
    const t = get(id);
    if (t) {
      const arr = t.pauseIntervals || [];
      const last = arr[arr.length - 1];
      if (last && !last.endMs) last.endMs = Date.now() - s.started;
      t.pauseIntervals = arr;
      save(t);
    }
  }
  s.stopping = true;
  const stoppedAt = Date.now();
  const lastSegment = s.windowSegments.at(-1);
  if (lastSegment && !lastSegment.endAt)
    lastSegment.endAt = Math.max(lastSegment.startAt, stoppedAt);
  try {
    await s.screenshotChain;
  } catch {}
  for (const capture of s.pendingCaptures.values()) {
    try {
      if (fs.existsSync(capture.path)) fs.unlinkSync(capture.path);
    } catch {}
  }
  s.pendingCaptures.clear();
  const finalPage = !s.activePage.isClosed()
    ? s.activePage
    : s.context.pages().filter((page) => !page.isClosed()).at(-1);
  if (finalPage)
    await safeScreenshot(
      finalPage,
      path.join(dir(id), "screenshots", screenshotName(++s.captureSeq)),
    );
  try {
    await s.context.close();
  } catch {}
  try {
    await s.browser.close();
  } catch {}
  sessions.delete(id);
  const video = await combineWindowVideos(id, s, stoppedAt);
  if (!video)
    throw new Error("Browser stopped but no recording video was produced.");
  const finalDuration = await waitForMediaDuration(video, 15000, 1024);
  const t = get(id);
  if (t) {
    if (path.basename(video) === "recording-windows.mp4")
      t.videoStartOffsetMs = 0;
    t.status = "processing";
    t.stage = "recorded";
    t.progress = 5;
    t.recording = video;
    t.message =
      finalDuration > 0
        ? "Recording saved and ready for analysis."
        : "Recording saved. The browser video is still finalizing; the render step will retry when it is ready.";
    save(t);
  }
  return video;
}
export async function cancelRecording(id: string) {
  const s = sessions.get(id);
  if (s) {
    const t = get(id);
    if (t) {
      t.status = "cancelling";
      t.stage = "cancelling";
      t.message = "Cancelling recording and removing captured files…";
      save(t);
    }
    // Remove the session first so the context's close handler does not mark
    // this intentionally cancelled recording as interrupted.
    sessions.delete(id);
    try {
      await s.context.close();
    } catch {}
    try {
      await s.browser.close();
    } catch {}
  }
  return remove(id);
}
export async function pauseRecording(id: string) {
  const s = sessions.get(id);
  if (!s) throw new Error("Recording session not found");
  if (s.paused) return { paused: true };
  s.paused = true;
  s.pausedAt = Date.now();
  await Promise.allSettled(
    s.context.pages().flatMap((page) =>
      page.frames().map((frame) =>
        frame.evaluate(() => {
          (window as any).__autotutorialSetPaused?.(true);
        }),
      ),
    ),
  );
  const t = get(id);
  if (t) {
    const arr = t.pauseIntervals || [];
    arr.push({ startMs: s.pausedAt - s.started });
    t.pauseIntervals = arr;
    t.status = "recording";
    t.stage = "recording";
    t.message = "Recording paused. Browser remains fully interactive.";
    save(t);
  }
  return { paused: true };
}
export async function resumeRecording(id: string) {
  const s = sessions.get(id);
  if (!s) throw new Error("Recording session not found");
  if (!s.paused) return { paused: false };
  s.pausedMs += Date.now() - s.pausedAt;
  s.paused = false;
  s.pausedAt = 0;
  await Promise.allSettled(
    s.context.pages().flatMap((page) =>
      page.frames().map((frame) =>
        frame.evaluate(() => {
          (window as any).__autotutorialSetPaused?.(false);
        }),
      ),
    ),
  );
  const t = get(id);
  if (t) {
    const arr = t.pauseIntervals || [];
    const last = arr[arr.length - 1];
    if (last && !last.endMs) last.endMs = Date.now() - s.started;
    t.pauseIntervals = arr;
    t.message = "Recording resumed.";
    save(t);
  }
  return { paused: false };
}
export function recoverRecording(id: string) {
  const t = get(id);
  if (!t) throw new Error("Tutorial not found");
  const video =
    t.recording && fs.existsSync(t.recording) ? t.recording : latestVideo(id);
  if (!video) throw new Error("No recoverable browser recording was found.");
  t.recording = video;
  t.status = "processing";
  t.stage = "recorded";
  t.progress = 5;
  t.message = "Recovered recording. Preparing analysis…";
  save(t);
  return { ok: true, id, video };
}
