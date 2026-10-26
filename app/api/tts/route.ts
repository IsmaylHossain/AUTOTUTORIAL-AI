import { NextResponse } from "next/server";
import { generateTTS } from "../../../lib/tts";
import { get } from "../../../lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { id, index } = await request.json();
    if (!id || !Number.isInteger(Number(index)) || Number(index) < 0)
      return NextResponse.json(
        { ok: false, error: "Invalid tutorial or step index." },
        { status: 400 },
      );
    const audio = await generateTTS(id, Number(index));
    const tutorial = get(id);
    return NextResponse.json({
      ok: true,
      audio,
      source: tutorial?.steps[Number(index)]?.voiceSource || "edge",
    });
  } catch (error: any) {
    const message = String(error?.message || "Voice generation failed.");
    const status = /not configured|empty|API key/i.test(message) ? 503 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
