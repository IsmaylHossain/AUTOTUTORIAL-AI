import { NextResponse } from "next/server";
import { get, remove, save } from "../../../lib/store";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  const t = get(id);
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    ...t,
    videoUrl: t.video ? `/api/video?id=${encodeURIComponent(id)}&v=${t.videoUpdatedAt || 0}` : null,
    templateImageUrl: t.templateImage
      ? `/api/tutorial/template?id=${encodeURIComponent(id)}`
      : null,
    musicUrl: t.music
      ? `/api/tutorial/music?id=${encodeURIComponent(id)}`
      : null,
  });
}
export async function PATCH(req: Request) {
  try {
    const { id, name } = await req.json();
    const t = get(String(id || ""));
    if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const n = String(name || "").trim();
    if (!n)
      return NextResponse.json(
        { error: "Name cannot be empty." },
        { status: 400 },
      );
    t.name = n;
    save(t);
    return NextResponse.json({ ok: true, tutorial: t });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Rename failed." },
      { status: 500 },
    );
  }
}
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "Missing tutorial id" }, { status: 400 });
  if (!remove(id))
    return NextResponse.json({ error: "Tutorial not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
