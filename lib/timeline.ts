import fs from "fs";
import path from "path";
import { dir, get, save, settings, Step } from "./store";
export const INTRO_DURATION_MS = 4000;
export type TimelineAction = {
  type: string;
  ts: number;
  activeMs?: number;
  screenshotMs?: number;
  screenshot?: string;
  interactionTs?: number;
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
export type Timeline = {
  version: 3;
  fps: number;
  width: number;
  height: number;
  baseTs: number;
  actions: TimelineAction[];
  steps: Step[];
};
export function readActions(id: string): TimelineAction[] {
  const p = path.join(dir(id), "actions.json");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((x) => JSON.parse(x));
}
export function buildTimeline(id: string): Timeline {
  const t = get(id);
  if (!t) throw new Error("Tutorial not found");
  const actions = readActions(id);
  const baseTs = actions.length ? Number(actions[0].ts) : Date.now();
  const normalized = actions.map((a) => ({
    ...a,
    activeMs: Number.isFinite(Number(a.activeMs))
      ? Number(a.activeMs)
      : Math.max(0, Number(a.ts) - baseTs),
  }));
  const steps = (t.steps || []).map((s) => ({
    ...s,
    startMs: Number(s.startMs) || 0,
    endMs: Math.max(Number(s.endMs) || 0, Number(s.startMs) || 0),
  }));
  const cfg = settings();
  const [width, height] = (cfg.resolution || "1920x1080")
    .split("x")
    .map((value: string) => Number(value) || 1920);
  const timeline: Timeline = {
    version: 3,
    fps: Number(cfg.fps) || 30,
    width,
    height,
    baseTs,
    actions: normalized,
    steps,
  };
  fs.writeFileSync(
    path.join(dir(id), "timeline.json"),
    JSON.stringify(timeline, null, 2),
  );
  t.stage = "rendering";
  t.message = "Building timeline and visual guidance…";
  t.progress = Math.max(1, t.progress || 1);
  save(t);
  return timeline;
}
