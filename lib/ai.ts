import fs from "fs";
import path from "path";
import Groq from "groq-sdk";
import { dir, get, save, settings, Step, Tutorial } from "./store";
import { generateTTS } from "./tts";
import { INTRO_DURATION_MS } from "./timeline";
import { normalizeAiSettings } from "./ai-options";

type AiConfig = ReturnType<typeof tutorialAiSettings>;

function tutorialAiSettings(tutorial: Tutorial) {
  const merged = { ...settings(), ...(tutorial.settings || {}) };
  return { ...merged, ...normalizeAiSettings(merged) };
}

function providerName(config: AiConfig) {
  return config.provider === "gemini" ? "Gemini" : "Groq";
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  throw new Error("AI returned invalid JSON.");
}

async function requestAiJson<T>(
  prompt: string,
  config: AiConfig,
  schema: Record<string, unknown>,
): Promise<T> {
  if (config.provider === "gemini") {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key)
      throw new Error(
        "Gemini API key is not configured. Add it in Settings.",
      );
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: "Create faithful tutorial copy from observed browser actions. Preserve each action type: clicks must never become data entry. Never invent controls, actions, selectors, or values. Never expose secrets or entered field values.",
              },
            ],
          },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseFormat: {
              text: { mimeType: "APPLICATION_JSON", schema },
            },
          },
        }),
      },
    );
    const raw = await response.text();
    if (!response.ok) {
      let detail = "";
      try {
        detail = JSON.parse(raw)?.error?.message || "";
      } catch {}
      throw new Error(
        `Gemini request failed (${response.status})${detail ? `: ${detail}` : "."}`,
      );
    }
    const body = JSON.parse(raw);
    const text = body.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text || "")
      .join("\n")
      .trim();
    if (!text)
      throw new Error(
        `Gemini returned no text${body.promptFeedback?.blockReason ? `: ${body.promptFeedback.blockReason}` : "."}`,
      );
    return parseJson(text) as T;
  }

  const key = process.env.GROQ_API_KEY?.trim();
  if (!key)
    throw new Error("Groq API key is not configured. Add it in Settings.");
  const client = new Groq({ apiKey: key });
  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      {
        role: "system",
        content:
          "Return only valid JSON. Create faithful tutorial copy from observed browser actions. Preserve each action type: clicks must never become data entry. Never invent controls, actions, selectors, or values. Never expose secrets or entered field values.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });
  const text = response.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq returned no text.");
  return parseJson(text) as T;
}

function readActions(id: string) {
  const file = path.join(dir(id), "actions.json");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter(
      (action: any) =>
        action &&
        typeof action.type === "string" &&
        Number.isFinite(Number(action.ts)),
    );
}

function meaningfulActions(actions: any[]) {
  const types = ["click", "input", "select", "change", "navigation"];
  let recordedActionIndex = -1;
  const meaningful = actions.flatMap((action: any, sourceIndex: number) => {
    if (!types.includes(action.type)) return [];
    recordedActionIndex++;
    const safe = { ...action, recordedActionIndex };
    delete safe.value;
    delete safe.selectedText;
    if (safe.sensitive) safe.text = "[protected control]";
    if (safe.type === "click") {
      for (let index = sourceIndex + 1; index < actions.length; index++) {
        const candidate = actions[index];
        if (candidate?.url && candidate.url !== action.url) {
          safe.resultUrl = candidate.url;
          safe.resultTitle = candidate.title;
          break;
        }
        if (types.includes(candidate?.type)) break;
      }
    }
    return [safe];
  });
  return meaningful.filter((action: any) => {
    if (action.pickerOpen) {
      const hasDateSelection = meaningful.some(
        (candidate: any) =>
          candidate.type === "click" &&
          !candidate.pickerOpen &&
          isCalendarAction(candidate) &&
          Number(candidate.ts || 0) >= Number(action.ts || 0) &&
          Number(candidate.ts || 0) - Number(action.ts || 0) <= 15000,
      );
      if (hasDateSelection) return false;
    }
    if (action.type !== "input") return true;
    const dateHint = `${action.fieldLabel || ""} ${action.selector || ""} ${action.fieldKind || ""}`;
    if (!/date|calendar|datepicker|date-picker|dp[-_]/i.test(dateHint))
      return true;
    return !meaningful.some((candidate: any) => {
      if (candidate.type !== "click" || !candidate.pickerOpen) return false;
      const elapsed = Math.abs(
        Number(candidate.ts || 0) - Number(action.ts || 0),
      );
      if (elapsed > 15000) return false;
      return (
        (candidate.selector && candidate.selector === action.selector) ||
        (candidate.fieldLabel && candidate.fieldLabel === action.fieldLabel)
      );
    });
  });
}

