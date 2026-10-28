import { NextResponse } from "next/server";
import { recoverRender, renderActive } from "../../../../lib/render";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  const t = recoverRender(id);
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ id, status: t.status, stage: t.stage,
    progress: t.progress ?? 0, message: t.message || "", active: renderActive(id) },
    { headers: { "Cache-Control": "no-store" } });
}
