import fs from "fs";
import path from "path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import sharp from "sharp";
import { dir, get, Step } from "./store";
import { readActions } from "./timeline";

function safeName(value: string) {
  return String(value || "tutorial")
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "tutorial";
}

function projectFiles(id: string) {
  const d = dir(id);
  const t = get(id);
  const files: Array<{ name: string; data: Buffer }> = [];
  const screenshotDir = path.join(d, "screenshots");
  if (fs.existsSync(screenshotDir)) {
    for (const name of fs.readdirSync(screenshotDir).sort()) {
      const file = path.join(screenshotDir, name);
      if (fs.statSync(file).isFile()) files.push({ name: `screenshots/${name}`, data: fs.readFileSync(file) });
    }
  }
  if (t?.recording && fs.existsSync(t.recording)) {
    files.push({ name: "recording.webm", data: fs.readFileSync(t.recording) });
  }
  if (t?.steps?.length) {
    const steps = t.steps.map((s: Step, i: number) => `${i + 1}. ${s.title}\n${s.instruction}`);
    files.push({ name: "steps.txt", data: Buffer.from(steps.join("\n\n")) });
  }
  return files;
}

export async function createProjectBundle(id: string) {
  const t = get(id);
  if (!t) throw new Error("Tutorial not found.");
  const zip = new JSZip();
  for (const file of projectFiles(id)) zip.file(file.name, file.data);
  zip.file("tutorial.json", JSON.stringify(t, null, 2));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function createScreenshotsBundle(id: string) {
  const t = get(id);
  if (!t) throw new Error("Tutorial not found.");
  const screenshotDir = path.join(dir(id), "screenshots");
  const zip = new JSZip();
  const folder = zip.folder(safeName(t.name));
  if (!folder) throw new Error("Could not create the screenshot folder.");
  let count = 0;
  if (fs.existsSync(screenshotDir)) {
    for (const name of fs.readdirSync(screenshotDir).sort()) {
      const file = path.join(screenshotDir, name);
      if (!fs.statSync(file).isFile()) continue;
      folder.file(name, fs.readFileSync(file));
      count++;
    }
  }
  if (!count) throw new Error("No screenshots are available to download.");
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function createPptx(id: string): Promise<ArrayBuffer> {
  const t = get(id);
  if (!t) throw new Error("Tutorial not found.");
  const pptx = new PptxGenJS();
  const slideWidth = 13.333;
  const slideHeight = 7.5;
  pptx.defineLayout({
    name: "AUTOTUTORIAL_WIDE",
    width: slideWidth,
    height: slideHeight,
  });
  pptx.layout = "AUTOTUTORIAL_WIDE";
  pptx.author = "AutoTutorial AI";
  pptx.company = "Local-first tutorial studio";
  pptx.subject = "Interactive workflow tutorial";
  pptx.title = t.name;
  const colors = {
    navy: "0B1220",
    navySoft: "172033",
    accent: "6366F1",
    accentSoft: "EEF2FF",
    canvas: "F4F7FB",
    white: "FFFFFF",
    ink: "172033",
    muted: "667085",
    border: "DCE3EC",
    focus: "38BDF8",
  };
  const screenshotDir = path.join(dir(id), "screenshots");
  const screenshots = fs.existsSync(screenshotDir)
    ? fs
        .readdirSync(screenshotDir)
        .sort()
        .filter((name) => fs.statSync(path.join(screenshotDir, name)).isFile())
    : [];
  const actions = readActions(id).filter((action) =>
    ["click", "input", "select", "change", "navigation"].includes(
      action.type,
    ),
  );
  const stepSlides: Array<{ step: Step; action: any; name: string }> = [];
  for (const [stepOrder, step] of (t.steps || [])
    .filter((candidate) => candidate.action !== "introduction")
    .entries()) {
    const actionIndex = Number.isInteger(step.actionIndex)
      ? Number(step.actionIndex)
      : stepOrder;
    const action = actions[actionIndex];
    const name =
      action?.screenshot && screenshots.includes(action.screenshot)
        ? action.screenshot
        : screenshots[actionIndex];
    if (!name) continue;
    stepSlides.push({ step, action, name });
  }
  const slideCount = stepSlides.length;

  const intro = pptx.addSlide();
  intro.background = { color: colors.navy };
  intro.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.12,
    h: slideHeight,
    line: { color: colors.accent, transparency: 100 },
    fill: { color: colors.accent },
  });
  intro.addShape(pptx.ShapeType.ellipse, {
    x: 0.72,
    y: 0.62,
    w: 0.54,
    h: 0.54,
    line: { color: colors.accent, transparency: 100 },
    fill: { color: colors.accent },
  });
  intro.addText("A", {
    x: 0.72,
    y: 0.685,
    w: 0.54,
    h: 0.28,
    fontFace: "Aptos Display",
    fontSize: 15,
    bold: true,
    align: "center",
    color: colors.white,
    margin: 0,
  });
  intro.addText("AUTOTUTORIAL AI", {
    x: 1.42,
    y: 0.69,
    w: 2.4,
    h: 0.25,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    charSpacing: 1.8,
    color: "BFC7D5",
    margin: 0,
  });
  intro.addText("WORKFLOW GUIDE", {
    x: 0.78,
    y: 1.72,
    w: 3.2,
    h: 0.3,
    fontFace: "Aptos",
    fontSize: 11,
    bold: true,
    charSpacing: 2.2,
    color: "A5B4FC",
    margin: 0,
  });
  intro.addText(t.name, {
    x: 0.75,
    y: 2.18,
    w: 11.6,
    h: 1.35,
    fontFace: "Aptos Display",
    fontSize: 38,
    bold: true,
    color: colors.white,
    breakLine: true,
    fit: "shrink",
    margin: 0,
  });
  intro.addText(
    "A clear, step-by-step guide generated from the recorded workflow.",
    {
      x: 0.78,
      y: 3.78,
      w: 8.4,
      h: 0.5,
      fontFace: "Aptos",
      fontSize: 17,
      color: "C8D0DC",
      margin: 0,
    },
  );
  intro.addShape(pptx.ShapeType.line, {
    x: 0.78,
    y: 5.08,
    w: 11.75,
    h: 0,
    line: { color: "344054", width: 1 },
  });
  intro.addText(String(slideCount).padStart(2, "0"), {
    x: 0.78,
    y: 5.42,
    w: 1.1,
    h: 0.56,
    fontFace: "Aptos Display",
    fontSize: 26,
    bold: true,
    color: colors.white,
    margin: 0,
  });
  intro.addText("STEPS", {
    x: 0.8,
    y: 6.03,
    w: 1.2,
    h: 0.25,
    fontFace: "Aptos",
    fontSize: 9,
    bold: true,
    charSpacing: 1.3,
    color: "98A2B3",
    margin: 0,
  });
  intro.addText(
    new Date(t.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    {
      x: 2.55,
      y: 5.5,
      w: 3.1,
      h: 0.4,
      fontFace: "Aptos",
      fontSize: 15,
      bold: true,
      color: colors.white,
      margin: 0,
    },
  );
  intro.addText("CREATED", {
    x: 2.55,
    y: 6.03,
    w: 1.5,
    h: 0.25,
    fontFace: "Aptos",
    fontSize: 9,
    bold: true,
    charSpacing: 1.3,
    color: "98A2B3",
    margin: 0,
  });
  intro.addText("No typed input values are included.", {
    x: 8.1,
    y: 5.58,
    w: 4.4,
    h: 0.35,
    fontFace: "Aptos",
    fontSize: 11,
    italic: true,
    align: "right",
    color: "A5B4FC",
    margin: 0,
  });

  if (stepSlides.length) {
    for (const [index, item] of stepSlides.entries()) {
      const { step, action, name } = item;
      const file = path.join(screenshotDir, name);
      const metadata = await sharp(file).metadata();
      const sourceWidth = metadata.width || action?.viewportWidth || 1440;
      const sourceHeight = metadata.height || action?.viewportHeight || 800;
      const viewportWidth = action?.viewportWidth || metadata.width || 1440;
      const viewportHeight = action?.viewportHeight || metadata.height || 800;
      const contentLeft = 0.6665;
      // Header ends at 1.18 in. The 0.08 in image frame padding starts
      // exactly 6 px (6 / 96 in) below it.
      const contentTop = 1.18 + 6 / 96 + 0.08;
      const contentWidth = 12;
      const contentHeight = 5.68;
      const scale = Math.min(
        contentWidth / sourceWidth,
        contentHeight / sourceHeight,
      );
      const imageWidth = sourceWidth * scale;
      const imageHeight = sourceHeight * scale;
      const imageX = contentLeft + (contentWidth - imageWidth) / 2;
      const imageY = contentTop + (contentHeight - imageHeight) / 2;
      const slide = pptx.addSlide();
      slide.background = { color: colors.canvas };
      const image = fs.readFileSync(file).toString("base64");
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: slideWidth,
        h: 0.1,
        line: { color: colors.accent, transparency: 100 },
        fill: { color: colors.accent },
      });
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.55,
        y: 0.2,
        w: 12.233,
        h: 0.98,
        rectRadius: 0.05,
        line: { color: colors.border, width: 0.8 },
        fill: { color: colors.white },
      });
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.55,
        y: 0.2,
        w: 0.07,
        h: 0.98,
        line: { color: colors.accent, transparency: 100 },
        fill: { color: colors.accent },
      });
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.78,
        y: 0.35,
        w: 0.82,
        h: 0.32,
        rectRadius: 0.05,
        line: { color: "C7D2FE", width: 0.8 },
        fill: { color: colors.accentSoft },
      });
      slide.addText(`STEP ${String(index + 1).padStart(2, "0")}`, {
        x: 0.78,
        y: 0.445,
        w: 0.82,
        h: 0.13,
        fontFace: "Aptos",
        fontSize: 7.5,
        bold: true,
        align: "center",
        charSpacing: 0.7,
        color: colors.accent,
        margin: 0,
      });
      slide.addText(step?.title || `Step ${index + 1}`, {
        x: 1.84,
        y: 0.29,
        w: 7.55,
        h: 0.32,
        fontFace: "Aptos Display",
        fontSize: 16,
        bold: true,
        color: colors.ink,
        fit: "shrink",
        margin: 0,
      });
      slide.addText(t.name, {
        x: 9.65,
        y: 0.35,
        w: 2.72,
        h: 0.18,
        fontFace: "Aptos",
        fontSize: 7,
        bold: true,
        charSpacing: 0.5,
        align: "right",
        color: "98A2B3",
        fit: "shrink",
        margin: 0,
      });
      slide.addShape(pptx.ShapeType.line, {
        x: 0.78,
        y: 0.73,
        w: 11.6,
        h: 0,
        line: { color: "E8ECF2", width: 0.6 },
      });
      slide.addText(
        step?.instruction || action?.text || "Complete this action.",
        {
          x: 0.8,
          y: 0.84,
          w: 11.55,
          h: 0.22,
          fontFace: "Aptos",
          fontSize: 12,
          color: colors.muted,
          breakLine: true,
          fit: "shrink",
          margin: 0,
        },
      );
      slide.addShape(pptx.ShapeType.roundRect, {
        x: Math.max(contentLeft - 0.08, imageX - 0.08),
        y: Math.max(contentTop - 0.08, imageY - 0.08),
        w: Math.min(contentWidth + 0.16, imageWidth + 0.16),
        h: Math.min(contentHeight + 0.16, imageHeight + 0.16),
        rectRadius: 0.05,
        line: { color: colors.border, width: 1 },
        fill: { color: colors.white },
      });
      slide.addImage({
        data: `image/png;base64,${image}`,
        x: imageX,
        y: imageY,
        w: imageWidth,
        h: imageHeight,
      });
      if (
        ["click", "select", "change"].includes(action?.type) &&
        action.targetRect
      ) {
        const rect = action.targetRect;
        const highlightX = imageX + (rect.x / viewportWidth) * imageWidth;
        const highlightY = imageY + (rect.y / viewportHeight) * imageHeight;
        const highlightWidth = (rect.width / viewportWidth) * imageWidth;
        const highlightHeight = (rect.height / viewportHeight) * imageHeight;
        const highlightLeft = Math.max(imageX, highlightX - 0.04);
        const highlightTop = Math.max(imageY, highlightY - 0.04);
        const highlightRight = Math.min(
          imageX + imageWidth,
          highlightX + highlightWidth + 0.04,
        );
        const highlightBottom = Math.min(
          imageY + imageHeight,
          highlightY + highlightHeight + 0.04,
        );
        slide.addShape(pptx.ShapeType.roundRect, {
          x: highlightLeft,
          y: highlightTop,
          w: Math.max(0.01, highlightRight - highlightLeft),
          h: Math.max(0.01, highlightBottom - highlightTop),
          rectRadius: 0.06,
          fill: { color: colors.white, transparency: 100 },
          line: { color: colors.focus, width: 2.25 },
        });
      }
      slide.addShape(pptx.ShapeType.line, {
        x: 0.62,
        y: 7.14,
        w: 12.08,
        h: 0,
        line: { color: colors.border, width: 0.8 },
      });
      slide.addText("AUTOTUTORIAL AI", {
        x: 0.62,
        y: 7.25,
        w: 2,
        h: 0.18,
        fontFace: "Aptos",
        fontSize: 7.5,
        bold: true,
        charSpacing: 1.2,
        color: "98A2B3",
        margin: 0,
      });
      slide.addText(`${index + 1} / ${slideCount}`, {
        x: 11.55,
        y: 7.24,
        w: 1.15,
        h: 0.2,
        fontFace: "Aptos",
        fontSize: 8,
        bold: true,
        align: "right",
        color: colors.muted,
        margin: 0,
      });
    }
  }
  const output = await pptx.write({ outputType: "nodebuffer", compression: false });
  if (output instanceof Buffer) return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
  if (output instanceof ArrayBuffer) return output;
  if (output instanceof Uint8Array) return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
  return new TextEncoder().encode(String(output)).buffer;
}

export function projectFileName(id: string) {
  return `${safeName(get(id)?.name || "tutorial")}-project.zip`;
}

export function pptxFileName(id: string) {
  return `${safeName(get(id)?.name || "tutorial")}-tutorial.pptx`;
}

export function screenshotsFileName(id: string) {
  return `${safeName(get(id)?.name || "tutorial")}-screenshots.zip`;
}
