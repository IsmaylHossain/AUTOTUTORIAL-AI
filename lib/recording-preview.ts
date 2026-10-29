import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { dir, get, save, Tutorial } from "./store";
import { ffmpegPath, waitForMediaDuration } from "./media";

// Raw footage uses elapsed time. Actions and steps already use active time.
export function activeRecordingRanges(t: Tutorial, rawDuration: number) {
  if (t.recordingIsActive) return rawDuration > 0 ? [{ start: 0, end: rawDuration }] : [];
  const offset = Math.min(rawDuration, Math.max(0, (t.videoStartOffsetMs || 0) / 1000));
  const stop = Number.isFinite(t.recordingStopMs)
    ? Math.min(rawDuration, offset + Math.max(0, t.recordingStopMs!) / 1000)
    : rawDuration;
  const pauses = (t.pauseIntervals || []).map(p => ({
    start: Math.min(stop, offset + Math.max(0, p.startMs / 1000)),
    end: Math.min(stop, offset + Math.max(0, (p.endMs ?? t.recordingStopMs ?? rawDuration * 1000) / 1000)),
  })).filter(p => p.end > p.start).sort((a, b) => a.start - b.start);
  const ranges: { start: number; end: number }[] = [];
  let cursor = offset;
  for (const pause of pauses) {
    if (pause.start > cursor) ranges.push({ start: cursor, end: pause.start });
    cursor = Math.max(cursor, pause.end);
  }
  if (cursor < stop) ranges.push({ start: cursor, end: stop });
  return ranges;
}

const pending = new Map<string, Promise<string>>();
export async function recordingPreview(id: string): Promise<string> {
  const t = get(id);
  if (!t?.recording || !fs.existsSync(t.recording)) throw new Error("Recording not found.");
  const recording = t.recording;
  if (t.recordingIsActive) return recording;
  const stat = fs.statSync(recording);
  const key = createHash("sha256").update(JSON.stringify([
    recording, stat.size, stat.mtimeMs, t.videoStartOffsetMs, t.recordingStopMs, t.pauseIntervals,
  ])).digest("hex").slice(0, 16);
  const output = path.join(dir(id), `recording-preview-${key}.mp4`);
  if (fs.existsSync(output)) return output;
  const running = pending.get(output);
  if (running) return running;
  const task = (async () => {
    const duration = await waitForMediaDuration(recording, 15000, 1024);
    if (!(duration > 0)) throw new Error("Recording is still finalizing. Please retry.");
    const ranges = activeRecordingRanges(t, duration);
    if (!ranges.length) throw new Error("Recording contains no active footage.");
    if (ranges.length === 1 && ranges[0].start === 0 && ranges[0].end === duration) return recording;
    const binary = ffmpegPath();
    if (!binary) throw new Error("FFmpeg is required to remove paused footage.");
    const temporary = output.replace(/\.mp4$/, ".partial.mp4");
    const filters = ranges.map((r, i) =>
      `[0:v]trim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    filters.push(`${ranges.map((_, i) => `[v${i}]`).join("")}concat=n=${ranges.length}:v=1:a=0[vout]`);
    try {
      await new Promise<void>((resolve, reject) => {
        const process = spawn(binary, ["-y", "-filter_complex_threads", "1", "-i", recording,
          "-filter_complex", filters.join(";"), "-map", "[vout]", "-an", "-c:v", "libx264",
          "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", temporary],
        { stdio: ["ignore", "ignore", "pipe"] });
        let error = "";
        process.stderr.on("data", chunk => { error = (error + chunk.toString()).slice(-16000); });
        process.on("error", reject);
        process.on("close", code => code === 0 ? resolve() : reject(new Error(error || "Preview preparation failed.")));
      });
      if (!(await waitForMediaDuration(temporary, 15000, 1024) > 0)) throw new Error("Preview has no readable video.");
      fs.renameSync(temporary, output);
      return output;
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  })();
  pending.set(output, task);
  try { return await task; } finally { pending.delete(output); }
}

const finalizing = new Map<string, Promise<string>>();
// Only Stop supplies this explicit cleanup list. Opening old projects never deletes media.
export async function finalizeActiveRecording(id: string): Promise<string> {
  const running = finalizing.get(id);
  if (running) return running;
  const task = (async () => {
    const before = get(id);
    if (!before?.recordingCleanupFiles) return recordingPreview(id);
    const recording = await recordingPreview(id);
    const actual = await waitForMediaDuration(recording, 15000, 1024);
    const raw = await waitForMediaDuration(before.recording!, 15000, 1024);
    const expected = activeRecordingRanges(before, raw).reduce((sum, r) => sum + r.end - r.start, 0);
    if (!(actual > 0 && expected > 0) || Math.abs(actual - expected) > 0.2)
      throw new Error("Trimmed recording verification failed. Original files were kept.");
    const current = get(id)!;
    if (current.recording !== before.recording)
      throw new Error("Recording changed during preparation. Original files were kept.");
    current.recording = recording;
    current.recordingIsActive = true;
    // Commit the verified replacement before deleting any source files. Keep timing
    // metadata for diagnostics; recordingIsActive prevents applying its cuts twice.
    save(current);
    const root = path.resolve(dir(id));
    const protectedFiles = new Set([recording, current.video, current.music, current.templateImage]
      .filter((file): file is string => !!file).map(file => path.resolve(file)));
    const remaining: string[] = [];
    for (const name of current.recordingCleanupFiles || []) {
      if (name !== path.basename(name) || !/\.(webm|mp4)$/i.test(name)) continue;
      const file = path.resolve(root, name);
      if (path.dirname(file) !== root || protectedFiles.has(file)) continue;
      try {
        if (fs.existsSync(file) && fs.lstatSync(file).isFile()) fs.unlinkSync(file);
      } catch {
        remaining.push(name);
      }
    }
    current.recordingCleanupFiles = remaining.length ? remaining : undefined;
    save(current);
    return recording;
  })();
  finalizing.set(id, task);
  try { return await task; } finally { finalizing.delete(id); }
}
