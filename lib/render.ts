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
function escapeFilterPath(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
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
  const outputDur = sourceDur + introSec;
  const sourceSize = readMediaDimensions(source) || {
    width: timeline.width,
    height: timeline.height,
  };
  const filters: string[] = [];
  if (hasIntro) {
    const titleFile = path.join(d, "intro-title.txt");
    fs.writeFileSync(titleFile, `Welcome to\n${t.name}`);
    filters.push(
      `tpad=start_duration=${introSec}:start_mode=clone`,
      `drawtext=textfile='${escapeFilterPath(titleFile)}':expansion=none:fontcolor=white:fontsize=40:line_spacing=14:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.72:boxborderw=32:enable='between(t,0,${introSec})'`,
    );
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
    const clickAt = introSec + Math.max(0, highlightMs / 1000);
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
      sec = introSec + Math.max(0, Number(a.activeMs || 0) / 1000),
      en = sec + 3,
      x = Math.max(0, r.x - 4),
      y = Math.max(0, r.y - 4),
      w = Math.max(10, r.width + 8),
      h = Math.max(10, r.height + 8);
    filters.push(
      `drawbox=x=${x.toFixed(1)}:y=${y.toFixed(1)}:w=${w.toFixed(1)}:h=${h.toFixed(1)}:color=black@0.96:t=fill:enable='between(t,${sec.toFixed(3)},${en.toFixed(3)})'`,
    );
  }
  const visualInputs = ["-y", "-i", source];
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
  focusOverlays.forEach((overlay, index) => {
    const next = `[focus${index}]`;
    visualGraph.push(
      `${visualOutput}[${index + 1}:v]overlay=x=${overlay.x.toFixed(1)}:y=${overlay.y.toFixed(1)}:enable='between(t,${overlay.start.toFixed(3)},${overlay.end.toFixed(3)})'${next}`,
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
      if (hasIntro)
        clean.push("-vf", `tpad=start_duration=${introSec}:start_mode=clone`);
      clean.push(
        "-map",
        "0:v:0",
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
  }
  const audioFiles = (timeline.steps || [])
    .map((s, i) =>
      s.audio && fs.existsSync(s.audio)
        ? s.audio
        : path.join(d, "audio", `step-${String(i + 1).padStart(3, "0")}.wav`),
    )
    .filter((p) => fs.existsSync(p));
  for (const file of audioFiles) normalizeWavHeader(file);
  if (audioFiles.length) {
    const narrated = path.join(d, "tutorial-narrated.mp4");
    const inputs = ["-y", "-i", out];
    const labels: string[] = [];
    const graph: string[] = [];
    audioFiles.forEach((file, j) => {
      inputs.push("-i", file);
      const step = timeline.steps.findIndex((s) => s.audio === file);
      const st = timeline.steps[step >= 0 ? step : j];
      const delay = Math.max(0, Math.round(Number(st?.startMs) || 0));
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
  t.status = "ready";
  t.stage = "ready";
  t.progress = 100;
  t.message = "Final tutorial video is ready.";
  save(t);
  return out;
}
