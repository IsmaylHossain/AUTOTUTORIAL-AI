import fs from "fs";
import path from "path";
import Groq from "groq-sdk";
import { get, save, dir, Step, settings } from "./store";
import { generateTTS } from "./tts";
import { INTRO_DURATION_MS } from "./timeline";

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {}
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (m)
    try {
      return JSON.parse(m[1]);
    } catch {}
  const a = text.indexOf("{"),
    b = text.lastIndexOf("}");
  if (a >= 0 && b > a)
    try {
      return JSON.parse(text.slice(a, b + 1));
    } catch {}
  return {};
}
function localSteps(meaningful: any[]): Step[] {
  return meaningful.map((a: any, i: number) => ({
    title: titleFor(a),
    instruction: instructionFor(a),
    startMs: Number(a.activeMs ?? 0),
    endMs: Number(a.activeMs ?? 0) + 1500,
    action: a.type,
    selector: a.selector,
    value:
      a.type === "input" || a.type === "select"
        ? undefined
        : a.sensitive
          ? "[protected]"
          : a.value,
    actionIndex: i,
  }));
}
async function aiText(prompt: string) {
  const cfg = settings();
  if (cfg.provider === "gemini") {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new Error("Gemini API key is not configured. Add GEMINI_API_KEY to .env.local.");
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model || "gemini-2.5-flash")}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
        }),
      },
    );
    if (!response.ok) throw new Error(`Gemini analysis request failed (${response.status}).`);
    const body = await response.json() as any;
    return body.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("\n") || "";
  }
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error("Groq API key is not configured. Add GROQ_API_KEY to .env.local.");
  const client = new Groq({ apiKey: key });
  const model = cfg.model || "llama-3.3-70b-versatile";
  const r = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "Return only valid JSON. Be completely faithful to observed browser actions. Never invent actions, selectors, values, or UI. Preserve every meaningful action in order. Never reveal protected secrets.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
  });
  return r.choices[0]?.message?.content || "";
}
export async function analyze(id: string) {
  const t = get(id);
  if (!t) throw new Error("Tutorial not found");
  t.stage = "analyzing";
  t.progress = 10;
  t.message = "Understanding your demonstration with Groq…";
  save(t);
  const actionsPath = path.join(dir(id), "actions.json");
  const raw = fs.existsSync(actionsPath)
    ? fs.readFileSync(actionsPath, "utf8").trim()
    : "";
  const actions = raw
    ? raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((x) => JSON.parse(x))
        .filter(
          (a: any) =>
            a && typeof a.type === "string" && Number.isFinite(Number(a.ts)),
        )
    : [];
  const meaningful = actions
    .filter((a: any) =>
      ["click", "input", "select", "change", "navigation"].includes(a.type),
    )
    .map((a: any) =>
      ["input", "select", "change"].includes(a.type)
        ? { ...a, value: undefined, selectedText: undefined }
        : a,
    );
  if (!meaningful.length) {
    t.status = "review";
    t.stage = "review";
    t.progress = 0;
    t.message = actions.length
      ? "The recording contains events, but no meaningful click/input/change/navigation actions were captured."
      : "No usable actions were captured. Please re-record the demonstration.";
    save(t);
    return t;
  }
  const prompt = `Convert only these observed browser actions into tutorial steps. Return JSON {"steps":[{"title":"","instruction":"","startMs":0,"endMs":0,"action":"","selector":"","actionIndex":0}]}. Preserve every meaningful action in order, one step per meaningful action. Never invent UI. Never include typed text, selected options, or any field values. For input actions, say to enter the required information into the observed field label. For select actions, say to choose an option from the field label. For checkbox/radio changes, describe the control by its label and kind only. Actions:\n${JSON.stringify(meaningful)}`;
  let aiSteps: any[] = [];
  let usedLocal = false;
  try {
    const content = await aiText(prompt);
    if (content) {
      const obj = parseJson(content);
      aiSteps = Array.isArray(obj.steps) ? obj.steps : [];
    }
  } catch (e: any) {
    usedLocal = true;
    t.message = `${settings().provider === "gemini" ? "Gemini" : "Groq"} unavailable; using local step generation. ${e?.message || ""}`;
    save(t);
  }
  const local = localSteps(meaningful);
  const intro: Step = {
    title: "Introduction",
    instruction: `Welcome to ${t.name}.`,
    startMs: 0,
    endMs: INTRO_DURATION_MS,
    action: "introduction",
  };
  const steps: Step[] = [
    intro,
    ...local.map((fallback: any, i: number) => {
      const action = meaningful[i];
      const s = aiSteps[i] || {};
      const actionStart = Number.isFinite(Number(action.activeMs))
        ? Number(action.activeMs)
        : fallback.startMs;
      const start = actionStart + INTRO_DURATION_MS;
      const actionEnd =
        Number(s.endMs) > actionStart
          ? Number(s.endMs) + INTRO_DURATION_MS
          : fallback.endMs + INTRO_DURATION_MS;
      const instruction =
        action.type === "input"
          ? `Enter the required information in ${action.fieldLabel || "the selected text field"}.`
          : action.type === "select"
            ? `Choose an option from ${action.fieldLabel || "the dropdown"}.`
            : action.type === "change"
              ? `${action.fieldKind === "radio" ? "Select the radio option" : action.fieldKind === "checkbox" ? "Toggle the checkbox" : "Change the control"}${action.fieldLabel ? ` for ${action.fieldLabel}` : ""}.`
              : String(s.instruction || fallback.instruction);
      const title =
        action.type === "input"
          ? `Enter information in ${action.fieldLabel || "the text field"}`
          : action.type === "select"
            ? `Choose an option from ${action.fieldLabel || "the dropdown"}`
            : action.type === "change"
              ? `${action.fieldKind === "radio" ? "Select radio option" : action.fieldKind === "checkbox" ? "Toggle checkbox" : "Change control"}${action.fieldLabel ? ` · ${action.fieldLabel}` : ""}`
              : String(s.title || fallback.title);
      return {
        title,
        instruction,
        startMs: start,
        endMs: Math.max(start + 900, actionEnd),
        action: action.type,
        selector: action.selector,
        value: ["input", "select", "change"].includes(action.type)
          ? undefined
          : action.sensitive
            ? "[protected]"
            : s.value,
        actionIndex: i,
      };
    }),
  ];
  t.steps = steps;
  t.stage = "narrating";
  t.status = "processing";
  t.progress = 50;
  t.message = `${usedLocal ? "Using local" : "Creating"} narration for ${steps.length} steps…`;
  save(t);
  for (let i = 0; i < t.steps.length; i++) {
    const current = get(id);
    if (!current) throw new Error("Tutorial not found");
    current.stage = "narrating";
    current.status = "processing";
    current.progress = 50 + Math.round((i / Math.max(1, t.steps.length)) * 40);
    current.message = `Generating narration ${i + 1} of ${t.steps.length}…`;
    save(current);
    try {
      await generateTTS(id, i);
    } catch (e: any) {
      const latest = get(id);
      if (latest) {
        latest.message = `Narration ${i + 1} unavailable; you can retry it from review.`;
        save(latest);
      }
    }
  }
  const done = get(id)!;
  done.stage = "steps";
  done.progress = 90;
  done.status = "review";
  done.message = `${actions.length} captured events · ${steps.length} meaningful tutorial steps`;
  save(done);
  return done;
}
export function validateTutorialSteps(id: string) {
  const t = get(id);
  if (!t) throw new Error("Tutorial not found");
  const p = path.join(dir(id), "actions.json");
  const actions = fs.existsSync(p)
    ? fs
        .readFileSync(p, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((x) => JSON.parse(x))
        .filter(
          (a: any) =>
            a &&
            ["click", "input", "select", "change", "navigation"].includes(
              a.type,
            ) &&
            Number.isFinite(Number(a.ts)),
        )
    : [];
  const issues: string[] = [];
  t.steps = (t.steps || []).map((s: any, i: number) => {
    if (s.action === "introduction") return s;
    const action = actions[Number.isInteger(s.actionIndex) ? s.actionIndex : i];
    if (!action) {
      issues.push(`Step ${i + 1} has no matching captured action.`);
      return s;
    }
    if (["input", "select", "change"].includes(action.type))
      s.value = undefined;
    if (
      !Number.isFinite(Number(s.startMs)) ||
      !Number.isFinite(Number(s.endMs)) ||
      Number(s.endMs) < Number(s.startMs)
    ) {
      issues.push(`Step ${i + 1} has invalid timing.`);
      s.startMs = Number(action.activeMs ?? action.ts);
      s.endMs = s.startMs + 1500;
    }
    if (
      s.value &&
      /AIza|AQ\.|sk-|ghp_|xox[baprs]-|Bearer\s+/i.test(String(s.value))
    ) {
      s.value = "[protected]";
      issues.push(`Step ${i + 1} contained a redacted secret pattern.`);
    }
    return s;
  });
  save(t);
  return {
    ok: issues.length === 0,
    issues,
    actions: actions.length,
    steps: t.steps.length,
  };
}
export async function regenerateStep(id: string, index: number) {
  const t = get(id);
  if (!t) throw new Error("Tutorial not found");
  if (index < 0 || index >= t.steps.length) throw new Error("Step not found");
  const step = t.steps[index];
  if (step.action === "introduction") return step;
  const p = path.join(dir(id), "actions.json");
  const actions = fs.existsSync(p)
    ? fs
        .readFileSync(p, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((x) => JSON.parse(x))
        .filter(
          (a: any) =>
            a &&
            ["click", "input", "select", "change", "navigation"].includes(
              a.type,
            ) &&
            Number.isFinite(Number(a.ts)),
        )
    : [];
  const rawActionIndex = step.actionIndex;
  const actionIndex =
    typeof rawActionIndex === "number" && Number.isInteger(rawActionIndex)
      ? rawActionIndex
      : index;
  const a = actions[actionIndex] || actions[index];
  if (!a) throw new Error("No captured action is available for this step.");
  const safeAction = ["input", "select", "change"].includes(a.type)
    ? { ...a, value: undefined, selectedText: undefined }
    : a;
  const prompt = `Rewrite one tutorial step using only this observed action. Return JSON {"title":"...","instruction":"..."}. Never invent UI or values. Never include text typed into a field or selected option. Action: ${JSON.stringify(safeAction)}`;
  let obj: any = { title: titleFor(a), instruction: instructionFor(a) };
  try {
    const content = await aiText(prompt);
    if (content) obj = { ...obj, ...parseJson(content) };
  } catch {}
  const formControl = ["input", "select", "change"].includes(a.type);
  t.steps[index] = {
    ...step,
    title: formControl ? titleFor(a) : String(obj.title || titleFor(a)),
    instruction: formControl
      ? instructionFor(a)
      : String(obj.instruction || instructionFor(a)),
    startMs: Number(step.startMs ?? a.activeMs ?? a.ts),
    endMs: Number(
      step.endMs ?? Number(step.startMs ?? a.activeMs ?? a.ts) + 1500,
    ),
    action: a.type,
    selector: a.selector,
    value: formControl ? undefined : a.sensitive ? "[protected]" : step.value,
    audio: undefined,
    actionIndex: actionIndex,
  };
  t.status = "review";
  t.stage = "steps";
  t.video = undefined;
  save(t);
  return t.steps[index];
}
function titleFor(a: any) {
  if (a.type === "click") return `Click ${a.text || "the selected control"}`;
  if (a.type === "input")
    return `Enter information in ${a.fieldLabel || "the text field"}`;
  if (a.type === "select")
    return `Choose an option from ${a.fieldLabel || "the dropdown"}`;
  if (a.type === "change")
    return `${a.fieldKind === "radio" ? "Select radio option" : a.fieldKind === "checkbox" ? "Toggle checkbox" : "Change control"}${a.fieldLabel ? ` · ${a.fieldLabel}` : ""}`;
  return "Continue to the next page";
}
function instructionFor(a: any) {
  if (a.type === "click") return `Click ${a.text || "the selected control"}.`;
  if (a.type === "input")
    return `Enter the required information in ${a.fieldLabel || "the selected text field"}.`;
  if (a.type === "select")
    return `Choose an option from ${a.fieldLabel || "the dropdown"}.`;
  if (a.type === "change")
    return `${a.fieldKind === "radio" ? "Select the radio option" : a.fieldKind === "checkbox" ? "Toggle the checkbox" : "Change the control"}${a.fieldLabel ? ` for ${a.fieldLabel}` : ""}.`;
  return "Continue to the next page.";
}
