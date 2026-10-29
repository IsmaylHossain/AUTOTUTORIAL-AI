"use client";
import { useRef, useState } from "react";
type Cut={start:number;end:number};
export default function RecordingEditor({id,src,recording,disabled,saveSteps,onSaved,onBusy}: {
  id:string;src:string;recording:string;disabled:boolean;saveSteps:()=>Promise<void>;onSaved:()=>Promise<void>;onBusy:(busy:boolean)=>void;
}) {
  const video=useRef<HTMLVideoElement>(null);
  const [duration,setDuration]=useState(0);
  const [time,setTime]=useState(0);
  const [start,setStart]=useState(0);
  const [end,setEnd]=useState(0);
  const [cuts,setCuts]=useState<Cut[]>([]);
  const [preview,setPreview]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  function addCut() {
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration+0.1||end<=start) {
      setMessage("Choose an end time after the start, within the video."); return;
    }
    const merged:Cut[]=[];
    for(const cut of [...cuts,{start,end:Math.min(end,duration)}].sort((a,b)=>a.start-b.start)) {
      const last=merged.at(-1);
      if(last && cut.start<=last.end) last.end=Math.max(last.end,cut.end); else merged.push({...cut});
    }
    if(duration-merged.reduce((sum,c)=>sum+c.end-c.start,0)<0.25) {setMessage("Keep at least 0.25 seconds.");return;}
    setCuts(merged);setMessage("");
  }
  async function saveCuts() {
    if(!cuts.length || !confirm("Permanently remove the marked footage and any steps whose actions occur inside it? Unsaved step edits will also be saved. Removed footage cannot be restored.")) return;
    setBusy(true);onBusy(true);setPreview(false);video.current?.pause();
    setMessage("Saving and verifying edited video… Keep this page open.");
    try {
      await saveSteps();
      const response=await fetch("/api/tutorial/edit-video",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,recording,cuts})});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error||"Could not save cuts.");
      setCuts([]);
      setMessage(`Saved. ${result.removedSteps} linked steps removed. Render again to update the tutorial.${result.cleanupWarnings?.length ? " Some old files could not be deleted." : " Removed footage cannot be restored."}`);
      await onSaved();
    } catch(error:any) {setMessage(error.message||"Could not save cuts.");}
    finally {setBusy(false);onBusy(false);}
  }
  return <div className="mt-4 space-y-3">
    <div className="text-sm font-medium">Main recording · Edit video</div>
    <video ref={video} className="w-full rounded bg-black max-h-[420px]" controls src={src}
      onLoadedMetadata={()=>{setDuration(video.current?.duration||0);setTime(0);}}
      onTimeUpdate={()=>{const player=video.current;if(!player)return;
        if(preview&&!player.paused){const cut=cuts.find(c=>player.currentTime>=c.start&&player.currentTime<c.end);if(cut)player.currentTime=cut.end;}
        setTime(player.currentTime);}}/>
    <fieldset disabled={disabled||busy} className="space-y-3 disabled:opacity-60">
      <label className="block text-sm">Timeline · {time.toFixed(2)} / {duration.toFixed(2)} seconds
        <input aria-label="Recording timeline" type="range" min={0} max={duration||0} step={0.01} value={Math.min(time,duration)} className="w-full"
          onChange={e=>{if(video.current)video.current.currentTime=Number(e.target.value);setTime(Number(e.target.value));}}/>
      </label>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label>Start (seconds) <input className="input w-28" type="number" min={0} max={duration} step={0.01} value={start} onChange={e=>setStart(Number(e.target.value))}/></label>
        <button className="btn" onClick={()=>setStart(Number(time.toFixed(2)))}>Mark start</button>
        <label>End (seconds) <input className="input w-28" type="number" min={0} max={duration} step={0.01} value={end} onChange={e=>setEnd(Number(e.target.value))}/></label>
        <button className="btn" onClick={()=>setEnd(Number(time.toFixed(2)))}>Mark end</button>
        <button className="btn" onClick={addCut}>Remove section</button>
      </div>
      <p className="text-xs muted">Cuts affect only recorded footage, not welcome or Thank You pages. Actions inside cuts and their linked steps will be removed. Undo is available until Save.</p>
      {cuts.map((cut,index)=><div className="flex gap-3 items-center text-sm" key={`${cut.start}-${cut.end}`}>
        <span>Remove {cut.start.toFixed(2)}–{cut.end.toFixed(2)} s</span>
        <button className="btn" onClick={()=>setCuts(cuts.filter((_,i)=>i!==index))}>Undo</button>
      </div>)}
      {!!cuts.length && <div className="flex flex-wrap gap-3 items-center">
        <span className="text-sm">Edited length: {(duration-cuts.reduce((sum,c)=>sum+c.end-c.start,0)).toFixed(2)} s</span>
        <button className="btn" onClick={()=>{setPreview(true);if(video.current){video.current.currentTime=0;void video.current.play();}}}>Preview cuts</button>
        <button className="btn" onClick={()=>{setPreview(false);video.current?.pause();}}>Stop preview</button>
        <button className="btn btn-primary" onClick={saveCuts}>Save video edits</button>
      </div>}
    </fieldset>
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
