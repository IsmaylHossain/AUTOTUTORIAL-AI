"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Circle, Square, RefreshCw, Pause, Play, X } from "lucide-react";

export default function RecordPage() {
  const { id } = useParams<{id:string}>();
  const router = useRouter();
  const [state,setState]=useState<any>(null);
  const [confirm,setConfirm]=useState(false);
  const [cancelConfirm,setCancelConfirm]=useState(false);
  const [err,setErr]=useState("");
  const [recovering,setRecovering]=useState(false);
  const [cancelling,setCancelling]=useState(false);

  async function poll() {
    const r=await fetch(`/api/record/status?id=${id}`,{cache:"no-store"});
    if(r.ok) setState(await r.json());
  }
  useEffect(()=>{ poll(); const x=setInterval(poll,1000); return ()=>clearInterval(x)},[id]);

  async function togglePause() {
    const endpoint=state.paused?"/api/record/resume":"/api/record/pause";
    const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})});
    const d=await r.json();
    if(!r.ok) setErr(d.error||"Couldn't change recording state."); else poll();
  }

  async function recover() {
    setRecovering(true); setErr("");
    const r=await fetch("/api/record/recover",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})});
    const d=await r.json(); setRecovering(false);
    if(!r.ok){setErr(d.error||"Could not recover the recording.");return}
    router.push(`/process/${id}`);
  }

  async function stop() {
    const r=await fetch("/api/record/stop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})});
    const d=await r.json();
    if(!r.ok){setErr(d.error||"Couldn't stop recording.");return}
    router.push(`/process/${id}`);
  }

  async function cancelRecording() {
    setCancelling(true); setErr("");
    const r=await fetch("/api/record/cancel",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){setCancelling(false);setErr(d.error||"Couldn't cancel recording.");return}
    router.push("/");
  }

  if(!state) return <div className="p-10">Loading recorder…</div>;
  return <div className="h-screen flex flex-col">
    <header className="h-16 border-b border-[#272e37] flex items-center justify-between px-6">
      <div><div className="font-medium">Browser recording</div><div className="text-xs muted">{state.url}</div></div>
      <div className="flex items-center gap-3"><span className="badge"><Circle size={8} fill={state.loading?"#f0b429":state.paused?"#f0b429":"#45d483"} strokeWidth={0}/>{state.interrupted?"Interrupted":state.loading?"Loading website":state.paused?"Paused":"Recording"} {format(state.elapsed)}</span><span className="text-sm muted">{state.actions} actions</span>{state.interrupted&&<button className="btn" onClick={recover} disabled={recovering}>{recovering?"Recovering…":"Recover recording"}</button>}<button className="btn" onClick={togglePause} disabled={state.loading||state.interrupted}>{state.paused?<><Play size={15} className="inline mr-2"/>Resume</>:<><Pause size={15} className="inline mr-2"/>Pause</>}</button><button className="btn" onClick={()=>setCancelConfirm(true)} disabled={cancelling}><X size={15} className="inline mr-2"/>Cancel</button><button className="btn btn-danger" onClick={()=>setConfirm(true)} disabled={state.loading||state.interrupted}><Square size={15} className="inline mr-2"/>Stop</button></div>
    </header>
    <div className="flex-1 grid place-items-center bg-[#090b0e]">
      <div className="text-center">
        <div className="text-xl font-medium">Use the Chromium window that opened</div>
        <div className="muted mt-2">{state.loading?"Waiting for the website to finish loading. Recording starts automatically afterward.":"Demonstrate the complete workflow naturally. Pause when needed; paused actions are ignored. Sensitive fields are masked in captured screenshots."}</div>
        <div className="mt-6 flex justify-center"><button className="btn" onClick={poll}><RefreshCw size={15} className="inline mr-2"/>Refresh capture status</button></div>
      </div>
    </div>
    <footer className="border-t border-[#272e37] px-6 py-4 text-sm muted">● Recording · Avoid unnecessary actions · Passwords and detected secrets are excluded from AI analysis.</footer>
    {confirm&&<div className="fixed inset-0 bg-black/70 grid place-items-center"><div className="card p-6 w-[420px]"><h2 className="text-lg font-semibold">Stop recording?</h2><p className="muted text-sm mt-2">Your demonstration will be saved and converted into a tutorial.</p><div className="flex justify-end gap-2 mt-6"><button className="btn" onClick={()=>setConfirm(false)}>Continue Recording</button><button className="btn btn-primary" onClick={stop}>Stop & Analyze</button></div>{err&&<div className="text-red-400 text-sm mt-3">{err}</div>}</div></div>}
    {cancelConfirm&&<div className="fixed inset-0 bg-black/70 grid place-items-center"><div className="card p-6 w-[420px]"><h2 className="text-lg font-semibold">Cancel recording?</h2><p className="muted text-sm mt-2">This closes the recording browser and permanently removes this unfinished recording, its actions, and screenshots.</p><div className="flex justify-end gap-2 mt-6"><button className="btn" onClick={()=>setCancelConfirm(false)} disabled={cancelling}>Keep Recording</button><button className="btn btn-danger" onClick={cancelRecording} disabled={cancelling}>{cancelling?"Cancelling…":"Cancel & Delete"}</button></div>{err&&<div className="text-red-400 text-sm mt-3">{err}</div>}</div></div>}
  </div>
}
function format(sec:number){const m=Math.floor(sec/60).toString().padStart(2,"0");const s=Math.floor(sec%60).toString().padStart(2,"0");return `${m}:${s}`}
