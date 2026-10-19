import { NextResponse } from "next/server";
import { createPptx, pptxFileName } from "../../../../lib/export";
import { get } from "../../../../lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    if (!id || !get(id)) return NextResponse.json({ error: "Tutorial not found." }, { status: 404 });
    const buffer = await createPptx(id);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${pptxFileName(id)}"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "PPTX export failed." }, { status: 500 });
  }
}
