import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import Groq from "groq-sdk";
import { dir, get, save, settings } from "./store";

function resolveFfmpeg() {
  try {
    const mod = require("ffmpeg-static");
    const p = typeof mod === "string" ? mod : mod?.default;
    if (p && fs.existsSync(p)) return p;
  } catch {}
  for (const p of [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ])
    if (fs.existsSync(p)) return p;
  return "";
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
function macSay(text: string, out: string, speed = 1) {
  return new Promise<void>((resolve, reject) => {
    const cleaned = String(text || "")
      .replace(/[\r\n]+/g, " ")
      .trim();
    if (!cleaned) return reject(new Error("Narration text is empty."));
    const rate = Math.max(80, Math.min(500, Math.round(175 * speed)));
    const target =
      path.extname(out).toLowerCase() === ".aiff" ? out : `${out}.aiff`;
    const p = spawn("say", ["-r", String(rate), "-o", target, cleaned], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    p.stderr.on("data", (c) => (err += c.toString()));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 && fs.existsSync(target) && fs.statSync(target).size > 100
        ? resolve()
        : reject(new Error(err || `say exited with ${code}`)),
    );
  });
}
function chunks(text: string, max = 190) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) {
      out.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}
async function groqTTS(
  text: string,
  out: string,
  voice: string,
  model: string,
  speed: number,
) {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error("GROQ_API_KEY is not configured.");
  const client = new Groq({ apiKey: key });
  const pieces = chunks(text);
  const tempDir = path.dirname(out);
  const parts: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const temp = path.join(
      tempDir,
      `.tts-${process.pid}-${Date.now()}-${i}.wav`,
    );
    const response = await client.audio.speech.create({
      model,
      voice,
      input: pieces[i],
      response_format: "wav",
      speed: Math.max(0.5, Math.min(5, speed)),
    });
    fs.writeFileSync(temp, Buffer.from(await response.arrayBuffer()));
    parts.push(temp);
  }
  if (parts.length === 1) {
    fs.copyFileSync(parts[0], out);
    fs.rmSync(parts[0], { force: true });
    return;
  }
  const ff = resolveFfmpeg();
  if (!ff)
    throw new Error(
      "Groq narration was generated, but FFmpeg is required to join multi-part narration. Run npm run setup:media.",
    );
  const list = path.join(tempDir, `.tts-list-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(
    list,
    parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
  );
  try {
    await run(ff, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      out,
    ]);
  } finally {
    fs.rmSync(list, { force: true });
    for (const p of parts) fs.rmSync(p, { force: true });
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
    `step-${String(index + 1).padStart(3, "0")}`,
  );
  const wav = `${base}.wav`;
  const aiff = `${base}.aiff`;
  const cfg = settings();
  const model = cfg.ttsModel || process.env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english";
  const voice = cfg.voice || process.env.GROQ_TTS_VOICE || "hannah";
  const speed = Number(cfg.speed || 1);
  try {
    if (cfg.provider === "gemini") {
      const key = process.env.GEMINI_API_KEY?.trim();
      if (!key) throw new Error("Gemini API key is not configured.");
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?key=${encodeURIComponent(key)}&alt=media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
          }),
        },
      );
      if (!response.ok) throw new Error(`Gemini narration request failed (${response.status}).`);
      const audio = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(wav, audio);
    } else {
      await groqTTS(text, wav, voice, model, speed);
    }
    if (fs.existsSync(wav) && fs.statSync(wav).size > 100) {
      step.audio = wav;
      save(t);
      return wav;
    }
  } catch (providerError) {
    if (process.platform !== "darwin") throw providerError;
  }
  if (process.platform === "darwin") {
    await macSay(text, aiff, speed);
    step.audio = aiff;
    save(t);
    return aiff;
  }
  throw new Error(
    "Groq narration failed and no local voice fallback is available.",
  );
}
