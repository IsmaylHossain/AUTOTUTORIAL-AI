import { NextResponse } from "next/server";
import { get, save } from "../../../../lib/store";
import { validateTutorialSteps } from "../../../../lib/ai";
import { renderActive } from "../../../../lib/render";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const { id, steps } = await req.json();
    const t = get(id);
    if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (renderActive(id)) return NextResponse.json({ error: "Cancel or finish the current render before saving edits." }, { status: 409 });
    if (!Array.isArray(steps)) return NextResponse.json({ error: "steps must be an array" }, { status: 400 });
    t.steps = steps.map((s: any, i: number) => {
      const previous = t.steps.find(old =>
        s.action === "introduction" ? old.action === "introduction" :
        Number.isInteger(s.actionIndex) ? old.action !== "introduction" && old.actionIndex === s.actionIndex :
        old.startMs === s.startMs && old.action === s.action && old.selector === s.selector);
      const title = String(s.title || `Step ${i + 1}`);
      const instruction = String(s.instruction || "Complete this step.");
      const textChanged = !previous || previous.title !== title || previous.instruction !== instruction;
      return {
        ...s, title, instruction,
        startMs: Number(s.startMs) || 0,
        endMs: Math.max(Number(s.endMs) || 0, Number(s.startMs) || 0),
        actionIndex: Number.isInteger(s.actionIndex) ? s.actionIndex : undefined,
        audio: textChanged ? undefined : previous.audio,
        audioText: textChanged ? undefined : previous.audioText,
        voiceSource: textChanged ? undefined : previous.voiceSource,
        value: ["input", "select", "change"].includes(s.action) ? undefined : s.value,
      };
    });
    t.status = "review"; t.stage = "steps"; t.progress = 0;
    t.message = "Edits saved. Render to use the updated steps and narration.";
    t.video = undefined;
    save(t);
    return NextResponse.json({ ok: true, validation: validateTutorialSteps(id) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Save failed." }, { status: 500 });
  }
}
