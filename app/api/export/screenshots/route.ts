import { NextResponse } from "next/server";
import {
  createScreenshotsBundle,
  screenshotsFileName,
} from "../../../../lib/export";
import { get } from "../../../../lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    if (!id || !get(String(id)))
      return NextResponse.json(
        { error: "Tutorial not found." },
        { status: 404 },
      );
    const buffer = await createScreenshotsBundle(String(id));
    const body = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${screenshotsFileName(String(id))}"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Screenshot export failed." },
      { status: 500 },
    );
  }
}
