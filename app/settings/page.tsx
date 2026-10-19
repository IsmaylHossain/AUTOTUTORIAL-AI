"use client";
import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";

const DEFAULT_SETTINGS = { provider: "groq", model: "llama-3.3-70b-versatile", voice: "hannah", ttsModel: "canopylabs/orpheus-v1-english", speed: 1, resolution: "1440x800", fps: 30, quality: "high", screenRatio: "16:9", outputFolder: "~/.autotutorial-ai/tutorials" };

export default function Settings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<any>(null);
  const [error, setError] = useState("");

  async function load() {
    const [settingsResponse, healthResponse] = await Promise.all([fetch("/api/settings", { cache: "no-store" }), fetch("/api/health", { cache: "no-store" })]);
    if (settingsResponse.ok) setSettings({ ...DEFAULT_SETTINGS, ...(await settingsResponse.json()) });
    if (healthResponse.ok) setHealth(await healthResponse.json());
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setError("");
    const response = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settings, apiKey: apiKey || undefined }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Could not save settings."); return; }
    setSettings({ ...settings, ...(data.settings || {}) });
    setApiKey("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    load();
  }

  return (
    <div className="max-w-5xl mx-auto p-10">
      <h1 className="text-3xl font-semibold">Settings</h1>
      <p className="muted mt-2">Choose the AI provider, voice, recording quality, screen format, and local storage.</p>
      <div className="card p-6 mt-8 space-y-8">
        <section>
          <h2 className="font-medium">AI provider</h2>
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <label className="text-sm muted">Provider<select className="input mt-1" value={settings.provider} onChange={(event) => setSettings({ ...settings, provider: event.target.value })}><option value="groq">Groq</option><option value="gemini">Gemini</option></select></label>
            <label className="text-sm muted">Model<input className="input mt-1" value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} /></label>
          </div>
          <label className="text-sm muted mt-4 block">API key <span className="text-xs">stored server-side in .env.local</span><input className="input mt-1" type="password" autoComplete="off" placeholder={health?.groqConfigured || health?.geminiConfigured ? "Configured — enter a new key to replace it" : "Paste provider API key"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
          <p className="text-xs muted mt-2">Select the provider matching the key entered above. If unavailable, AutoTutorial AI keeps the recording and uses deterministic local step generation.</p>
        </section>
        <section><h2 className="font-medium">Voice and narration</h2><div className="grid md:grid-cols-3 gap-4 mt-4"><label className="text-sm muted">Voice<select className="input mt-1" value={settings.voice} onChange={(event) => setSettings({ ...settings, voice: event.target.value })}><option value="hannah">Hannah</option><option value="austin">Austin</option><option value="troy">Troy</option><option value="diana">Diana</option><option value="autumn">Autumn</option><option value="daniel">Daniel</option><option value="Kore">Kore</option><option value="Puck">Puck</option></select></label><label className="text-sm muted">Narration model<input className="input mt-1" value={settings.ttsModel} onChange={(event) => setSettings({ ...settings, ttsModel: event.target.value })} /></label><label className="text-sm muted">Speed<input className="input mt-1" type="number" min="0.5" max="2" step="0.1" value={settings.speed} onChange={(event) => setSettings({ ...settings, speed: Number(event.target.value) })} /></label></div><p className="text-xs muted mt-2">The voice and model are applied to every generated step. macOS can use the built-in say voice as a local fallback.</p></section>
        <section><h2 className="font-medium">Video and screen</h2><div className="grid md:grid-cols-5 gap-4 mt-4"><label className="text-sm muted">Resolution<select className="input mt-1" value={settings.resolution} onChange={(event) => setSettings({ ...settings, resolution: event.target.value })}><option value="1920x1080">1920 × 1080</option><option value="1280x720">1280 × 720</option><option value="1440x800">1440 × 800</option><option value="1440x900">1440 × 900</option><option value="1080x1080">1080 × 1080</option></select></label><label className="text-sm muted">FPS<input className="input mt-1" type="number" min="24" max="60" value={settings.fps} onChange={(event) => setSettings({ ...settings, fps: Number(event.target.value) })} /></label><label className="text-sm muted">Quality<select className="input mt-1" value={settings.quality || "high"} onChange={(event) => setSettings({ ...settings, quality: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label className="text-sm muted">Ratio<input className="input mt-1" value={settings.screenRatio} onChange={(event) => setSettings({ ...settings, screenRatio: event.target.value })} /></label><label className="text-sm muted">Storage path<input className="input mt-1" value={settings.outputFolder} onChange={(event) => setSettings({ ...settings, outputFolder: event.target.value })} /></label></div><p className="text-xs muted mt-2">The browser records the selected viewport without zooming or hiding the website. The existing storage location is used for all project assets.</p></section>
        <section><h2 className="font-medium">Local health</h2><div className="grid md:grid-cols-2 gap-3 mt-3">{[["FFmpeg", health?.ffmpeg], ["Media probe", health?.mediaProbe], ["Chromium", health?.playwrightChromium], ["Groq API", health?.groqConfigured], ["Gemini API", health?.geminiConfigured], ["Data directory", health?.dataDirectory]].map(([name, value]) => <div className="card p-3" key={String(name)}><div className="text-sm">{name}</div><div className="text-xs muted mt-1">{value ? "Ready" : "Missing"}</div></div>)}</div><button className="btn mt-4" onClick={load}><RefreshCw size={14} className="inline mr-2" />Refresh health</button></section>
        <div className="flex items-center gap-3"><button className="btn btn-primary" onClick={save}>{saved ? "Saved" : "Save Settings"}</button><div className="text-xs muted flex items-center gap-2"><ShieldCheck size={14} />Secrets stay server-side.</div></div>{error && <div className="text-sm text-red-400">{error}</div>}
      </div>
    </div>
  );
}
