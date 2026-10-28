import { NextResponse } from "next/server";
import { startRender } from "../../../lib/render";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "Missing tutorial id" }, { status: 400 });
    const started = startRender(id);
    return NextResponse.json({ ok: true, started, status: "rendering" }, { status: 202 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Render failed." }, { status: 500 });
  }
}
