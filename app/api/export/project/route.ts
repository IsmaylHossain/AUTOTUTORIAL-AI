import { NextResponse } from "next/server";
import { createProjectBundle, projectFileName } from "../../../../lib/export";
import { get } from "../../../../lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    if (!id || !get(id)) return NextResponse.json({ error: "Tutorial not found." }, { status: 404 });
    const buffer = await createProjectBundle(id);
    const body = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${projectFileName(id)}"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Project export failed." }, { status: 500 });
  }
}