function resolveActionPosition(
  actions: any[],
  recordedActionIndex: number | undefined,
  fallbackPosition: number,
  expectedActiveMs?: number,
) {
  if (Number.isInteger(recordedActionIndex)) {
    const stablePosition = actions.findIndex(
      (action) =>
        Number(action.recordedActionIndex) === Number(recordedActionIndex),
    );
    const legacyPosition =
      Number(recordedActionIndex) >= 0 &&
      Number(recordedActionIndex) < actions.length
        ? Number(recordedActionIndex)
        : -1;
    if (
      stablePosition >= 0 &&
      legacyPosition >= 0 &&
      stablePosition !== legacyPosition &&
      Number.isFinite(Number(expectedActiveMs))
    ) {
      const stableDistance = Math.abs(
        Number(actions[stablePosition]?.activeMs || 0) -
          Number(expectedActiveMs),
      );
      const legacyDistance = Math.abs(
        Number(actions[legacyPosition]?.activeMs || 0) -
          Number(expectedActiveMs),
      );
      return legacyDistance < stableDistance ? legacyPosition : stablePosition;
    }
    if (stablePosition >= 0) return stablePosition;
    if (legacyPosition >= 0) return legacyPosition;
    return -1;
  }
  return fallbackPosition >= 0 && fallbackPosition < actions.length
    ? fallbackPosition
    : -1;
}

const copySchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    instruction: { type: "string" },
  },
  required: ["title", "instruction"],
  additionalProperties: false,
};

function tutorialSchema(stepCount: number) {
  return {
    type: "object",
    properties: {
      introduction: copySchema,
      steps: {
        type: "array",
        minItems: stepCount,
        maxItems: stepCount,
        items: copySchema,
      },
    },
    required: ["introduction", "steps"],
    additionalProperties: false,
  };
}

function validatedCopy(value: any, label: string) {
  const title = String(value?.title || "").trim().slice(0, 140);
  const instruction = String(value?.instruction || "").trim().slice(0, 500);
  if (!title || !instruction)
    throw new Error(`AI omitted the ${label} title or instruction.`);
  return { title, instruction };
}

function cleanLabel(value: unknown, fallback: string) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s*[*:]+\s*$/, "")
    .trim();
  return text && text !== "[protected control]" ? text.slice(0, 90) : fallback;
}

