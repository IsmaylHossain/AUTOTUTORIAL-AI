import { NextResponse } from "next/server";
import { regenerateStep } from "../../../../lib/ai";
import { renderActive } from "../../../../lib/render";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const { id, index } = await req.json();
    if (renderActive(id)) return NextResponse.json({ error: "Cancel or finish the render before rewriting steps." }, { status: 409 });
    const n = Number(index);
    if (!Number.isInteger(n) || n < 0)
      return NextResponse.json(
        { error: "Invalid step index." },
        { status: 400 },
      );
    return NextResponse.json({ ok: true, step: await regenerateStep(id, n) });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Could not regenerate step." },
      { status: 500 },
    );
  }
}
