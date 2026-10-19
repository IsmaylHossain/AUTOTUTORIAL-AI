import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { mediaStatus } from "../../../lib/media";
export const runtime = "nodejs";
export async function GET() {
  const media = mediaStatus();
  let chromium = false;
  try {
    const { chromium: c } = await import("playwright");
    const b = await c.launch({ headless: true });
    await b.close();
    chromium = true;
  } catch {}
  const dataDir =
    process.env.AUTOTUTORIAL_DATA_DIR?.trim() ||
    path.join(os.homedir(), ".autotutorial-ai");
  return NextResponse.json({
    ok: media.ffmpeg && chromium,
    ffmpeg: media.ffmpeg,
    ffmpegPath: media.ffmpegPath,
    ffprobe: media.ffprobe,
    ffprobePath: media.ffprobePath,
    mediaProbe: media.ffprobe || media.ffmpeg,
    mediaProbePath: media.ffprobePath || (media.ffmpeg ? `${media.ffmpegPath} (FFmpeg duration fallback)` : null),
    playwrightChromium: chromium,
    dataDirectory: fs.existsSync(dataDir),
    dataPath: dataDir,
    groqConfigured: !!process.env.GROQ_API_KEY?.trim(),
    geminiConfigured: !!process.env.GEMINI_API_KEY?.trim(),
    platform: process.platform,
  });
}
