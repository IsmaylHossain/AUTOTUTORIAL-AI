import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { dir, get } from "../../../lib/store";
export const runtime = "nodejs";
function typeFor(file: string) {
  const ext = path.extname(file).toLowerCase();
  return ext === ".mp3"
    ? "audio/mpeg"
    : ext === ".aiff" || ext === ".aif"
      ? "audio/aiff"
      : "audio/wav";
}
export async function GET(req: Request) {
  try {
    const u = new URL(req.url),
      id = u.searchParams.get("id"),
      index = Number(u.searchParams.get("index"));
    if (!id || !Number.isInteger(index) || index < 0)
      return new NextResponse("Invalid request", { status: 400 });
    const t = get(id);
    if (!t || !t.steps[index])
      return new NextResponse("Not found", { status: 404 });
    const step = t.steps[index],
      d = dir(id),
      fallbacks = [
        step.audio,
        path.join(d, "audio", `step-${String(index + 1).padStart(3, "0")}.mp3`),
        path.join(d, "audio", `step-${String(index + 1).padStart(3, "0")}.wav`),
        path.join(
          d,
          "audio",
          `step-${String(index + 1).padStart(3, "0")}.aiff`,
        ),
      ].filter(Boolean) as string[];
    const file = fallbacks.find((x) => fs.existsSync(x));
    if (!file) return new NextResponse("Audio not found", { status: 404 });
    const stat = fs.statSync(file),
      size = stat.size,
      range = req.headers.get("range"),
      headers: any = {
        "Content-Type": typeFor(file),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      };
    if (!range) {
      headers["Content-Length"] = String(size);
      return new Response(fs.createReadStream(file) as any, { headers });
    }
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (!m) return new NextResponse("Invalid range", { status: 416 });
    const start = m[1] ? Number(m[1]) : 0,
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start < 0 || start >= size || end < start)
      return new NextResponse("Range not satisfiable", { status: 416 });
    headers["Content-Length"] = String(end - start + 1);
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    return new Response(fs.createReadStream(file, { start, end }) as any, {
      status: 206,
      headers,
    });
  } catch (e: any) {
    return new NextResponse(e.message || "Audio error", { status: 500 });
  }
}
