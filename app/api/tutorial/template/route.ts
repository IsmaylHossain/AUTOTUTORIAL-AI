import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { dir, get, save } from "../../../../lib/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  const tutorial = get(id);
  if (!tutorial?.templateImage || !fs.existsSync(tutorial.templateImage))
    return NextResponse.json({ error: "Template image not found." }, { status: 404 });
  return new NextResponse(fs.readFileSync(tutorial.templateImage), {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const id = String(form.get("id") || "");
    const image = form.get("image");
    const tutorial = get(id);
    if (!tutorial)
      return NextResponse.json({ error: "Tutorial not found." }, { status: 404 });
    if (
      !image ||
      typeof image === "string" ||
      typeof image.arrayBuffer !== "function"
    )
      return NextResponse.json({ error: "Choose an image first." }, { status: 400 });
    if (!image.type.startsWith("image/"))
      return NextResponse.json({ error: "The template must be an image." }, { status: 400 });
    if (image.size > 15 * 1024 * 1024)
      return NextResponse.json({ error: "The image must be 15 MB or smaller." }, { status: 400 });

    const output = path.join(dir(id), "template-cover.png");
    await sharp(Buffer.from(await image.arrayBuffer()))
      .rotate()
      .resize(3840, 2160, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toFile(output);
    tutorial.templateImage = output;
    tutorial.video = undefined;
    tutorial.videoOpeningMs = undefined;
    tutorial.status = "review";
    tutorial.stage = "steps";
    tutorial.message = "Template image saved. Render again to apply it to the video.";
    save(tutorial);
    return NextResponse.json({
      ok: true,
      templateImageUrl: `/api/tutorial/template?id=${encodeURIComponent(id)}&v=${Date.now()}`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not save the template image." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  const tutorial = get(id);
  if (!tutorial)
    return NextResponse.json({ error: "Tutorial not found." }, { status: 404 });
  if (tutorial.templateImage) fs.rmSync(tutorial.templateImage, { force: true });
  tutorial.templateImage = undefined;
  tutorial.video = undefined;
  tutorial.videoOpeningMs = undefined;
  tutorial.status = "review";
  tutorial.stage = "steps";
  tutorial.message = "Template image removed. Default covers will be used.";
  save(tutorial);
  return NextResponse.json({ ok: true });
}
