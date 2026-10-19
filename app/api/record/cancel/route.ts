import { NextResponse } from "next/server";
import { cancelRecording } from "../../../../lib/recorder";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    if (!id)
      return NextResponse.json(
        { error: "Missing tutorial id" },
        { status: 400 },
      );
    const removed = await cancelRecording(String(id));
    if (!removed)
      return NextResponse.json(
        { error: "Recording not found" },
        { status: 404 },
      );
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Couldn't cancel recording." },
      { status: 500 },
    );
  }
}
