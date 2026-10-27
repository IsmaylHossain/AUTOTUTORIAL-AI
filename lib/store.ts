import fs from "fs";
import path from "path";
import os from "os";
import {
  AiProvider,
  DEFAULT_TTS_SETTINGS,
  defaultsForProvider,
  normalizeAiSettings,
} from "./ai-options";

export type Step = {
  title: string;
  instruction: string;
  startMs: number;
  endMs: number;
  action?: string;
  selector?: string;
  value?: string;
  audio?: string;
  actionIndex?: number;
  textSource?: "ai" | "local";
  voiceSource?: "edge" | "ai" | "local";
};
export type TutorialAction = {
  type: string;
  ts: number;
  activeMs?: number;
  screenshot?: string;
  x?: number;
  y?: number;
  text?: string;
  fieldLabel?: string;
  selectedText?: string;
  selector?: string;
  value?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  targetRect?: { x: number; y: number; width: number; height: number };
  focusRect?: { x: number; y: number; width: number; height: number };
  sensitive?: boolean;
  pickerOpen?: boolean;
};
export type PauseInterval = { startMs: number; endMs?: number };
export type Tutorial = {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  status: string;
  stage: string;
  message?: string;
  progress?: number;
  settings?: Record<string, unknown>;
  steps: Step[];
  recording?: string;
  video?: string;
  recordingStartedAt?: number;
  videoStartOffsetMs?: number;
  pauseIntervals?: PauseInterval[];
};

const configured = process.env.AUTOTUTORIAL_DATA_DIR?.trim();
const ROOT = path.resolve(
  configured || path.join(os.homedir(), ".autotutorial-ai"),
);
const DIR = path.join(ROOT, "tutorials");
const LEGACY = path.resolve("./data");
let migrated = false;

function migrateLegacy() {
  if (migrated || configured) {
    migrated = true;
    return;
  }
  if (LEGACY !== ROOT && fs.existsSync(LEGACY)) {
    fs.mkdirSync(ROOT, { recursive: true });
    const legacyTutorials = path.join(LEGACY, "tutorials");
    if (fs.existsSync(legacyTutorials)) {
      fs.mkdirSync(DIR, { recursive: true });
      for (const id of fs.readdirSync(legacyTutorials)) {
        const src = path.join(legacyTutorials, id),
          dst = path.join(DIR, id);
        if (fs.existsSync(src) && !fs.existsSync(dst))
          fs.cpSync(src, dst, { recursive: true });
      }
    }
    const legacySettings = path.join(LEGACY, "settings.json"),
      newSettings = path.join(ROOT, "settings.json");
    if (fs.existsSync(legacySettings) && !fs.existsSync(newSettings))
      fs.copyFileSync(legacySettings, newSettings);
  }
  migrated = true;
}
export function ensure() {
  migrateLegacy();
  fs.mkdirSync(DIR, { recursive: true });
}
function repairPaths(t: Tutorial) {
  const d = path.join(DIR, t.id);
  const repair = (v?: string) => {
    if (!v) return v;
    if (fs.existsSync(v)) return v;
    const b = path.basename(v);
    const candidates = [
      path.join(d, b),
      path.join(d, "audio", b),
      path.join(d, "screenshots", b),
    ];
    return candidates.find((x) => fs.existsSync(x)) || v;
  };
  t.recording = repair(t.recording);
  t.video = repair(t.video);
  t.steps = (t.steps || []).map((s) => ({ ...s, audio: repair(s.audio) }));
  return t;
}
export function dir(id: string) {
  ensure();
  const d = path.join(DIR, id);
  fs.mkdirSync(path.join(d, "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(d, "audio"), { recursive: true });
  return d;
}
export function save(t: Tutorial) {
  fs.writeFileSync(
    path.join(dir(t.id), "tutorial.json"),
    JSON.stringify(t, null, 2),
  );
}
export function get(id: string) {
  ensure();
  const p = path.join(DIR, id, "tutorial.json");
  if (!fs.existsSync(p)) return null;
  try {
    return repairPaths(JSON.parse(fs.readFileSync(p, "utf8")) as Tutorial);
  } catch {
    return null;
  }
}
export function all() {
  ensure();
  return fs
    .readdirSync(DIR)
    .map((id) => get(id))
    .filter(Boolean)
    .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
}
const environmentProvider: AiProvider =
  process.env.AI_PROVIDER === "gemini" ? "gemini" : "groq";
const environmentAiDefaults = defaultsForProvider(environmentProvider);
const defaults = {
  ...environmentAiDefaults,
  ...DEFAULT_TTS_SETTINGS,
  model:
    (environmentProvider === "gemini"
      ? process.env.GEMINI_MODEL
      : process.env.GROQ_MODEL) || environmentAiDefaults.model,
  voice: process.env.EDGE_TTS_VOICE || DEFAULT_TTS_SETTINGS.voice,
  speed: 1,
  resolution: "1440x800",
  fps: 30,
  quality: "high",
  outputFolder: "~/.autotutorial-ai/tutorials",
  screenRatio: "16:9",
};
export function settings() {
  ensure();
  const p = path.join(ROOT, "settings.json");
  if (!fs.existsSync(p)) return { ...defaults };
  try {
    const loaded = {
      ...defaults,
      ...JSON.parse(fs.readFileSync(p, "utf8")),
    };
    return { ...loaded, ...normalizeAiSettings(loaded) };
  } catch {
    return { ...defaults };
  }
}
export function saveSettings(s: any) {
  ensure();
  const safe = { ...settings(), ...s };
  delete safe.apiKey;
  delete safe.openaiApiKey;
  delete safe.groqApiKey;
  delete safe.geminiApiKey;
  delete safe.groqConfigured;
  delete safe.geminiConfigured;
  Object.assign(safe, normalizeAiSettings(safe));
  safe.speed = Math.min(2, Math.max(0.5, Number(safe.speed) || 1));
  safe.fps = Math.min(60, Math.max(24, Number(safe.fps) || 30));
  safe.quality = ["low", "medium", "high"].includes(safe.quality) ? safe.quality : defaults.quality;
  safe.resolution = ["1920x1080", "1280x720", "1440x800", "1080x1080", "1440x900"].includes(safe.resolution)
    ? safe.resolution
    : defaults.resolution;
  fs.writeFileSync(
    path.join(ROOT, "settings.json"),
    JSON.stringify(safe, null, 2),
  );
  return safe;
}
export function remove(id: string) {
  ensure();
  const d = path.join(DIR, id);
  if (!fs.existsSync(d)) return false;
  fs.rmSync(d, { recursive: true, force: true });
  return true;
}
export function rootDir() {
  ensure();
  return ROOT;
}
