import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { readMediaDuration } from "../../../../lib/media";
import { dir, get, save } from "../../../../lib/store";

export const runtime = "nodejs";

const types: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
};

function removeProjectMusic(projectDir: string) {
  for (const name of fs.readdirSync(projectDir)) {
    if (name.startsWith("background-music."))
      fs.rmSync(path.join(projectDir, name), { force: true });
  }
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  const tutorial = get(id);
  const file = tutorial?.music;
  if (!file || !fs.existsSync(file))
    return new NextResponse("Music not found", { status: 404 });
  const size = fs.statSync(file).size;
  const range = req.headers.get("range");
  const headers: Record<string, string> = {
    "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };
  if (!range) {
    headers["Content-Length"] = String(size);
    return new Response(fs.readFileSync(file) as any, { headers });
  }
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) return new NextResponse("Invalid range", { status: 416 });
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start < 0 || start >= size || end < start)
    return new NextResponse("Range not satisfiable", { status: 416 });
  headers["Content-Length"] = String(end - start + 1);
  headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  return new Response(fs.readFileSync(file).subarray(start, end + 1) as any, {
    status: 206,
    headers,
  });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const id = String(form.get("id") || "");
    const music = form.get("music");
    const tutorial = get(id);
    if (!tutorial)
      return NextResponse.json({ error: "Tutorial not found." }, { status: 404 });
    if (
      !music ||
      typeof music === "string" ||
      typeof music.arrayBuffer !== "function"
    )
      return NextResponse.json({ error: "Choose a music file first." }, { status: 400 });
    if (!music.type.startsWith("audio/"))
      return NextResponse.json({ error: "Choose a valid audio file." }, { status: 400 });
    if (music.size > 100 * 1024 * 1024)
      return NextResponse.json({ error: "Music must be 100 MB or smaller." }, { status: 400 });

    const originalExtension = path.extname(music.name).toLowerCase();
    const extension = types[originalExtension]
      ? originalExtension
      : music.type === "audio/mpeg"
        ? ".mp3"
        : music.type === "audio/mp4"
          ? ".m4a"
          : music.type === "audio/ogg"
            ? ".ogg"
            : ".wav";
    const projectDir = dir(id);
    const temporary = path.join(projectDir, `.music-upload${extension}`);
    const output = path.join(projectDir, `background-music${extension}`);
    fs.writeFileSync(temporary, Buffer.from(await music.arrayBuffer()));
    if (readMediaDuration(temporary) <= 0) {
      fs.rmSync(temporary, { force: true });
      return NextResponse.json(
        { error: "The selected music file could not be read." },
        { status: 400 },
      );
    }
    removeProjectMusic(projectDir);
    fs.renameSync(temporary, output);
    tutorial.music = output;
    tutorial.musicName = String(music.name || "Background music").slice(0, 180);
    tutorial.videoOutdated = !!tutorial.video;
    tutorial.status = "review";
    tutorial.stage = "steps";
    tutorial.message = "Music saved. Render again to replace step narration with music.";
    save(tutorial);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not save the music." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  const tutorial = get(id);
  if (!tutorial)
    return NextResponse.json({ error: "Tutorial not found." }, { status: 404 });
  removeProjectMusic(dir(id));
  tutorial.music = undefined;
  tutorial.musicName = undefined;
  tutorial.videoOutdated = !!tutorial.video;
  tutorial.status = "review";
  tutorial.stage = "steps";
  tutorial.message = "Music removed. Step narration will be used again.";
  save(tutorial);
  return NextResponse.json({ ok: true });
}
