import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { dir, get } from "./store";
import { readActions, INTRO_DURATION_MS } from "./timeline";
import { recordingPreview } from "./recording-preview";
import { ffmpegPath, readMediaDuration } from "./media";

const globalState = globalThis as typeof globalThis & { videoEditLocks?: Set<string> };
const locks = globalState.videoEditLocks ||= new Set<string>();
export const videoEditActive = (id: string) => locks.has(id);
export type Cut = { start: number; end: number }; // seconds in current active recording
export function normalizeCuts(input: unknown, duration: number): Cut[] {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error("Choose 1–100 sections to remove.");
  const sorted = input.map(c => {
    if (!c || typeof c.start !== "number" || typeof c.end !== "number" || !Number.isFinite(c.start) || !Number.isFinite(c.end)
      || c.start < 0 || c.end > duration + 0.1 || c.end <= c.start) throw new Error("Invalid cut range.");
    return { start: c.start, end: Math.min(c.end, duration) };
  }).sort((a,b) => a.start-b.start);
  const result: Cut[] = [];
  for (const cut of sorted) {
    const last = result.at(-1);
    if (last && cut.start <= last.end) last.end = Math.max(last.end, cut.end);
    else result.push({...cut});
  }
  if (duration-result.reduce((sum,c)=>sum+c.end-c.start,0)<0.25) throw new Error("Keep at least 0.25 seconds of recording.");
  return result;
}
export function mapEditedTime(ms: number, cuts: Cut[]) {
  return Math.max(0, ms-cuts.reduce((sum,c)=>sum+Math.max(0,Math.min(ms,c.end*1000)-c.start*1000),0));
}
export async function editRecording(id: string, input: unknown, expectedRecording: string) {
  if (locks.has(id)) throw new Error("Video edits are already saving.");
  locks.add(id);
  let committed = false;
  const root = dir(id);
  const token = randomUUID();
  const output = path.join(root, `recording-edited-${token}.mp4`);
  const actionsName = `actions-edited-${token}.json`;
  const actionsOutput = path.join(root, actionsName);
  const metadataTemp = path.join(root, `tutorial-${token}.tmp`);
  try {
    const t = get(id);
    if (!t?.recording || t.recording !== expectedRecording) throw new Error("Recording changed. Reload before editing.");
    if (!["review","ready","error"].includes(t.status)) throw new Error("Finish recording, analysis, or rendering before editing video.");
    const snapshot = JSON.stringify(t);
    const source = await recordingPreview(id);
    const duration = readMediaDuration(source);
    if (!(duration>0)) throw new Error("Cannot read recording duration.");
    const cuts = normalizeCuts(input,duration);
    const removed = (ms: number) => cuts.some(c=>ms>=c.start*1000 && ms<c.end*1000);
    const actions = readActions(id);
    const base = Number(actions[0]?.ts || 0) - (Number.isFinite(actions[0]?.activeMs) ? actions[0].activeMs! : 0);
    const at = (a: any) => Number.isFinite(a.activeMs) ? a.activeMs : Math.max(0,a.ts-base);
    const interactions = actions.filter(a=>["click","input","select","change","navigation"].includes(a.type));
    const retained = actions.filter(a=>!removed(at(a)));
    const newInteractions = retained.filter(a=>interactions.includes(a));
    const mappedActions = retained.map(a=>({...a, activeMs:mapEditedTime(at(a),cuts),
      ts:base+mapEditedTime(at(a),cuts),
      screenshotMs:a.screenshotMs === undefined ? undefined : mapEditedTime(a.screenshotMs,cuts)}));
    let interactionIndex = 0;
    let removedSteps = 0;
    const steps = t.steps.flatMap(step=>{
      if(step.action === "introduction") return [step];
      const action = interactions[Number.isInteger(step.actionIndex)?step.actionIndex!:interactionIndex];
      interactionIndex++;
      const timestamp = action ? at(action) : Math.max(0,step.startMs-INTRO_DURATION_MS);
      if(removed(timestamp)) { removedSteps++; return []; }
      return [{...step, actionIndex:action ? newInteractions.indexOf(action) : undefined,
        startMs:INTRO_DURATION_MS+mapEditedTime(Math.max(0,step.startMs-INTRO_DURATION_MS),cuts),
        endMs:INTRO_DURATION_MS+mapEditedTime(Math.max(0,step.endMs-INTRO_DURATION_MS),cuts)}];
    });
    const ranges: Cut[]=[];
    let cursor=0;
    for(const cut of cuts) { if(cut.start>cursor) ranges.push({start:cursor,end:cut.start}); cursor=cut.end; }
    if(cursor<duration) ranges.push({start:cursor,end:duration});
    const filters=ranges.map((r,i)=>`[0:v]trim=start=${r.start}:end=${r.end},setpts=PTS-STARTPTS[v${i}]`);
    filters.push(`${ranges.map((_,i)=>`[v${i}]`).join("")}concat=n=${ranges.length}:v=1:a=0[out]`);
    const binary=ffmpegPath();
    if(!binary) throw new Error("FFmpeg is required for video editing.");
    await new Promise<void>((resolve,reject)=>{
      const proc=spawn(binary,["-y","-filter_complex_threads","1","-i",source,"-filter_complex",filters.join(";"),
        "-map","[out]","-an","-c:v","libx264","-preset","veryfast","-crf","18","-pix_fmt","yuv420p","-movflags","+faststart",output],
        {stdio:["ignore","ignore","pipe"]});
      let error="";
      proc.stderr.on("data",chunk=>{error=(error+chunk.toString()).slice(-8000);});
      proc.on("error",reject);
      proc.on("close",code=>code===0?resolve():reject(new Error(error||"Video editing failed.")));
    });
    const expected=ranges.reduce((sum,r)=>sum+r.end-r.start,0);
    const actual=readMediaDuration(output);
    if(!(actual>0) || Math.abs(actual-expected)>Math.max(0.2,ranges.length/15)) throw new Error("Edited video failed verification. Original kept.");
    if(JSON.stringify(get(id))!==snapshot) throw new Error("Project changed while saving cuts. Original kept; retry.");
    fs.writeFileSync(actionsOutput,mappedActions.map(a=>JSON.stringify(a)).join("\n"));
    const updated={...t,steps,recording:output,recordingIsActive:true,actionsFile:actionsName,
      videoOutdated:!!t.video,status:"review",stage:"steps",progress:0,message:`Video edits saved. ${removedSteps} linked steps removed. Render again.`};
    fs.writeFileSync(metadataTemp,JSON.stringify(updated,null,2));
    fs.renameSync(metadataTemp,path.join(root,"tutorial.json"));
    committed=true;
    // Delete only the exact replaced recording and its derived active preview.
    const protectedFiles=[output,t.video,t.music,t.templateImage].filter(Boolean).map(f=>path.resolve(f!));
    const cleanupWarnings: string[]=[];
    for(const file of new Set([t.recording,source])) {
      if(path.dirname(path.resolve(file))!==path.resolve(root) || protectedFiles.includes(path.resolve(file))) continue;
      try { if(fs.lstatSync(file).isFile()) fs.unlinkSync(file); } catch { cleanupWarnings.push(path.basename(file)); }
    }
    return {removedSteps,duration:actual,cleanupWarnings};
  } finally {
    if(!committed) for(const file of [output,actionsOutput,metadataTemp]) { if(fs.existsSync(file)) fs.unlinkSync(file); }
    locks.delete(id);
  }
}
