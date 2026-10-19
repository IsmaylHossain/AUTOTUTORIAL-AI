import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { dir, get } from "../../../lib/store";
export const runtime = "nodejs";
function mime(file: string) {
  const e = path.extname(file).toLowerCase();
  return e === ".png"
    ? "image/png"
    : e === ".jpg" || e === ".jpeg"
      ? "image/jpeg"
      : e === ".webp"
        ? "image/webp"
        : e === ".webm"
          ? "video/webm"
          : e === ".mp4"
            ? "video/mp4"
            : e === ".wav"
              ? "audio/wav"
              : e === ".mp3"
                ? "audio/mpeg"
                : e === ".aiff" || e === ".aif"
                  ? "audio/aiff"
                  : "application/octet-stream";
}
export async function GET(req: Request) {
  const u = new URL(req.url),
    id = u.searchParams.get("id") || "",
    t = get(id);
  if (!t) return new NextResponse("Not found", { status: 404 });
  const d = dir(id),
    file = u.searchParams.get("file");
  if (!file) {
    const screenshots = fs
      .readdirSync(path.join(d, "screenshots"))
      .filter((x) => /\.(png|jpg|jpeg|webp)$/i.test(x))
      .sort()
      .map((name) => {
        const match = name.match(/screen[-_ ]?(\d+)/i);
        const label = match
          ? `Screen ${match[1]}`
          : name.replace(/\.[^.]+$/, "");
        return {
          name: label,
          url: `/api/assets?id=${encodeURIComponent(id)}&file=${encodeURIComponent(`screenshots/${name}`)}`,
        };
      });
    const hasRecording = !!t.recording && fs.existsSync(t.recording);
    const hasVideo = !!t.video && fs.existsSync(t.video);
    return NextResponse.json({
      screenshots,
      hasRecording,
      recordingUrl: hasRecording
        ? `/api/assets?id=${encodeURIComponent(id)}&file=${encodeURIComponent(path.basename(t.recording!))}`
        : null,
      hasVideo,
      videoUrl: hasVideo ? `/api/video?id=${encodeURIComponent(id)}` : null,
    });
  }
  const root = path.resolve(d),
    target = path.resolve(d, file);
  if (target !== root && !target.startsWith(root + path.sep))
    return new NextResponse("Forbidden", { status: 403 });
  if (!fs.existsSync(target) || !fs.statSync(target).isFile())
    return new NextResponse("Not found", { status: 404 });
  const stat = fs.statSync(target),
    range = req.headers.get("range"),
    headers: any = {
      "Content-Type": mime(target),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    };
  if (!range) {
    headers["Content-Length"] = String(stat.size);
    return new Response(fs.createReadStream(target) as any, { headers });
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return new NextResponse("Invalid range", { status: 416 });
  const start = m[1] ? Number(m[1]) : 0,
    end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
  if (start < 0 || start >= stat.size || end < start)
    return new NextResponse("Range not satisfiable", { status: 416 });
  headers["Content-Length"] = String(end - start + 1);
  headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  return new Response(fs.createReadStream(target, { start, end }) as any, {
    status: 206,
    headers,
  });
}
