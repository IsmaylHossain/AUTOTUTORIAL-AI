import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { dir, get, save, settings } from "./store";
import { normalizeAiSettings } from "./ai-options";
import { ffmpegPath, normalizeWavHeader } from "./media";

function resolveFfmpeg() {
  return ffmpegPath();
}
function run(file: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(file, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (c) => (err += c.toString()));
    p.on("error", reject);
    p.on("close", (c) =>
      c === 0 ? resolve() : reject(new Error(err || `FFmpeg exited with ${c}`)),
    );
  });
}

function cleanNarration(text: string) {
  return String(text || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function macOsTTS(text: string, base: string, speed: number) {
  const aiff = `${base}.aiff`;
  const wav = `${base}.wav`;
  const rate = Math.max(90, Math.min(400, Math.round(175 * speed)));
  await run("/usr/bin/say", ["-r", String(rate), "-o", aiff, text]);
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) return aiff;
  try {
    await run(ffmpeg, ["-y", "-i", aiff, wav]);
    fs.rmSync(aiff, { force: true });
    return wav;
  } catch {
    fs.rmSync(wav, { force: true });
    return aiff;
  }
}

async function windowsTTS(text: string, base: string, speed: number) {
  const wav = `${base}.wav`;
  const encodedText = Buffer.from(text, "utf8").toString("base64");
  const encodedPath = Buffer.from(wav, "utf8").toString("base64");
  const rate = Math.max(-10, Math.min(10, Math.round((speed - 1) * 8)));
  const script = [
    "Add-Type -AssemblyName System.Speech",
    `$text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedText}'))`,
    `$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))`,
    "$voice=New-Object System.Speech.Synthesis.SpeechSynthesizer",
    `$voice.Rate=${rate}`,
    "$voice.SetOutputToWaveFile($path)",
    "$voice.Speak($text)",
    "$voice.Dispose()",
  ].join(";");
  let lastError: unknown;
  for (const command of ["powershell.exe", "powershell", "pwsh"]) {
    try {
      await run(command, ["-NoProfile", "-NonInteractive", "-Command", script]);
      if (fs.existsSync(wav) && fs.statSync(wav).size > 100) return wav;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Windows speech synthesis is unavailable.");
}

async function linuxTTS(text: string, base: string, speed: number) {
  const wav = `${base}.wav`;
  const rate = Math.max(80, Math.min(450, Math.round(175 * speed)));
  const commands = [
    "/usr/bin/espeak-ng",
    "/usr/local/bin/espeak-ng",
    "/usr/bin/espeak",
    "/usr/local/bin/espeak",
  ].filter((command) => fs.existsSync(command));
  if (!commands.length)
    throw new Error("Install espeak-ng to enable local narration on Linux.");
  await run(commands[0], ["-s", String(rate), "-w", wav, text]);
  return wav;
}

async function localTTS(text: string, base: string, speed: number) {
  const cleaned = cleanNarration(text);
  if (!cleaned) throw new Error("Narration text is empty.");
  if (process.platform === "darwin")
    return macOsTTS(cleaned, base, speed);
  if (process.platform === "win32")
    return windowsTTS(cleaned, base, speed);
  return linuxTTS(cleaned, base, speed);
}

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function edgeTTSAttempt(text: string, out: string, voice: string) {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error("FFmpeg is required for Microsoft Edge narration.");
  const temporary = `${out}.edge-${process.pid}-${Date.now()}.webm`;
  const client = new MsEdgeTTS({
    connectionTimeoutMs: 12000,
    synthesisTimeoutMs: 60000,
  });
  try {
    await client.setMetadata(
      voice,
      OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS,
    );
    const { audioStream } = client.toStream(escapeXml(text));
    const audioChunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on("data", (chunk) => audioChunks.push(Buffer.from(chunk)));
      audioStream.once("end", resolve);
      audioStream.once("error", reject);
    });
    const audio = Buffer.concat(audioChunks);
    if (audio.length < 100) throw new Error("Microsoft Edge returned empty audio.");
    fs.writeFileSync(temporary, audio);
    await run(ffmpeg, [
      "-y",
      "-i",
      temporary,
      "-c:a",
      "pcm_s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      out,
    ]);
  } finally {
    client.close();
    fs.rmSync(temporary, { force: true });
  }
}

async function edgeTTS(text: string, out: string, voice: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.rmSync(out, { force: true });
      await edgeTTSAttempt(text, out, voice);
      if (fs.existsSync(out) && fs.statSync(out).size > 100) return;
      throw new Error("Microsoft Edge returned empty audio.");
    } catch (error) {
      lastError = error;
      fs.rmSync(out, { force: true });
      if (attempt < 2) await wait(attempt === 0 ? 400 : 1200);
    }
  }
  throw lastError || new Error("Microsoft Edge narration failed.");
}
async function applySpeed(file: string, speed: number) {
  const value = Math.max(0.5, Math.min(2, Number(speed) || 1));
  if (Math.abs(value - 1) < 0.01) return;
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error("FFmpeg is required to apply narration speed.");
  const temporary = `${file}.speed.wav`;
  try {
    await run(ffmpeg, [
      "-y",
      "-i",
      file,
      "-filter:a",
      `atempo=${value}`,
      "-c:a",
      "pcm_s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      temporary,
    ]);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export async function generateTTS(id: string, index: number) {
  const t = get(id);
  if (!t) throw new Error("Tutorial not found");
  const step = t.steps[index];
  if (!step) throw new Error("Step not found");
  const text = String(step.instruction || step.title || "").trim();
  if (!text) {
    throw new Error("Narration text is empty for this step.");
  }
  const base = path.join(
    dir(id),
    "audio",
    `step-${String(index + 1).padStart(3, "0")}-${randomUUID()}`,
  );
  const wav = `${base}.wav`;
  const merged = { ...settings(), ...(t.settings || {}) };
  const cfg = { ...merged, ...normalizeAiSettings(merged) };
  const voice = cfg.voice;
  const speed = Number(cfg.speed || 1);
  let output = wav;
  let voiceSource: "edge" | "local" = "edge";
  try {
    await edgeTTS(cleanNarration(text), wav, voice);
    await applySpeed(wav, speed);
  } catch (error) {
    console.warn(
      "[AutoTutorial AI] Microsoft Edge TTS failed; using the local system voice.",
      error,
    );
    fs.rmSync(wav, { force: true });
    output = await localTTS(text, base, speed);
    voiceSource = "local";
  }
  if (!fs.existsSync(output) || fs.statSync(output).size <= 100)
    throw new Error("Microsoft Edge and local narration both returned empty audio.");
  normalizeWavHeader(output);
  step.audio = output;
  step.audioText = text;
  step.voiceSource = voiceSource;
  save(t);
  return output;
}
