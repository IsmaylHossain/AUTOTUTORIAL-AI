import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { dir, get, save, settings } from "./store";
import { buildTimeline, INTRO_DURATION_MS } from "./timeline";
import {
  ffmpegPath as resolveFfmpeg,
  normalizeWavHeader,
  readMediaDuration,
  readMediaDimensions,
} from "./media";

const jobs = new Map<string, ChildProcess>();
export function cancelRender(id: string) {
  const p = jobs.get(id);
  if (!p) return false;
  p.kill("SIGTERM");
  jobs.delete(id);
  const t = get(id);
  if (t) {
    t.status = "review";
    t.stage = "steps";
    t.progress = 0;
    t.message = "Render cancelled. Your recording and edits are still saved.";
    save(t);
  }
  return true;
}
async function duration(file: string) {
  return readMediaDuration(file);
}
function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
async function createVideoCard(
  output: string,
  width: number,
  height: number,
  projectName: string,
  kind: "opening" | "intro" | "outro",
  templateImage?: string,
) {
  const name = escapeXml(projectName);
  const titleSize = Math.max(
    Math.round(width * 0.018),
    Math.min(
      Math.round(width * 0.043),
      Math.round((width * 0.68) / Math.max(18, (projectName.length + 12) * 0.58)),
    ),
  );
  const mainSize = Math.max(26, Math.round(width * 0.043));
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#08111f" stop-opacity="0.24"/><stop offset="0.5" stop-color="#08111f" stop-opacity="0.46"/><stop offset="1" stop-color="#08111f" stop-opacity="0.88"/></linearGradient>
      <linearGradient id="default" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111b32"/><stop offset="0.52" stop-color="#18234a"/><stop offset="1" stop-color="#0b1220"/></linearGradient>
    </defs>
    ${templateImage ? "" : '<rect width="100%" height="100%" fill="url(#default)"/><circle cx="88%" cy="14%" r="26%" fill="#6366f1" opacity="0.13"/><circle cx="12%" cy="88%" r="31%" fill="#38bdf8" opacity="0.08"/><rect width="100%" height="100%" fill="url(#shade)"/>'}
    ${kind === "opening" ? "" : kind === "outro" ? `<rect x="${Math.round(width * 0.31)}" y="${Math.round(height * 0.69)}" width="${Math.round(width * 0.38)}" height="${Math.round(height * 0.19)}" rx="${Math.max(10, Math.round(width * 0.01))}" fill="#08111f" fill-opacity="0.9" stroke="#ffffff" stroke-opacity="0.28"/><line x1="${Math.round(width * 0.425)}" y1="${Math.round(height * 0.735)}" x2="${Math.round(width * 0.575)}" y2="${Math.round(height * 0.735)}" stroke="#38bdf8" stroke-width="${Math.max(3, Math.round(width * 0.003))}" stroke-linecap="round"/><text x="${Math.round(width / 2)}" y="${Math.round(height * 0.83)}" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="${mainSize}" font-weight="700">Thank you</text>` : `<rect x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.68)}" width="${Math.round(width * 0.76)}" height="${Math.round(height * 0.2)}" rx="${Math.max(10, Math.round(width * 0.01))}" fill="#08111f" fill-opacity="0.9" stroke="#ffffff" stroke-opacity="0.28"/><line x1="${Math.round(width * 0.425)}" y1="${Math.round(height * 0.725)}" x2="${Math.round(width * 0.575)}" y2="${Math.round(height * 0.725)}" stroke="#38bdf8" stroke-width="${Math.max(3, Math.round(width * 0.003))}" stroke-linecap="round"/><text x="${Math.round(width / 2)}" y="${Math.round(height * 0.83)}" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="700">Welcome to &apos;${name}&apos; Tutorial.</text>`}
  </svg>`;
  const composition = templateImage
    ? sharp(templateImage).resize(width, height, {
        fit: "contain",
        position: "centre",
        background: { r: 11, g: 18, b: 32, alpha: 1 },
      })
    : sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 11, g: 18, b: 32, alpha: 1 },
        },
      });
  await composition
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .png()
    .toFile(output);
}
function ensureVideo(file: string) {
  if (!file || !fs.existsSync(file))
    throw new Error("The source recording file does not exist.");
  if (fs.statSync(file).size < 1024)
    throw new Error(
      "The source recording is empty or incomplete. Please record again.",
    );
  ensureTools();
}
function ensureTools() {
  const p = resolveFfmpeg();
  if (!p) {
    const cwd = process.cwd();
    throw new Error(
      `FFmpeg is not available to the running Next.js server. Expected ${path.join(cwd, "node_modules", "ffmpeg-static", "ffmpeg")}. Run npm run setup:media in this exact project, then stop and restart npm run dev.`,
    );
  }
  return p;
}
async function runFfmpeg(
  id: string,
  args: string[],
  sourceDur: number,
  label: string,
  out: string,
  startPct: number,
  endPct: number,
) {
  const ffmpegPath = ensureTools();
  return await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    jobs.set(id, proc);
    let err = "";
    let buf = "";
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("out_time_ms=")) {
          const us = Number(line.split("=")[1]);
          if (Number.isFinite(us) && sourceDur > 0) {
            const pct = Math.round(
              startPct +
                (endPct - startPct) *
                  Math.min(1, Math.max(0, us / 1000000 / sourceDur)),
            );
            const t = get(id);
            if (t) {
              t.progress = Math.min(99, Math.max(1, pct));
              t.stage = "rendering";
              t.message = `${label} · ${t.progress}%`;
              save(t);
            }
          }
        }
      }
    });
    proc.stderr.on("data", (c) => {
      err = (err + c.toString()).slice(-24000);
    });
    proc.on("error", (e) => {
      jobs.delete(id);
      reject(new Error(`FFmpeg could not start: ${e.message}`));
    });
    proc.on("close", (code) => {
      jobs.delete(id);
      if (code === 0 && fs.existsSync(out) && fs.statSync(out).size > 1024)
        resolve();
      else reject(new Error(err || `FFmpeg exited with code ${code}`));
    });
  });
}
async function prepareSource(id: string, recording: string, rawDur: number) {
  const t = get(id)!;
  const offset = Math.min(
    rawDur,
    Math.max(0, (t.videoStartOffsetMs || 0) / 1000),
  );
  const pauses = (t.pauseIntervals || [])
    .map((p) => ({
      start: offset + Math.max(0, p.startMs / 1000),
      end: Math.min(rawDur, offset + Math.max(0, (p.endMs ?? 0) / 1000)),
    }))
    .filter((p) => p.end > p.start);
  if (!pauses.length && offset === 0) return recording;
  const ranges: { start: number; end: number }[] = [];
  let cursor = offset;
  for (const p of pauses) {
    if (p.start > cursor) ranges.push({ start: cursor, end: p.start });
    cursor = Math.max(cursor, p.end);
  }
  if (cursor < rawDur) ranges.push({ start: cursor, end: rawDur });
  if (!ranges.length)
    throw new Error(
      "The recording contains no active video after removing startup and paused intervals.",
    );
  const out = path.join(dir(id), "recording-active.mp4");
  const parts = ranges.map(
    (r, i) =>
      `[0:v]trim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`,
  );
  parts.push(
    `${ranges.map((_, i) => `[v${i}]`).join("")}concat=n=${ranges.length}:v=1:a=0[vout]`,
  );
  t.message = "Preparing the recording after the website finished loading…";
  t.progress = 3;
  save(t);
  await runFfmpeg(
    id,
    [
      "-y",
      "-i",
      recording,
      "-filter_complex",
      parts.join(";"),
      "-map",
      "[vout]",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      out,
    ],
    rawDur,
    "Preparing active recording",
    out,
    3,
    15,
  );
  return out;
}
export async function render(id: string) {
  const t = get(id);
  if (!t) throw new Error("Tutorial not found");
  if (!t.recording || !fs.existsSync(t.recording))
    throw new Error("Recording video not found.");
  ensureVideo(t.recording);
  const d = dir(id),
    out = path.join(d, "tutorial.mp4"),
    fallback = path.join(d, "tutorial-clean.mp4");
  const rawDur = await duration(t.recording);
  if (rawDur <= 0)
    throw new Error(
      "The browser recording is still finalizing or is incomplete. Please wait a moment and try the render again.",
    );
  t.stage = "rendering";
  t.status = "rendering";
  t.message = "Starting final video render…";
  t.progress = 1;
  t.video = undefined;
  t.videoOpeningMs = undefined;
  save(t);
  const timeline = buildTimeline(id);
  const source = await prepareSource(id, t.recording, rawDur);
  const sourceDur = await duration(source);
  if (sourceDur <= 0)
    throw new Error("The active recording has no readable duration.");
  const cfg = settings();
  const quality = cfg.quality || "high";
  const crf = quality === "low" ? 24 : quality === "medium" ? 21 : 18;
  const preset = quality === "low" ? "faster" : quality === "medium" ? "fast" : "veryfast";
  const hasIntro = timeline.steps[0]?.action === "introduction";
  const introSec = hasIntro ? INTRO_DURATION_MS / 1000 : 0;
  const hasTemplate = !!(
    t.templateImage && fs.existsSync(t.templateImage)
  );
  const openingSec = hasIntro && hasTemplate ? 3 : 0;
  const outroSec = hasIntro && hasTemplate ? INTRO_DURATION_MS / 1000 : 0;
  const leadInSec = openingSec + introSec;
  const outputDur = sourceDur + leadInSec + outroSec;
  const sourceSize = readMediaDimensions(source) || {
    width: timeline.width,
    height: timeline.height,
  };
  const filters: string[] = [];
  if (hasIntro) {
    filters.push(
      `tpad=start_duration=${leadInSec}:start_mode=clone`,
    );
    if (outroSec)
      filters.push(`tpad=stop_duration=${outroSec}:stop_mode=clone`);
  } else
    filters.push(
      `drawbox=x=0:y=0:w=iw:h=70:color=black@0.58:t=fill:enable='between(t,0,2.5)'`,
    );
  const focusOverlays: Array<{
    file: string;
    x: number;
    y: number;
    start: number;
    end: number;
  }> = [];
  const actionViewport = (action: any) => {
    const ownWidth = Number(action.viewportWidth);
    const ownHeight = Number(action.viewportHeight);
    if (ownWidth > 0 && ownHeight > 0)
      return { width: ownWidth, height: ownHeight };
    let nearest: any;
    let distance = Number.POSITIVE_INFINITY;
    for (const candidate of timeline.actions) {
      const width = Number(candidate.viewportWidth);
      const height = Number(candidate.viewportHeight);
      if (!(width > 0 && height > 0)) continue;
      const candidateDistance = Math.abs(
        Number(candidate.activeMs || 0) - Number(action.activeMs || 0),
      );
      if (candidateDistance < distance) {
        nearest = candidate;
        distance = candidateDistance;
      }
    }
    return nearest
      ? {
          width: Number(nearest.viewportWidth),
          height: Number(nearest.viewportHeight),
        }
      : sourceSize;
  };
  const isCalendarSelection = (action: any) =>
    action.type === "click" &&
    !action.pickerOpen &&
    /calendar|datepicker|date-picker|dp--|flatpickr|react-datepicker/i.test(
      `${action.selector || ""} ${action.controlRole || ""} ${action.controlLabel || ""}`,
    );
  const duplicateDatePickerOpen = (action: any) =>
    !!action.pickerOpen &&
    timeline.actions.some(
      (candidate) =>
        isCalendarSelection(candidate) &&
        Number(candidate.activeMs || 0) >= Number(action.activeMs || 0) &&
        Number(candidate.activeMs || 0) - Number(action.activeMs || 0) <= 15000,
    );
  const focusActions = timeline.actions.filter(
    (action) =>
      action.targetRect &&
      !duplicateDatePickerOpen(action) &&
      ["click", "input", "select", "change"].includes(action.type),
  );
  for (const [index, action] of focusActions.entries()) {
    const rect =
      action.type === "input" && action.focusRect
        ? action.focusRect
        : action.targetRect!;
    const viewport = actionViewport(action);
    const scale = Math.min(
      sourceSize.width / viewport.width,
      sourceSize.height / viewport.height,
    );
    const padding = 0;
    const borderWidth = 3;
    const rightPadding = 1;
    const bottomPadding = 2;
    const width = Math.max(
      borderWidth + 1,
      Math.ceil(rect.width * scale + padding * 2 + rightPadding),
    );
    const height = Math.max(
      borderWidth + 1,
      Math.ceil(rect.height * scale + padding * 2 + bottomPadding),
    );
    const radius = Math.min(
      6,
      Math.max(2, (height - borderWidth) / 2),
    );
    const highlightMs =
      action.type === "input"
        ? Number(action.activeMs || 0)
        : Number(action.screenshotMs ?? action.activeMs ?? 0);
    const clickAt = leadInSec + Math.max(0, highlightMs / 1000);
    const file = path.join(d, `.focus-${index}.png`);
    const halfStroke = borderWidth / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="${halfStroke}" y="${halfStroke}" width="${width - borderWidth}" height="${height - borderWidth}" rx="${radius}" ry="${radius}" fill="none" stroke="#38BDF8" stroke-width="${borderWidth}"/></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(file);
    focusOverlays.push({
      file,
      x: Math.max(0, rect.x * scale - padding),
      y: Math.max(0, rect.y * scale - padding),
      start: Math.max(0, clickAt - 0.45),
      end: clickAt + 0.05,
    });
  }
  for (const a of timeline.actions.filter((a) => a.sensitive && a.targetRect)) {
    const r = a.targetRect!,
      sec = leadInSec + Math.max(0, Number(a.activeMs || 0) / 1000),
      en = sec + 3,
      x = Math.max(0, r.x - 4),
      y = Math.max(0, r.y - 4),
      w = Math.max(10, r.width + 8),
      h = Math.max(10, r.height + 8);
    filters.push(
      `drawbox=x=${x.toFixed(1)}:y=${y.toFixed(1)}:w=${w.toFixed(1)}:h=${h.toFixed(1)}:color=black@0.96:t=fill:enable='between(t,${sec.toFixed(3)},${en.toFixed(3)})'`,
    );
  }
  const openingCard = openingSec
    ? path.join(d, ".video-opening.png")
    : undefined;
  const introCard = hasIntro ? path.join(d, ".video-intro.png") : undefined;
  const outroCard = outroSec ? path.join(d, ".video-outro.png") : undefined;
  if (openingCard)
    await createVideoCard(
      openingCard,
      sourceSize.width,
      sourceSize.height,
      t.name,
      "opening",
      t.templateImage,
    );
  if (introCard)
    await createVideoCard(
      introCard,
      sourceSize.width,
      sourceSize.height,
      t.name,
      "intro",
      hasTemplate ? t.templateImage : undefined,
    );
  if (outroCard)
    await createVideoCard(
      outroCard,
      sourceSize.width,
      sourceSize.height,
      t.name,
      "outro",
      t.templateImage,
    );

  const visualInputs = ["-y", "-i", source];
  let nextInputIndex = 1;
  let openingInputIndex: number | undefined;
  let introInputIndex: number | undefined;
  let outroInputIndex: number | undefined;
  if (openingCard) {
    openingInputIndex = nextInputIndex++;
    visualInputs.push("-loop", "1", "-framerate", String(timeline.fps), "-i", openingCard);
  }
  if (introCard) {
    introInputIndex = nextInputIndex++;
    visualInputs.push("-loop", "1", "-framerate", String(timeline.fps), "-i", introCard);
  }
  if (outroCard) {
    outroInputIndex = nextInputIndex++;
    visualInputs.push("-loop", "1", "-framerate", String(timeline.fps), "-i", outroCard);
  }
  const focusInputStart = nextInputIndex;
  for (const overlay of focusOverlays)
    visualInputs.push(
      "-loop",
      "1",
      "-framerate",
      String(timeline.fps),
      "-i",
      overlay.file,
    );
  const visualGraph = [`[0:v]${filters.join(",")}[base]`];
  let visualOutput = "[base]";
  if (openingInputIndex !== undefined) {
    visualGraph.push(
      `${visualOutput}[${openingInputIndex}:v]overlay=x=0:y=0:enable='between(t,0,${openingSec.toFixed(3)})'[coveredOpening]`,
    );
    visualOutput = "[coveredOpening]";
  }
  if (introInputIndex !== undefined) {
    visualGraph.push(
      `${visualOutput}[${introInputIndex}:v]overlay=x=0:y=0:enable='between(t,${openingSec.toFixed(3)},${leadInSec.toFixed(3)})'[coveredIntro]`,
    );
    visualOutput = "[coveredIntro]";
  }
  if (outroInputIndex !== undefined) {
    visualGraph.push(
      `${visualOutput}[${outroInputIndex}:v]overlay=x=0:y=0:enable='between(t,${(leadInSec + sourceDur).toFixed(3)},${outputDur.toFixed(3)})'[coveredOutro]`,
    );
    visualOutput = "[coveredOutro]";
  }
  focusOverlays.forEach((overlay, index) => {
    const next = `[focus${index}]`;
    visualGraph.push(
      `${visualOutput}[${focusInputStart + index}:v]overlay=x=${overlay.x.toFixed(1)}:y=${overlay.y.toFixed(1)}:enable='between(t,${overlay.start.toFixed(3)},${overlay.end.toFixed(3)})'${next}`,
    );
    visualOutput = next;
  });
  const visual = [
    ...visualInputs,
    "-filter_complex",
    visualGraph.join(";"),
    "-map",
    visualOutput,
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    String(crf),
    "-r",
    String(timeline.fps),
    "-pix_fmt",
    "yuv420p",
    "-an",
    "-t",
    outputDur.toFixed(3),
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    "-nostats",
    out,
  ];
  try {
    await runFfmpeg(
      id,
      visual,
      outputDur,
      "Rendering visual tutorial",
      out,
      15,
      78,
    );
  } catch (primary: any) {
    t.message = "Visual effects failed; creating a clean MP4 fallback…";
    save(t);
    try {
      const clean = ["-y", "-i", source];
      const cleanGraph: string[] = [];
      let cleanOutput = "[cleanBase]";
      if (hasIntro) {
        let cleanNextInput = 1;
        let cleanOpeningInput: number | undefined;
        let cleanIntroInput: number | undefined;
        let cleanOutroInput: number | undefined;
        if (openingCard) {
          cleanOpeningInput = cleanNextInput++;
          clean.push("-loop", "1", "-framerate", String(timeline.fps), "-i", openingCard);
        }
        if (introCard) {
          cleanIntroInput = cleanNextInput++;
          clean.push("-loop", "1", "-framerate", String(timeline.fps), "-i", introCard);
        }
        if (outroCard) {
          cleanOutroInput = cleanNextInput++;
          clean.push("-loop", "1", "-framerate", String(timeline.fps), "-i", outroCard);
        }
        cleanGraph.push(
          `[0:v]tpad=start_duration=${leadInSec}:start_mode=clone${outroSec ? `,tpad=stop_duration=${outroSec}:stop_mode=clone` : ""}[cleanBase]`,
        );
        if (cleanOpeningInput !== undefined) {
          cleanGraph.push(
            `${cleanOutput}[${cleanOpeningInput}:v]overlay=0:0:enable='between(t,0,${openingSec.toFixed(3)})'[cleanOpening]`,
          );
          cleanOutput = "[cleanOpening]";
        }
        if (cleanIntroInput !== undefined) {
          cleanGraph.push(
            `${cleanOutput}[${cleanIntroInput}:v]overlay=0:0:enable='between(t,${openingSec.toFixed(3)},${leadInSec.toFixed(3)})'[cleanIntro]`,
          );
          cleanOutput = "[cleanIntro]";
        }
        if (cleanOutroInput !== undefined) {
          cleanGraph.push(
            `${cleanOutput}[${cleanOutroInput}:v]overlay=0:0:enable='between(t,${(leadInSec + sourceDur).toFixed(3)},${outputDur.toFixed(3)})'[cleanOutro]`,
          );
          cleanOutput = "[cleanOutro]";
        }
        clean.push("-filter_complex", cleanGraph.join(";"), "-map", cleanOutput);
      } else {
        clean.push("-map", "0:v:0");
      }
      clean.push(
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        String(crf),
        "-r",
        String(timeline.fps),
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-t",
        outputDur.toFixed(3),
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        "-nostats",
        fallback,
      );
      await runFfmpeg(
        id,
        clean,
        outputDur,
        "Creating clean MP4 fallback",
        fallback,
        15,
        78,
      );
      fs.renameSync(fallback, out);
    } catch (fallbackErr: any) {
      t.status = "review";
      t.stage = "steps";
      t.progress = 0;
      t.message = `The tutorial could not be rendered. ${fallbackErr?.message || primary?.message || "FFmpeg failed"}`;
      save(t);
      throw fallbackErr;
    }
  } finally {
    for (const overlay of focusOverlays)
      fs.rmSync(overlay.file, { force: true });
    if (openingCard) fs.rmSync(openingCard, { force: true });
    if (introCard) fs.rmSync(introCard, { force: true });
    if (outroCard) fs.rmSync(outroCard, { force: true });
  }
  const musicFile = t.music && fs.existsSync(t.music) ? t.music : undefined;
  let musicApplied = false;
  if (musicFile) {
    const withMusic = path.join(d, "tutorial-music.mp4");
    const fadeDuration = Math.min(1.5, Math.max(0.2, outputDur));
    const fadeStart = Math.max(0, outputDur - fadeDuration);
    const musicMix = [
      "-y",
      "-i",
      out,
      "-stream_loop",
      "-1",
      "-i",
      musicFile,
      "-filter_complex",
      `[1:a]atrim=duration=${outputDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.72,afade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeDuration.toFixed(3)}[aout]`,
      "-map",
      "0:v:0",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-t",
      outputDur.toFixed(3),
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      "-nostats",
      withMusic,
    ];
    try {
      await runFfmpeg(
        id,
        musicMix,
        outputDur,
        "Adding music",
        withMusic,
        78,
        99,
      );
      fs.renameSync(withMusic, out);
      musicApplied = true;
    } catch {
      fs.rmSync(withMusic, { force: true });
      t.message = "Music mix failed; falling back to step narration.";
      save(t);
    }
  }
  const audioFiles = (timeline.steps || [])
    .map((s, i) => {
      if (s.action === "introduction" && !s.audio) return "";
      return s.audio && fs.existsSync(s.audio)
        ? s.audio
        : path.join(d, "audio", `step-${String(i + 1).padStart(3, "0")}.wav`);
    })
    .filter((p) => fs.existsSync(p));
  for (const file of audioFiles) normalizeWavHeader(file);
  if (!musicApplied && audioFiles.length) {
    const narrated = path.join(d, "tutorial-narrated.mp4");
    const inputs = ["-y", "-i", out];
    const labels: string[] = [];
    const graph: string[] = [];
    audioFiles.forEach((file, j) => {
      inputs.push("-i", file);
      const step = timeline.steps.findIndex((s) => s.audio === file);
      const st = timeline.steps[step >= 0 ? step : j];
      const delay = Math.max(
        0,
        Math.round((Number(st?.startMs) || 0) + openingSec * 1000),
      );
      const label = `a${j}`;
      graph.push(
        `[${j + 1}:a]adelay=${delay}:all=1,aresample=async=1[${label}]`,
      );
      labels.push(`[${label}]`);
    });
    graph.push(
      `${labels.join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=duration=${outputDur.toFixed(3)}[aout]`,
    );
    const mix = [
      ...inputs,
      "-filter_complex",
      graph.join(";"),
      "-map",
      "0:v:0",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      "-nostats",
      narrated,
    ];
    try {
      await runFfmpeg(id, mix, outputDur, "Adding narration", narrated, 78, 99);
      fs.renameSync(narrated, out);
    } catch (e) {
      t.message = "Narration mix failed; keeping the valid visual MP4.";
      save(t);
    }
  }
  t.video = out;
  t.videoOpeningMs = openingSec * 1000;
  t.status = "ready";
  t.stage = "ready";
  t.progress = 100;
  t.message = "Final tutorial video is ready.";
  save(t);
  return out;
}
