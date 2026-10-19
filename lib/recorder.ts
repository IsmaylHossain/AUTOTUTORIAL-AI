import { chromium, BrowserContext, Page } from "playwright";
import path from "path";
import fs from "fs";
import { waitForMediaDuration } from "./media";
import { dir, get, remove, save, settings } from "./store";
type Session = {
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
      .waitForLoadState("networkidle", { timeout: 8000 })
      .catch(() => {});
    await session.page
      .evaluate(async () => {
        if (document.fonts?.ready)
          await Promise.race([
            document.fonts.ready,
            new Promise((resolve) => setTimeout(resolve, 3000)),
          ]);
      })
      .catch(() => {});
    if (session.page.isClosed()) return;
    session.started = Date.now();
    session.ready = true;
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
export async function startRecording(id: string, url: string) {
  const d = dir(id);
  const context = await chromium.launchPersistentContext(
    path.join(d, "browser-profile"),
    {
      headless: false,
      viewport: null,
      recordVideo: { dir: d, size: { width: 1440, height: 820 } },
      args: ["--start-maximized"],
    },
  );
  const inject = path.resolve(process.cwd(), "lib/recorder-inject.js");
  if (fs.existsSync(inject)) await context.addInitScript({ path: inject });
  const page = context.pages()[0] || (await context.newPage());
  const session: Session = {
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
  };
  sessions.set(id, session);
  const t = get(id);
  if (t) {
    t.status = "recording";
    t.stage = "loading";
    t.progress = 0;
    t.message = "Loading website before recording…";
    save(t);
  }
  const attachPage = (targetPage: Page) => {
    targetPage.on("console", async (msg) => {
      const text = msg.text();
      const isCapture = text.startsWith("AUTOTUTORIAL_CAPTURE:");
      const isAction = text.startsWith("AUTOTUTORIAL_ACTION:");
      if (!isCapture && !isAction) return;
      try {
        const current = sessions.get(id);
        if (!current || !current.ready || current.paused) return;
        if (isCapture) {
          const capture = JSON.parse(
            text.slice("AUTOTUTORIAL_CAPTURE:".length),
          );
          const token = String(capture.token || "");
          if (!token || current.pendingCaptures.has(token)) return;
          const capturePath = path.join(d, pendingScreenshotName(token));
          const capturePromise = current.screenshotChain.then(() =>
            safeScreenshot(targetPage, capturePath),
          );
          current.screenshotChain = capturePromise;
          current.pendingCaptures.set(token, {
            path: capturePath,
            promise: capturePromise,
            activeMs: activeMs(current),
          });
          return;
        }
        const action = JSON.parse(text.slice("AUTOTUTORIAL_ACTION:".length));
        if (["input", "select", "change"].includes(action.type))
          action.value = undefined;
        action.text = redactSecrets(action.text);
        action.fieldLabel = redactSecrets(action.fieldLabel);
        action.activeMs = activeMs(current);
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
        } else if (["input", "select", "change"].includes(action.type)) {
          const n = ++current.captureSeq;
          queueScreenshot(
            current,
            targetPage,
            path.join(d, "screenshots", screenshotName(n)),
          );
        }
        const p = actionsPath(id);
        fs.appendFileSync(p, JSON.stringify(action) + "\n");
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
      if (
        !current.ready &&
        current.mainNavigationResponded &&
        targetPage === current.page
      ) {
        void activateAfterLoad(id, current);
        return;
      }
      if (current.ready && !current.paused)
        targetPage
          .evaluate(() => {
            (window as any).__autotutorialStart?.();
          })
          .catch(() => {});
    });
  };
  attachPage(page);
  context.on("page", (p) => {
    attachPage(p);
    p.evaluate(() => {
      (window as any).__autotutorialStart?.();
    }).catch(() => {});
  });
  context.on("close", () => {
    const current = sessions.get(id);
    if (current) {
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
          .waitForLoadState("load", { timeout: 60000 })
          .then(() => activateAfterLoad(id, session))
          .catch(() => {});
      }
    } catch {}
  });
  void page
    .goto(url, { waitUntil: "load", timeout: 60000 })
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
    connected = !!s && !s.page.isClosed();
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
  try {
    await s.screenshotChain;
  } catch {}
  for (const capture of s.pendingCaptures.values()) {
    try {
      if (fs.existsSync(capture.path)) fs.unlinkSync(capture.path);
    } catch {}
  }
  s.pendingCaptures.clear();
  await safeScreenshot(
    s.page,
    path.join(dir(id), "screenshots", screenshotName(++s.captureSeq)),
  );
  try {
    await s.context.close();
  } catch {}
  sessions.delete(id);
  const video = latestVideo(id);
  if (!video)
    throw new Error("Browser stopped but no recording video was produced.");
  const finalDuration = await waitForMediaDuration(video, 15000, 1024);
  const t = get(id);
  if (t) {
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
  }
  return remove(id);
}
export async function pauseRecording(id: string) {
  const s = sessions.get(id);
  if (!s) throw new Error("Recording session not found");
  if (s.paused) return { paused: true };
  s.paused = true;
  s.pausedAt = Date.now();
  const t = get(id);
  if (t) {
    const arr = t.pauseIntervals || [];
    arr.push({ startMs: s.pausedAt - s.started });
    t.pauseIntervals = arr;
    t.status = "recording";
    t.stage = "recording";
    t.message = "Recording paused. Browser interactions are ignored.";
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