function sentenceLabel(value: string) {
  if (!value || value.startsWith("the ")) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function withArticle(value: string) {
  const label = sentenceLabel(value);
  return /^(the|a|an)\s/i.test(label) ? label : `the ${label}`;
}

function selectorSuggests(action: any, pattern: RegExp) {
  return pattern.test(
    `${action.selector || ""} ${action.controlRole || ""} ${action.controlLabel || ""}`,
  );
}

function isCalendarAction(action: any) {
  return selectorSuggests(
    action,
    /calendar|datepicker|date-picker|dp--|flatpickr|react-datepicker/i,
  );
}

function isOptionAction(action: any) {
  return selectorSuggests(
    action,
    /(^|[.\s>_-])li([.\s>_-]|$)|menuitem|option|dropdown-item|listbox/i,
  );
}

function isButtonAction(action: any, label: string) {
  return (
    selectorSuggests(action, /button|submit|btn/i) ||
    /^(submit|save|create|add|cancel|delete|remove|close|login|sign in|next|back|finish|confirm|apply|update|continue)$/i.test(
      label,
    )
  );
}

function isFieldLike(label: string) {
  return /name|category|unit|date|status|supplier|customer|type|quantity|price|reference|description|email|password|address|country|city|phone/i.test(
    label,
  );
}

function actionControl(action: any) {
  const selector = String(action.selector || "");
  const fallback = /xmark|close/i.test(selector)
    ? "Close"
    : /submit/i.test(selector)
      ? "Submit"
      : "the highlighted control";
  return cleanLabel(
    action.controlLabel || action.text || action.ariaLabel,
    fallback,
  );
}

function localActionCopy(action: any, index = 0, actions: any[] = []) {
  const field = cleanLabel(action.fieldLabel, "selected field");
  const control = cleanLabel(
    action.controlLabel || action.text || action.ariaLabel,
    actionControl(action),
  );
  const previous = index > 0 ? actions[index - 1] : undefined;
  const next = index + 1 < actions.length ? actions[index + 1] : undefined;
  const previousControl = previous ? actionControl(previous) : "";
  const contextField = cleanLabel(action.contextLabel, "");

  if (action.pickerOpen)
    return {
      title: `Open ${field} picker`,
      instruction: `Open ${withArticle(field)} date picker.`,
    };

  if (action.type === "input")
    return {
      title: `Enter ${field}`,
      instruction: `Enter ${withArticle(field)}.`,
    };
  if (action.type === "select")
    return {
      title: `Choose ${field}`,
      instruction: `Choose an option from ${withArticle(field)}.`,
    };
  if (action.type === "change") {
    if (action.fieldKind === "checkbox")
      return {
        title: `Set ${field}`,
        instruction: `Set ${withArticle(field)} checkbox as required.`,
      };
    if (action.fieldKind === "radio")
      return {
        title: `Choose ${field}`,
        instruction: `Choose an option for ${withArticle(field)}.`,
      };
    if (/date|time|month|week/.test(action.fieldKind || ""))
      return {
        title: `Select ${field}`,
        instruction: `Select ${withArticle(field)}.`,
      };
    return {
      title: `Update ${field}`,
      instruction: `Update ${withArticle(field)}.`,
    };
  }
  if (action.type === "navigation") {
    const destination = cleanLabel(action.title, "next page");
    return {
      title: `Go to ${destination}`,
      instruction: `Go to ${withArticle(destination)}.`,
    };
  }
  if (isCalendarAction(action)) {
    const dateField = isFieldLike(contextField)
      ? contextField
      : isFieldLike(previousControl)
        ? previousControl
        : "date";
    return {
      title: `Select ${dateField}`,
      instruction: `Select ${withArticle(dateField)}.`,
    };
  }
  if (isOptionAction(action)) {
    const optionField = isFieldLike(contextField)
      ? contextField
      : previous && isFieldLike(previousControl)
        ? previousControl
        : "";
    if (optionField)
      return {
        title: `Choose ${optionField}`,
        instruction: `Choose an option for ${withArticle(optionField)}.`,
      };
    return {
      title: `Select ${control}`,
      instruction: `Select ${control}.`,
    };
  }
  if (next && isOptionAction(next) && isFieldLike(control))
    return {
      title: `Open ${control}`,
      instruction: `Open ${withArticle(control)} list.`,
    };
  if (isButtonAction(action, control))
    return {
      title: `Click ${control}`,
      instruction: `Click ${withArticle(control)} button.`,
    };
  if (action.resultUrl)
    return {
      title: `Go to ${control}`,
      instruction: `Go to ${withArticle(control)}.`,
    };
  return {
    title: `Click ${control}`,
    instruction: `Click ${withArticle(control)}.`,
  };
}

function localTutorialCopy(tutorial: Tutorial, actions: any[]) {
  return {
    introduction: {
      title: `Welcome to '${tutorial.name}' Tutorial.`,
      instruction: `Welcome to '${tutorial.name}' Tutorial.`,
    },
    steps: actions.map(localActionCopy),
  };
}

function standardizeGeneratedCopy(
  copy: { title: string; instruction: string },
  action: any,
  index: number,
  actions: any[],
  projectName: string,
) {
  const validated = validatedCopy(copy, `step ${index + 1}`);
  const local = localActionCopy(action, index, actions);
  const combined = `${validated.title} ${validated.instruction}`.toLowerCase();
  const project = projectName.trim().toLowerCase();
  const control = actionControl(action).toLowerCase();
  const expectedVerb = local.title.split(/\s+/)[0].toLowerCase();
  const titleVerb = validated.title.split(/\s+/)[0].toLowerCase();
  const instructionVerb = validated.instruction.split(/\s+/)[0].toLowerCase();
  const verbMismatch =
    titleVerb !== expectedVerb || instructionVerb !== expectedVerb;
  const hasWrongVerb =
    (action.type === "click" && /\b(enter|fill|type|provide)\b/.test(combined)) ||
    (action.type === "input" && /\b(click|select|choose|open|go to)\b/.test(combined));
  const vague =
    /recorded workflow|workflow requirements|to continue with|continue with the project|proceed with the project/.test(
      combined,
    );
  const repeatsProject =
    !!project && combined.includes(project) && !control.includes(project);
  return verbMismatch || hasWrongVerb || vague || repeatsProject || isCalendarAction(action)
    ? local
    : validated;
}

function actionForPrompt(action: any, index: number, actions: any[]) {
  const local = localActionCopy(action, index, actions);
  return {
    stepNumber: index + 1,
    type: action.type,
    expectedVerb: local.title.split(/\s+/)[0],
    control: actionControl(action),
    field: cleanLabel(action.fieldLabel, ""),
    fieldKind: action.fieldKind || "",
    elementRole: action.controlRole || "",
    contextField: cleanLabel(action.contextLabel, ""),
    isMenuOption: isOptionAction(action),
    isDateSelection: isCalendarAction(action),
    opensDatePicker: !!action.pickerOpen,
    navigatesTo: action.resultTitle || "",
  };
}

function markFailed(id: string, error: unknown) {
  const tutorial = get(id);
  if (!tutorial) return;
  tutorial.status = "failed";
  tutorial.stage = "failed";
  tutorial.progress = 0;
  tutorial.message =
    error instanceof Error ? error.message : "AI generation failed.";
  save(tutorial);
}

export async function analyze(id: string) {
  const tutorial = get(id);
  if (!tutorial) throw new Error("Tutorial not found");
  const config = tutorialAiSettings(tutorial);
  tutorial.stage = "analyzing";
  tutorial.status = "processing";
  tutorial.progress = 10;
  tutorial.message = `Generating tutorial text with ${providerName(config)} · ${config.model}…`;
  save(tutorial);

  const actions = readActions(id);
  const meaningful = meaningfulActions(actions);
  if (!meaningful.length) {
    tutorial.status = "review";
    tutorial.stage = "review";
    tutorial.progress = 0;
    tutorial.message = actions.length
      ? "The recording contains events, but no meaningful actions were captured."
      : "No usable actions were captured. Please re-record the demonstration.";
    save(tutorial);
    return tutorial;
  }

  try {
    const prompt = [
      `Project: ${tutorial.name}`,
      `Website: ${tutorial.url}`,
      "Generate a brief introduction plus exactly one tutorial step for each observed action.",
      "Write each title in 2-7 words and each instruction as one short imperative sentence.",
      "Match the observed action exactly: use Go to for navigation, Click for buttons, Enter for text inputs, Choose for dropdown fields, and Select for menu options or dates.",
      "Examples: Go to the Products section. Click Actions. Select Create Product. Enter the product name. Choose a product category. Select the unit. Select the order date. Click the Submit button. Click the Cancel button.",
      "Never use Enter, Fill, Type, or Provide for a click action.",
      "Never mention the project name inside an action step.",
      "Never add filler such as 'to continue', 'recorded workflow', 'workflow requirements', or 'review it before continuing'.",
      "For input, select, and change actions, name the observed field without revealing entered values or sensitive data.",
      `Return exactly ${meaningful.length} items in steps, in the same order as the actions.`,
      `Observed actions: ${JSON.stringify(meaningful.map(actionForPrompt))}`,
    ].join("\n");
    let usedLocalText = false;
    let generated: {
      introduction: { title: string; instruction: string };
      steps: { title: string; instruction: string }[];
    };
    try {
      generated = await requestAiJson(prompt, config, tutorialSchema(meaningful.length));
      if (!Array.isArray(generated.steps) || generated.steps.length !== meaningful.length)
        throw new Error(
          `AI returned ${generated.steps?.length || 0} steps for ${meaningful.length} actions.`,
        );
      validatedCopy(generated.introduction, "introduction");
      generated.steps = generated.steps.map((step, index) =>
        standardizeGeneratedCopy(
          step,
          meaningful[index],
          index,
          meaningful,
          tutorial.name,
        ),
      );
    } catch (error: any) {
      usedLocalText = true;
      generated = localTutorialCopy(tutorial, meaningful);
      tutorial.message = `Cloud text unavailable; using professional local templates. ${error?.message || ""}`;
      save(tutorial);
    }

    const introCopy = localTutorialCopy(tutorial, []).introduction;
    const steps: Step[] = [
      {
        ...introCopy,
        startMs: 0,
        endMs: INTRO_DURATION_MS,
        action: "introduction",
        textSource: usedLocalText ? "local" : "ai",
      },
      ...meaningful.map((action: any, index: number): Step => {
        const copy = validatedCopy(generated.steps[index], `step ${index + 1}`);
        const actionStart = Math.max(0, Number(action.activeMs) || 0);
        const startMs = actionStart + INTRO_DURATION_MS;
        return {
          ...copy,
          startMs,
          endMs: startMs + 1500,
          action: action.type,
          selector: action.selector,
          value: action.sensitive ? "[protected]" : undefined,
          actionIndex: Number.isInteger(action.recordedActionIndex)
            ? action.recordedActionIndex
            : index,
          textSource: usedLocalText ? "local" : "ai",
        };
      }),
    ];

    tutorial.steps = steps;
    tutorial.stage = "narrating";
    tutorial.progress = 50;
    tutorial.message = `Generating ${steps.length} narration segments with Microsoft Edge Neural TTS or the local system voice…`;
    save(tutorial);

    for (let index = 0; index < steps.length; index++) {
      const current = get(id);
      if (!current) throw new Error("Tutorial not found");
      current.stage = "narrating";
      current.status = "processing";
      current.progress = 50 + Math.round((index / Math.max(1, steps.length)) * 40);
      current.message = `Generating narration ${index + 1} of ${steps.length} · Microsoft Edge · ${config.voice}…`;
      save(current);
      await generateTTS(id, index);
    }

    const done = get(id)!;
    done.stage = "steps";
    done.progress = 90;
    done.status = "review";
    const localVoiceCount = done.steps.filter((step) => step.voiceSource === "local").length;
    done.message = `${steps.length} steps ready · text: ${usedLocalText ? "local templates" : providerName(config)} · voice: ${localVoiceCount ? `${localVoiceCount} local fallback segment${localVoiceCount === 1 ? "" : "s"}` : "Microsoft Edge TTS"}.`;
    save(done);
    return done;
  } catch (error) {
    markFailed(id, error);
    throw error;
  }
}

export function validateTutorialSteps(id: string) {
  const tutorial = get(id);
  if (!tutorial) throw new Error("Tutorial not found");
  const actions = meaningfulActions(readActions(id));
  const issues: string[] = [];
  tutorial.steps = (tutorial.steps || []).map((step: any, index: number) => {
    if (step.action === "introduction") return step;
    const actionPosition = resolveActionPosition(
      actions,
      Number.isInteger(step.actionIndex) ? Number(step.actionIndex) : undefined,
      index - 1,
      Number(step.startMs) - INTRO_DURATION_MS,
    );
    const action = actionPosition >= 0 ? actions[actionPosition] : undefined;
    if (!action) {
      issues.push(`Step ${index + 1} has no matching captured action.`);
      return step;
    }
    step.value = action.sensitive ? "[protected]" : undefined;
    if (
      !Number.isFinite(Number(step.startMs)) ||
      !Number.isFinite(Number(step.endMs)) ||
      Number(step.endMs) < Number(step.startMs)
    ) {
      issues.push(`Step ${index + 1} has invalid timing.`);
      step.startMs = Number(action.activeMs || 0) + INTRO_DURATION_MS;
      step.endMs = step.startMs + 1500;
    }
    return step;
  });
  save(tutorial);
  return {
    ok: issues.length === 0,
    issues,
    actions: actions.length,
    steps: tutorial.steps.length,
  };
}

export async function regenerateStep(id: string, index: number) {
  const tutorial = get(id);
  if (!tutorial) throw new Error("Tutorial not found");
  if (index < 0 || index >= tutorial.steps.length)
    throw new Error("Step not found");
  const config = tutorialAiSettings(tutorial);
  const step = tutorial.steps[index];
  let prompt: string;
  if (step.action === "introduction") {
    prompt = `Rewrite a concise, welcoming introduction for the ${JSON.stringify(tutorial.name)} tutorial. Return a short title and one natural instruction sentence. Do not invent workflow details.`;
  } else {
    const actions = meaningfulActions(readActions(id));
    const actionIndex = resolveActionPosition(
      actions,
      Number.isInteger(step.actionIndex) ? Number(step.actionIndex) : undefined,
      index - 1,
      Number(step.startMs) - INTRO_DURATION_MS,
    );
    const action = actions[actionIndex];
    if (!action) throw new Error("No captured action is available for this step.");
    const context = {
      previous:
        actionIndex > 0
          ? actionForPrompt(actions[actionIndex - 1], actionIndex - 1, actions)
          : null,
      current: actionForPrompt(action, actionIndex, actions),
      next:
        actionIndex + 1 < actions.length
          ? actionForPrompt(actions[actionIndex + 1], actionIndex + 1, actions)
          : null,
    };
    prompt = `Rewrite only the current action as one concise tutorial step. Return title and one imperative instruction. Start both with the current action's expectedVerb. Never say "to continue" or mention the project name. Never include entered values or sensitive data. Context: ${JSON.stringify(context)}`;
  }
  let generated: { title: string; instruction: string };
  let textSource: "ai" | "local" = "ai";
  try {
    generated = await requestAiJson(prompt, config, copySchema);
    if (step.action !== "introduction") {
      const actions = meaningfulActions(readActions(id));
      const actionIndex = resolveActionPosition(
        actions,
        Number.isInteger(step.actionIndex) ? Number(step.actionIndex) : undefined,
        index - 1,
        Number(step.startMs) - INTRO_DURATION_MS,
      );
      if (actionIndex < 0)
        throw new Error("No captured action is available for this step.");
      generated = standardizeGeneratedCopy(
        generated,
        actions[actionIndex],
        actionIndex,
        actions,
        tutorial.name,
      );
    } else validatedCopy(generated, `step ${index + 1}`);
  } catch {
    textSource = "local";
    if (step.action === "introduction") {
      generated = {
        title: `Welcome to ${tutorial.name}`,
        instruction: `Follow this tutorial to complete the recorded workflow step by step.`,
      };
    } else {
      const actions = meaningfulActions(readActions(id));
      const actionIndex = resolveActionPosition(
        actions,
        Number.isInteger(step.actionIndex) ? Number(step.actionIndex) : undefined,
        index - 1,
        Number(step.startMs) - INTRO_DURATION_MS,
      );
      if (actionIndex < 0)
        throw new Error("No captured action is available for this step.");
      generated = localActionCopy(actions[actionIndex], actionIndex, actions);
    }
  }
  const copy = validatedCopy(generated, `step ${index + 1}`);
  tutorial.steps[index] = {
    ...step,
    ...copy,
    audio: undefined,
    textSource,
    voiceSource: undefined,
  };
  tutorial.status = "review";
  tutorial.stage = "steps";
  tutorial.message = `Step ${index + 1} regenerated with ${textSource === "ai" ? providerName(config) : "local templates"}.`;
  tutorial.video = undefined;
  save(tutorial);
  return tutorial.steps[index];
}
