"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Link2, ShieldCheck, Sparkles } from "lucide-react";
import {
  AI_PROVIDERS,
  AiProvider,
  DEFAULT_AI_SETTINGS,
  defaultsForProvider,
  TEXT_MODELS,
  TTS_MODELS,
  voicesFor,
} from "../lib/ai-options";

const DEFAULT_SETTINGS = {
  ...DEFAULT_AI_SETTINGS,
  speed: 1,
  resolution: "1440x800",
  fps: 30,
  quality: "high",
  screenRatio: "16:9",
};

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [settings, setSettings] = useState<any>(DEFAULT_SETTINGS);
  const [health, setHealth] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : {})
      .then((data) => setSettings({ ...DEFAULT_SETTINGS, ...data }));
    fetch("/api/health", { cache: "no-store" }).then((response) => response.ok ? response.json() : {}).then(setHealth);
  }, []);

  async function start() {
    setError("");
    try {
      const parsed = new URL(url.trim());
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("Use an http or https address.");
    } catch {
      setError("Enter a valid website address, such as https://example.com");
      return;
    }
    if (!projectName.trim()) {
      setError("Enter a project name.");
      return;
    }
    const providerReady = settings.provider === "gemini"
      ? health?.geminiConfigured
      : health?.groqConfigured;
    if (!providerReady) {
      setError(`Add a ${settings.provider === "gemini" ? "Gemini" : "Groq"} API key in Settings before recording.`);
      return;
    }
    setBusy(true);
    const response = await fetch("/api/record/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url.trim(), projectName: projectName.trim(), settings }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "We couldn't start the browser.");
      setBusy(false);
      return;
    }
    router.push(`/record/${data.id}`);
  }

  function changeProvider(provider: AiProvider) {
    setSettings({ ...settings, ...defaultsForProvider(provider) });
  }

  function changeTtsModel(ttsModel: string) {
    const voices = voicesFor();
    setSettings({
      ...settings,
      ttsModel,
      voice: voices.some((item) => item.value === settings.voice)
        ? settings.voice
        : voices[0].value,
    });
  }

  const provider = settings.provider as AiProvider;
  const voiceOptions = voicesFor();

  return (
    <div className="max-w-6xl mx-auto px-8 py-12">
      <div className="max-w-4xl">
        <div className="badge mb-5"><Sparkles size={14} /> Local-first AI tutorial generator</div>
        <h1 className="text-5xl font-semibold tracking-tight">Show the workflow once. Build a complete tutorial.</h1>
        <p className="text-lg muted mt-5 max-w-3xl">Record the full website view, capture meaningful interactions, generate a welcome step and narrated instructions, then review and export the result as MP4, ZIP, or PowerPoint.</p>
      </div>
      <div className="card mt-10 p-7 max-w-4xl">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium" htmlFor="project-name">Project name</label>
            <input id="project-name" className="input mt-2" placeholder="e.g. Customer Onboarding" maxLength={60} value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            <label className="text-sm font-medium mt-5 block" htmlFor="website-url">Website link</label>
            <div className="relative mt-2">
              <Link2 size={16} className="absolute left-3 top-3.5 muted" />
              <input id="website-url" className="input pl-9" placeholder="https://example.com" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => event.key === "Enter" && start()} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm muted">AI provider<select className="input mt-1" value={provider} onChange={(event) => changeProvider(event.target.value as AiProvider)}>{AI_PROVIDERS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
            <label className="text-sm muted">Text model<select className="input mt-1" value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })}>{TEXT_MODELS[provider].map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
            <label className="text-sm muted">Voice model<select className="input mt-1" value={settings.ttsModel} onChange={(event) => changeTtsModel(event.target.value)}>{TTS_MODELS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
            <label className="text-sm muted">Voice<select className="input mt-1" value={settings.voice} onChange={(event) => setSettings({ ...settings, voice: event.target.value })}>{voiceOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
            <label className="text-sm muted">Screen size<select className="input mt-1" value={settings.resolution} onChange={(event) => setSettings({ ...settings, resolution: event.target.value })}><option value="1920x1080">Full HD 16:9</option><option value="1280x720">HD 16:9</option><option value="1440x800">Laptop 16:9</option><option value="1440x900">Laptop 16:10</option><option value="1080x1080">Square 1:1</option></select></label>
            <label className="text-sm muted">FPS<input className="input mt-1" type="number" min="24" max="60" value={settings.fps} onChange={(event) => setSettings({ ...settings, fps: Number(event.target.value) })} /></label>
            <label className="text-sm muted">Video quality<select className="input mt-1" value={settings.quality} onChange={(event) => setSettings({ ...settings, quality: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          </div>
        </div>
        {error && <div className="text-sm text-red-400 mt-4">{error}</div>}
        <div className="flex flex-wrap items-center justify-between gap-4 mt-6">
          <div className="flex items-center gap-2 text-xs muted"><ShieldCheck size={15} /> Full-screen recording · values never sent to AI · loading visible in Chromium</div>
          <button className="btn btn-primary" disabled={busy} onClick={start}>{busy ? "Opening browser…" : "Start Recording"}<ArrowRight className="inline ml-2" size={16} /></button>
        </div>
      </div>
      <div className="grid md:grid-cols-4 gap-4 mt-8">
        {[["01", "Demonstrate", "Use the complete website without hiding the screen."], ["02", "Capture", "Trace clicks, controls, cursor movement, and meaningful inputs."], ["03", "Create", "Generate clear steps and voice without typed values."], ["04", "Export", "Review, re-render, download MP4, ZIP, or PPTX."]].map(([number, title, description]) => <div className="card p-5" key={number}><div className="text-xs muted">{number}</div><div className="font-medium mt-3">{title}</div><div className="text-sm muted mt-1">{description}</div></div>)}
      </div>
      <div className="mt-6 flex flex-wrap gap-3 text-xs muted">
        <span className="badge"><CheckCircle2 size={12} /> {health?.ffmpeg ? "FFmpeg ready" : "FFmpeg missing"}</span>
        <span className="badge"><CheckCircle2 size={12} /> {health?.playwrightChromium ? "Chromium ready" : "Chromium missing"}</span>
        <span className="badge"><CheckCircle2 size={12} /> {health?.groqConfigured || health?.geminiConfigured ? "AI key configured" : "AI key pending"}</span>
      </div>
      <p className="text-xs muted mt-8">AI interprets your demonstration and never invents actions. The original recording remains available for review.</p>
    </div>
  );
}
