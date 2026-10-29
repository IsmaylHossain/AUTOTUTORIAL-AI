"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import RecordingEditor from "./RecordingEditor";
import {
  ArrowDown,
  ArrowUp,
  Play,
  Save,
  Trash2,
  Volume2,
  RotateCcw,
  Download,
  Highlighter,
  Pencil,
  Check,
  X,
  ImagePlus,
  Music2,
} from "lucide-react";

export default function TutorialPage() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<any>();
  const [msg, setMsg] = useState("");
  const [rendering, setRendering] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [scrub, setScrub] = useState(0);
  const [assets, setAssets] = useState<any>(null);
  const [busyStep, setBusyStep] = useState(-1);
  const [editingStep, setEditingStep] = useState(-1);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [musicBusy, setMusicBusy] = useState(false);
  const [videoEditing, setVideoEditing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  async function load() {
    const r = await fetch(`/api/tutorial?id=${id}`, { cache: "no-store" });
    if (r.ok) {
      const tutorial = await r.json();
      setT(tutorial);
      setRendering(tutorial.status === "rendering");
    }
    const a = await fetch(`/api/assets?id=${id}`, { cache: "no-store" });
    if (a.ok) setAssets(await a.json());
  }
  useEffect(() => {
    load();
  }, [id]);
  useEffect(() => {
    if (!rendering) return;
    const x = setInterval(async () => {
      const r = await fetch(`/api/render/status?id=${id}`);
      if (r.ok) {
        const d = await r.json();
        setT((v: any) => (v ? { ...v, ...d } : d));
        if (!d.active && (d.status === "ready" || d.status === "review")) {
          setMsg(d.message || "Render finished.");
          setRendering(false);
          load();
        }
      }
    }, 1500);
    return () => clearInterval(x);
  }, [rendering, id]);
  async function save() {
    const r = await fetch("/api/tutorial/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, steps: t.steps }),
    });
    const d = await r.json();
    setMsg(
      r.ok
        ? d.validation?.issues?.length
          ? `Saved with ${d.validation.issues.length} validation warning(s).`
          : "Saved. Render again to update the video."
        : d.error || "Save failed.",
    );
    load();
  }
  async function updateStep(i: number) {
    const r = await fetch("/api/tutorial/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, steps: t.steps }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(d.error || "Step update failed.");
      return;
    }
    setEditingStep(-1);
    setMsg(
      `Step ${i + 1} updated. Regenerate its voice and render to apply changes to the video.`,
    );
    load();
  }
  async function cancel() {
    await fetch("/api/render/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setRendering(false);
    setMsg("Render cancelled.");
    load();
  }
  async function render() {
    setMsg("Rendering final video…");
    setRendering(true);
    const r = await fetch("/api/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setRendering(false);
      setMsg(d.error || "Render failed.");
      load();
      return;
    }
    setMsg(d.started ? "Rendering final video…" : "This project is already rendering.");
    await load();
  }
  async function renameTutorial() {
    const next = window.prompt("Tutorial name", t.name || "");
    if (!next || !next.trim()) return;
    const r = await fetch(`/api/tutorial?id=${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name: next.trim() }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(d.error || "Could not rename tutorial.");
      return;
    }
    setT((v: any) => (v ? { ...v, name: next.trim() } : v));
    setMsg("Tutorial renamed.");
  }
  async function uploadTemplate(file?: File) {
    if (!file) return;
    setTemplateBusy(true);
    setMsg("Preparing template image…");
    const form = new FormData();
    form.set("id", id);
    form.set("image", file);
    const r = await fetch("/api/tutorial/template", { method: "POST", body: form });
    const d = await r.json().catch(() => ({}));
    setTemplateBusy(false);
    if (!r.ok) {
      setMsg(d.error || "Template image upload failed.");
      return;
    }
    setMsg("Template saved. It will be used on the PPTX cover and ending, and the video opening and ending.");
    await load();
  }
  async function removeTemplate() {
    setTemplateBusy(true);
    const r = await fetch(`/api/tutorial/template?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const d = await r.json().catch(() => ({}));
    setTemplateBusy(false);
    setMsg(r.ok ? "Template removed. Default design restored." : d.error || "Could not remove template.");
    if (r.ok) await load();
  }
  async function uploadMusic(file?: File) {
    if (!file) return;
    setMusicBusy(true);
    setMsg("Checking music file…");
    const form = new FormData();
    form.set("id", id);
    form.set("music", file);
    const r = await fetch("/api/tutorial/music", { method: "POST", body: form });
    const d = await r.json().catch(() => ({}));
    setMusicBusy(false);
    if (!r.ok) {
      setMsg(d.error || "Music upload failed.");
      return;
    }
    setMsg("Music saved. The next render will use music without step narration.");
    await load();
  }
  async function removeMusic() {
    setMusicBusy(true);
    const r = await fetch(`/api/tutorial/music?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const d = await r.json().catch(() => ({}));
    setMusicBusy(false);
    setMsg(
      r.ok
        ? "Music removed. Step narration will be used again."
        : d.error || "Could not remove music.",
    );
    if (r.ok) await load();
  }
  async function downloadScreenshots() {
    if (!assets?.screenshots?.length) return;
    setBusyStep(997);
    setMsg(`Preparing all ${assets.screenshots.length} screenshots…`);
    const response = await fetch("/api/export/screenshots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    setBusyStep(-1);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setMsg(data.error || "Screenshot download failed.");
      return;
    }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${String(t.name || "tutorial").replace(/[^a-z0-9._-]+/gi, "-")}-screenshots.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
    setMsg(`Downloaded all ${assets.screenshots.length} screenshots in the ${t.name} folder.`);
  }  async function exportProject() {
    setBusyStep(999);
    setMsg("Preparing project folder…");
    const response = await fetch("/api/export/project", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    setBusyStep(-1);
    if (!response.ok) { setMsg("Project export failed."); return; }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${t.name.replace(/[^a-z0-9._-]+/gi, "-")}-project.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
    setMsg("Project folder downloaded.");
  }
  async function exportPptx() {
    setBusyStep(998);
    setMsg("Building PowerPoint presentation…");
    const response = await fetch("/api/export/pptx", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    setBusyStep(-1);
    if (!response.ok) { setMsg("PowerPoint export failed."); return; }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${t.name.replace(/[^a-z0-9._-]+/gi, "-")}-tutorial.pptx`;
    link.click();
    URL.revokeObjectURL(link.href);
    setMsg("PowerPoint presentation downloaded.");
  }  function playNarration(i: number) {
    if (!t.steps[i]?.audio) {
      setMsg("Generate narration for this step first.");
      return;
    }
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    const a = new Audio(`/api/audio?id=${id}&index=${i}&v=${Date.now()}`);
    a.play().catch(() =>
      setMsg(
        "Narration audio could not be played. Generate or re-render the narration for this step.",
      ),
    );
    setAudio(a);
  }
  async function regenerate(i: number) {
    setBusyStep(i);
    setMsg(`Regenerating Step ${i + 1}…`);
    const r = await fetch("/api/tutorial/regenerate-step", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, index: i }),
    });
    const d = await r.json();
    setBusyStep(-1);
    if (!r.ok) {
      setMsg(d.error || "Step regeneration failed.");
      return;
    }
    const a = [...t.steps];
    a[i] = d.step;
    setT({ ...t, steps: a, videoUrl: null });
    setMsg(`Step ${i + 1} regenerated. Save and render when ready.`);
  }
  async function tts(i: number) {
    setMsg(`Generating narration for Step ${i + 1}…`);
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, index: i }),
    });
    const d = await r.json().catch(() => ({}));
    setMsg(
      r.ok
        ? d.source === "local"
          ? "Microsoft Edge voice unavailable. Local system narration is ready."
          : "New Microsoft Edge narration is ready."
        : d.error || "Voice generation failed.",
    );
    load();
  }
  function del(i: number) {
    setT({ ...t, steps: t.steps.filter((_: any, j: number) => j !== i) });
  }
  function move(i: number, d: number) {
    const a = [...t.steps];
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    setT({ ...t, steps: a });
  }
  function seek(i: number) {
    if (t.videoOutdated) {
      setMsg("Render again to synchronize video playback with the edited steps.");
      return;
    }
    const s = t.steps[i];
    if (videoRef.current && s) {
      const openingMs = Number(t.videoOpeningMs) || 0;
      const stepOffsetMs = t.videoStepOffsetMs ?? openingMs;
      videoRef.current.currentTime = Math.max(
        0,
        (s.action === "introduction" ? openingMs : s.startMs + stepOffsetMs) / 1000,
      );
      videoRef.current.play().catch(() => {});
    }
  }
  if (!t) return <div className="p-10">Loading…</div>;
  const base = t.steps[0]?.startMs || 0;
  const total = Math.max(
    1,
    (t.steps[t.steps.length - 1]?.endMs || base) - base,
  );
  const openingMs = Number(t.videoOpeningMs) || 0;
  const stepOffsetMs = t.videoStepOffsetMs ?? openingMs;
  const stepVideoMs = (s: any) => Math.max(0, s.action === "introduction" ? openingMs : s.startMs + stepOffsetMs);
  const videoTimelineTotal = Math.max(1, ...t.steps.map((s: any) => s.endMs + stepOffsetMs));
  return (
    <fieldset disabled={videoEditing} className="p-8 max-w-7xl mx-auto min-w-0">
      <header className="flex justify-between items-start gap-5">
        <div>
          <h1 className="text-3xl font-semibold">
            {t.name || "Generated Tutorial"}
          </h1>
          <p className="muted mt-1">
            Generated from your demonstration · {t.steps.length} steps
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn" onClick={renameTutorial}>
            Rename
          </button>
          <button className="btn" onClick={save}>
            <Save size={15} className="inline mr-2" />
            Save
          </button>
          <button
            className="btn btn-primary"
            disabled={rendering}
            onClick={render}
          >
            {rendering
              ? `Rendering ${t.progress || 0}%`
              : `${t.videoUrl ? "Re-render" : "Render Tutorial"}`}
          </button>
          {rendering && (
            <button className="btn btn-danger" onClick={cancel}>
              Cancel Render
            </button>
          )}
          {t.videoUrl && (
            <a className="btn" href={t.videoUrl} download>
              <Download size={15} className="inline mr-2" />
              Export MP4
            </a>
          )}
          <button className="btn" onClick={exportProject} disabled={busyStep === 999}>
            <Download size={15} className="inline mr-2" />
            {busyStep === 999 ? "Preparing…" : "Download Project"}
          </button>
          <button className="btn" onClick={exportPptx} disabled={busyStep === 998}>
            <Download size={15} className="inline mr-2" />
            {busyStep === 998 ? "Building…" : "Download PPTX"}
          </button>
          {assets?.screenshots?.length ? (
            <button className="btn" onClick={downloadScreenshots} disabled={busyStep === 997}>
              {busyStep === 997 ? "Preparing Screenshots…" : "Download All Screenshots"}
            </button>
          ) : null}
        </div>
      </header>
      <div className="card p-5 mt-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ImagePlus size={21} className="mt-0.5 shrink-0 text-indigo-400" />
            <div>
              <h2 className="font-semibold">Tutorial template image</h2>
              <p className="muted text-sm mt-1">
                Used for the PPTX first and last pages and the video opening and ending. A polished default is used when no image is added.
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <label className={`btn ${templateBusy ? "opacity-60 pointer-events-none" : ""}`}>
              {templateBusy ? "Processing…" : t.templateImageUrl ? "Replace image" : "Add image"}
              <input
                className="hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={templateBusy}
                onChange={(e) => uploadTemplate(e.currentTarget.files?.[0])}
              />
            </label>
            {t.templateImageUrl && (
              <button className="btn btn-danger" disabled={templateBusy} onClick={removeTemplate}>
                Remove
              </button>
            )}
          </div>
        </div>
        {t.templateImageUrl && (
          <img
            src={t.templateImageUrl}
            alt="Tutorial template preview"
            className="mt-4 w-full max-h-64 aspect-video object-cover rounded border border-[#272e37]"
          />
        )}
      </div>
      <div className="card p-5 mt-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Music2 size={21} className="mt-0.5 shrink-0 text-sky-400" />
            <div>
              <h2 className="font-semibold">Video music</h2>
              <p className="muted text-sm mt-1">
                Optional. When music is selected, the rendered video uses it instead of all step narration.
              </p>
              {t.musicName && (
                <p className="text-sm mt-2">Selected: {t.musicName}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <label className={`btn ${musicBusy ? "opacity-60 pointer-events-none" : ""}`}>
              {musicBusy ? "Checking…" : t.musicUrl ? "Replace music" : "Add music"}
              <input
                className="hidden"
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.aiff,.aif"
                disabled={musicBusy}
                onChange={(e) => uploadMusic(e.currentTarget.files?.[0])}
              />
            </label>
            {t.musicUrl && (
              <button className="btn btn-danger" disabled={musicBusy} onClick={removeMusic}>
                Remove
              </button>
            )}
          </div>
        </div>
        {t.musicUrl && (
          <audio className="mt-4 w-full" controls preload="metadata" src={t.musicUrl} />
        )}
      </div>
      <div className="card p-5 mt-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Captured assets</h2>
            <p className="muted text-sm mt-1">
              Inspect what the recorder actually collected before rendering.
            </p>
          </div>
          <div className="text-xs muted">
            {assets?.screenshots?.length || 0} screenshots
          </div>
        </div>
        {assets?.hasRecording && (
          <RecordingEditor id={id} src={assets.recordingUrl} recording={t.recording} disabled={rendering||busyStep>=0||musicBusy||templateBusy} onBusy={setVideoEditing}
            onSaved={load} saveSteps={async()=>{
              const response=await fetch("/api/tutorial/update",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,steps:t.steps})});
              const result=await response.json();
              if(!response.ok) throw new Error(result.error||"Save step edits first.");
            }}/>
        )}
        {assets?.screenshots?.length ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
            {assets.screenshots.map((x: any) => (
              <a
                key={x.name}
                href={x.url}
                target="_blank"
                rel="noreferrer"
                className="block"
              >
                <img
                  src={x.url}
                  alt={x.name}
                  className="w-full aspect-video object-cover rounded border border-[#272e37]"
                />
                <div className="text-[11px] muted mt-1 truncate">{x.name}</div>
              </a>
            ))}
          </div>
        ) : (
          <div className="muted text-sm mt-4">
            No interaction screenshots were captured yet.
          </div>
        )}
      </div>
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-5 mt-8">
        <div className="space-y-3">
          <div className="card overflow-hidden">
            {t.videoUrl && t.videoOutdated && (
              <div role="status" className="px-4 py-3 text-sm text-amber-300 bg-amber-950/30">
                Outdated — showing the previous render. Render again to apply your edits.
              </div>
            )}
            <div className="aspect-video bg-black grid place-items-center">
              {t.videoUrl ? (
                <video
                  ref={videoRef}
                  className="w-full h-full"
                  controls
                  src={t.videoUrl}
                  onTimeUpdate={(e) => {
                    const sec = e.currentTarget.currentTime || 0;
                    setScrub(sec * 1000);
                    if (t.videoOutdated) { setCurrent(-1); return; }
                    if (sec * 1000 < openingMs) {
                      setCurrent(-1);
                      return;
                    }
                    const tm = Math.max(0, sec * 1000 - stepOffsetMs);
                    const idx = t.steps.findIndex(
                      (x: any) => tm >= x.startMs && tm <= x.endMs,
                    );
                    if (idx >= 0) setCurrent(idx);
                  }}
                />
              ) : (
                <div className="muted">
                  Recorded video preview will appear after rendering.
                </div>
              )}
            </div>
          </div>
          {t.videoUrl && !t.videoOutdated && (
            <div className="card p-4">
              <div className="flex justify-between text-xs muted mb-2">
                <span>Timeline</span>
                <span>{Math.round(scrub / 1000)}s</span>
              </div>
              <input
                type="range"
                min="0"
                max={videoTimelineTotal}
                value={scrub}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setScrub(v);
                  if (videoRef.current) videoRef.current.currentTime = v / 1000;
                }}
                className="w-full"
              />
              <div className="relative h-7 mt-2">
                {t.steps.map((s: any, i: number) => (
                  <button
                    key={i}
                    onClick={() => {
                      const v = stepVideoMs(s);
                      setScrub(v);
                      if (videoRef.current)
                        videoRef.current.currentTime = v / 1000;
                    }}
                    className="absolute top-0 text-[10px] muted"
                    style={{
                      left: `${Math.min(96, Math.max(0, (stepVideoMs(s) / videoTimelineTotal) * 100))}%`,
                    }}
                  >
                    ● {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
          {rendering && (
            <div className="card p-4">
              <div className="flex justify-between text-sm">
                <span>{t.message || "Rendering tutorial…"}</span>
                <span>{t.progress || 0}%</span>
              </div>
              <div className="h-2 bg-[#20242b] rounded-full mt-3 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all"
                  style={{ width: `${t.progress || 0}%` }}
                />
              </div>
            </div>
          )}
          <div className="card p-4 text-sm muted flex gap-3">
            <Highlighter size={18} className="shrink-0" />
            <span>
              <b>Highlighter guidance:</b> important targets are emphasized with
              a tight sky-blue rounded focus border at the interaction moment.
              No fill, zooming, or camera movement is used.
            </span>
          </div>
          <div className="card p-4 text-sm muted">
            AI interprets your demonstration — it does not invent the workflow.
            Editing a step does not change the original recording.
          </div>
        </div>
        <div className="space-y-3 max-h-[75vh] overflow-auto">
          {t.steps.map((s: any, i: number) => (
            <div
              className={`card p-4 ${current === i ? "ring-2 ring-indigo-500" : ""}`}
              key={i}
            >
              <div className="flex justify-between gap-3">
                <button className="text-left min-w-0" onClick={() => seek(i)}>
                  <div className="text-xs muted">
                    Step {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="font-medium mt-1 flex items-center gap-2">
                    <Play size={13} /> {s.title}
                  </div>
                </button>
                <div className="flex gap-1 shrink-0">
                  <button
                    className="btn p-2"
                    onClick={() => move(i, -1)}
                    title="Move up"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="btn p-2"
                    onClick={() => move(i, 1)}
                    title="Move down"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    className="btn p-2"
                    onClick={() => setEditingStep(editingStep === i ? -1 : i)}
                    title={editingStep === i ? "Cancel editing" : "Edit step"}
                  >
                    {editingStep === i ? <X size={14} /> : <Pencil size={14} />}
                  </button>
                  <button
                    className="btn p-2 btn-danger"
                    onClick={() => del(i)}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {editingStep === i ? (
                <>
                  <input
                    aria-label={`Step ${i + 1} title`}
                    className="input mt-3"
                    value={s.title}
                    onChange={(e) => {
                      const a = [...t.steps];
                      a[i] = { ...a[i], title: e.target.value };
                      setT({ ...t, steps: a });
                    }}
                  />
                  <textarea
                    aria-label={`Step ${i + 1} instruction`}
                    className="input mt-2 min-h-24"
                    value={s.instruction}
                    onChange={(e) => {
                      const a = [...t.steps];
                      a[i] = { ...a[i], instruction: e.target.value };
                      setT({ ...t, steps: a });
                    }}
                  />
                  <button
                    className="btn btn-primary mt-2"
                    onClick={() => updateStep(i)}
                  >
                    <Check size={14} className="inline mr-2" />
                    Update Step
                  </button>
                </>
              ) : (
                <p className="text-sm muted mt-3 whitespace-pre-wrap">
                  {s.instruction}
                </p>
              )}
              <div className="flex justify-between items-center mt-3 gap-2 flex-wrap">
                <span className="text-xs muted">
                  {s.audio ? "Narration ready" : "No narration"}
                </span>
                <div className="flex gap-2 flex-wrap">
                  <button
                    className="btn"
                    disabled={!s.audio}
                    onClick={() => playNarration(i)}
                  >
                    <Play size={14} className="inline mr-2" />
                    Preview
                  </button>
                  <button
                    className="btn"
                    disabled={busyStep === i}
                    onClick={() => regenerate(i)}
                  >
                    {busyStep === i ? "Rewriting…" : "Rewrite Step"}
                  </button>
                  <button className="btn" onClick={() => tts(i)}>
                    <Volume2 size={14} className="inline mr-2" />
                    Regenerate Voice
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {msg && (
        <div className="fixed bottom-5 right-5 card px-4 py-3 text-sm flex items-center gap-2">
          <RotateCcw size={14} />
          {msg}
        </div>
      )}
    </fieldset>
  );
}
