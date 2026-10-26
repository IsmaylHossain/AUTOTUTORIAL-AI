"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import {
  AI_PROVIDERS,
  AiProvider,
  DEFAULT_AI_SETTINGS,
  defaultsForProvider,
  TEXT_MODELS,
  TTS_MODELS,
  voicesFor,
} from "../../lib/ai-options";

const DEFAULT_SETTINGS = {
  ...DEFAULT_AI_SETTINGS,
  speed: 1,
  resolution: "1440x800",
  fps: 30,
  quality: "high",
  screenRatio: "16:9",
  outputFolder: "~/.autotutorial-ai/tutorials",
};

export default function Settings() {
  const [settings, setSettings] = useState<any>(DEFAULT_SETTINGS);
  const [groqApiKey, setGroqApiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<any>(null);
  const [error, setError] = useState("");

  async function load() {
    const [settingsResponse, healthResponse] = await Promise.all([
      fetch("/api/settings", { cache: "no-store" }),
      fetch("/api/health", { cache: "no-store" }),
    ]);
    if (settingsResponse.ok)
      setSettings({ ...DEFAULT_SETTINGS, ...(await settingsResponse.json()) });
    if (healthResponse.ok) setHealth(await healthResponse.json());
  }

  useEffect(() => {
    load();
  }, []);

  function changeProvider(provider: AiProvider) {
    setSettings({ ...settings, ...defaultsForProvider(provider) });
  }

  function changeTtsModel(ttsModel: string) {
    const voices = voicesFor();
    const voice = voices.some((item) => item.value === settings.voice)
      ? settings.voice
      : voices[0].value;
    setSettings({ ...settings, ttsModel, voice });
  }

  async function save() {
    setError("");
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...settings,
        groqApiKey: groqApiKey || undefined,
        geminiApiKey: geminiApiKey || undefined,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "Could not save settings.");
      return;
    }
    setSettings({ ...settings, ...(data.settings || {}) });
    setGroqApiKey("");
    setGeminiApiKey("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    await load();
  }

  const provider = settings.provider as AiProvider;
  const voices = voicesFor();

  return (
    <div className="max-w-5xl mx-auto p-10">
      <h1 className="text-3xl font-semibold">Settings</h1>
      <p className="muted mt-2">
        Configure cloud AI text generation and narration for Groq or Google Gemini.
      </p>
      <div className="card p-6 mt-8 space-y-8">
        <section>
          <h2 className="font-medium">AI text generation</h2>
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <label className="text-sm muted">
              Provider
              <select
                className="input mt-1"
                value={provider}
                onChange={(event) => changeProvider(event.target.value as AiProvider)}
              >
                {AI_PROVIDERS.map((item) => (
                  <option value={item.value} key={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm muted">
              Text model
              <select
                className="input mt-1"
                value={settings.model}
                onChange={(event) => setSettings({ ...settings, model: event.target.value })}
              >
                {TEXT_MODELS[provider].map((item) => (
                  <option value={item.value} key={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <label className="text-sm muted">
              Groq API key
              <span className="ml-2 text-xs">{health?.groqConfigured ? "Configured" : "Missing"}</span>
              <input
                className="input mt-1"
                type="password"
                autoComplete="off"
                placeholder={health?.groqConfigured ? "Enter only to replace" : "gsk_…"}
                value={groqApiKey}
                onChange={(event) => setGroqApiKey(event.target.value)}
              />
            </label>
            <label className="text-sm muted">
              Gemini API key
              <span className="ml-2 text-xs">{health?.geminiConfigured ? "Configured" : "Missing"}</span>
              <input
                className="input mt-1"
                type="password"
                autoComplete="off"
                placeholder={health?.geminiConfigured ? "Enter only to replace" : "Google AI Studio key"}
                value={geminiApiKey}
                onChange={(event) => setGeminiApiKey(event.target.value)}
              />
            </label>
          </div>
          <p className="text-xs muted mt-2">
            Keys stay server-side in .env.local. Professional local templates keep step generation working when cloud AI is unavailable.
          </p>
        </section>

        <section>
          <h2 className="font-medium">Voice generation</h2>
          <div className="grid md:grid-cols-3 gap-4 mt-4">
            <label className="text-sm muted">
              Voice model
              <select
                className="input mt-1"
                value={settings.ttsModel}
                onChange={(event) => changeTtsModel(event.target.value)}
              >
                {TTS_MODELS.map((item) => (
                  <option value={item.value} key={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm muted">
              Voice
              <select
                className="input mt-1"
                value={settings.voice}
                onChange={(event) => setSettings({ ...settings, voice: event.target.value })}
              >
                {voices.map((item) => (
                  <option value={item.value} key={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm muted">
              Speed
              <input
                className="input mt-1"
                type="number"
                min="0.5"
                max="2"
                step="0.1"
                value={settings.speed}
                onChange={(event) => setSettings({ ...settings, speed: Number(event.target.value) })}
              />
            </label>
          </div>
          <p className="text-xs muted mt-2">
            Microsoft Edge Neural TTS runs on the server without an API key. Audio is converted to WAV with FFmpeg. macOS uses `say`, Windows uses System.Speech, and Linux uses espeak-ng if Edge TTS fails.
          </p>
        </section>

        <section>
          <h2 className="font-medium">Video and screen</h2>
          <div className="grid md:grid-cols-5 gap-4 mt-4">
            <label className="text-sm muted">Resolution<select className="input mt-1" value={settings.resolution} onChange={(event) => setSettings({ ...settings, resolution: event.target.value })}><option value="1920x1080">1920 × 1080</option><option value="1280x720">1280 × 720</option><option value="1440x800">1440 × 800</option><option value="1440x900">1440 × 900</option><option value="1080x1080">1080 × 1080</option></select></label>
            <label className="text-sm muted">FPS<input className="input mt-1" type="number" min="24" max="60" value={settings.fps} onChange={(event) => setSettings({ ...settings, fps: Number(event.target.value) })} /></label>
            <label className="text-sm muted">Quality<select className="input mt-1" value={settings.quality || "high"} onChange={(event) => setSettings({ ...settings, quality: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <label className="text-sm muted">Ratio<input className="input mt-1" value={settings.screenRatio} onChange={(event) => setSettings({ ...settings, screenRatio: event.target.value })} /></label>
            <label className="text-sm muted">Storage path<input className="input mt-1" value={settings.outputFolder} onChange={(event) => setSettings({ ...settings, outputFolder: event.target.value })} /></label>
          </div>
        </section>

        <section>
          <h2 className="font-medium">Health</h2>
          <div className="grid md:grid-cols-2 gap-3 mt-3">
            {[["FFmpeg", health?.ffmpeg], ["Media probe", health?.mediaProbe], ["Chromium", health?.playwrightChromium], ["Groq API key", health?.groqConfigured], ["Gemini API key", health?.geminiConfigured], ["Data directory", health?.dataDirectory]].map(([name, value]) => (
              <div className="card p-3" key={String(name)}><div className="text-sm">{name}</div><div className="text-xs muted mt-1">{value ? "Ready" : "Missing"}</div></div>
            ))}
          </div>
          <button className="btn mt-4" onClick={load}><RefreshCw size={14} className="inline mr-2" />Refresh health</button>
        </section>

        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={save}>{saved ? "Saved" : "Save Settings"}</button>
          <div className="text-xs muted flex items-center gap-2"><ShieldCheck size={14} />Secrets stay server-side.</div>
        </div>
        {error && <div className="text-sm text-red-400">{error}</div>}
      </div>
    </div>
  );
}
