import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { dir, get, save, settings } from "./store";
import { buildTimeline, INTRO_DURATION_MS } from "./timeline";
import { ffmpegPath as resolveFfmpeg, readMediaDuration } from "./media";

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
type CursorPoint = {
  time: number;
  xRatio: number;
  yRatio: number;
};
function cursorPoints(actions: any[], introSec: number) {
  const points = actions
    .filter(
      (action) =>
        ["move", "click"].includes(action.type) &&
        Number.isFinite(Number(action.activeMs)) &&
        Number.isFinite(Number(action.x)) &&
        Number.isFinite(Number(action.y)) &&
        Number(action.viewportWidth) > 0 &&
        Number(action.viewportHeight) > 0,
    )
    .map((action) => ({
      time: introSec + Math.max(0, Number(action.activeMs) / 1000),
      xRatio: Math.min(
        1,
        Math.max(0, Number(action.x) / Number(action.viewportWidth)),
      ),
      yRatio: Math.min(
        1,
        Math.max(0, Number(action.y) / Number(action.viewportHeight)),
      ),
    }))
    .sort((a, b) => a.time - b.time)
    .filter((point, index, all) => !index || point.time > all[index - 1].time);
  if (points.length <= 480) return points;
  const stride = Math.ceil(points.length / 480);
  const reduced = points.filter((_, index) => index % stride === 0);
  const last = points[points.length - 1];
  if (reduced[reduced.length - 1] !== last) reduced.push(last);
  return reduced;
}
function cursorExpression(
  points: CursorPoint[],
  axis: "x" | "y",
) {
  const dimension = axis === "x" ? "main_w" : "main_h";
  const ratio = (point: CursorPoint) =>
    (axis === "x" ? point.xRatio : point.yRatio).toFixed(6);
  let expression = `${ratio(points[points.length - 1])}*${dimension}`;
  for (let index = points.length - 2; index >= 0; index--) {
    const start = points[index];
    const end = points[index + 1];
    const duration = Math.max(0.001, end.time - start.time);
    const startValue = `${ratio(start)}*${dimension}`;
    const endValue = `${ratio(end)}*${dimension}`;
    const position = `${startValue}+(${endValue}-${startValue})*(t-${start.time.toFixed(3)})/${duration.toFixed(3)}`;
    expression = `if(lt(t,${end.time.toFixed(3)}),${position},${expression})`;
  }
  return expression;
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
  for (const a of timeline.actions.filter(
    (a) =>
      a.targetRect && ["click", "input", "select", "change"].includes(a.type),
  )) {
    const r = a.targetRect!,
      highlightMs =
        a.type === "click"
          ? Number(a.screenshotMs || a.activeMs || 0)
          : Number(a.activeMs || 0),
      sec = introSec + Math.max(0, highlightMs / 1000),
      en = sec + 0.65,
      x = Math.max(0, r.x - 7),
      y = Math.max(0, r.y - 7),
      w = Math.max(14, r.width + 14),
      h = Math.max(14, r.height + 14);
    filters.push(
      `drawbox=x=${x.toFixed(1)}:y=${y.toFixed(1)}:w=${w.toFixed(1)}:h=${h.toFixed(1)}:color=yellow@0.14:t=fill:enable='between(t,${sec.toFixed(3)},${en.toFixed(3)})'`,
      `drawbox=x=${x.toFixed(1)}:y=${y.toFixed(1)}:w=${w.toFixed(1)}:h=${h.toFixed(1)}:color=yellow@0.95:t=3:enable='between(t,${sec.toFixed(3)},${en.toFixed(3)})'`,
    );
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
  const cursorAsset = path.resolve(
    process.cwd(),
    "public",
    "icons8-cursor-480.png",
  );
  const moves = cursorPoints(timeline.actions, introSec);
  const showCursor = moves.length > 0 && fs.existsSync(cursorAsset);
  const visual = ["-y", "-i", source];
  if (showCursor) {
    const first = moves[0].time;
    const last = Math.min(outputDur, moves[moves.length - 1].time + 0.8);
    const xExpression = cursorExpression(moves, "x");
    const yExpression = cursorExpression(moves, "y");
    visual.push(
      "-loop",
      "1",
      "-i",
      cursorAsset,
      "-filter_complex",
      `[0:v]${filters.join(",")}[base];[1:v]scale=30:30[cursor];[base][cursor]overlay=x='(${xExpression})-4':y='(${yExpression})-4':enable='between(t,${first.toFixed(3)},${last.toFixed(3)})':shortest=1[outv]`,
      "-map",
      "[outv]",
    );
  } else {
    visual.push("-vf", filters.join(","), "-map", "0:v:0");
  }
  visual.push(
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
    out,
  );
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
  }
  const audioFiles = (timeline.steps || [])
    .map((s, i) =>
      s.audio && fs.existsSync(s.audio)
        ? s.audio
        : path.join(d, "audio", `step-${String(i + 1).padStart(3, "0")}.wav`),
    )
    .filter((p) => fs.existsSync(p));
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
