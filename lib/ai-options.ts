export const AI_PROVIDERS = [
  { value: "groq", label: "Groq" },
  { value: "gemini", label: "Google Gemini" },
] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number]["value"];

export const TEXT_MODELS: Record<AiProvider, { value: string; label: string }[]> = {
  groq: [
    { value: "openai/gpt-oss-120b", label: "GPT-OSS 120B · best quality" },
    { value: "openai/gpt-oss-20b", label: "GPT-OSS 20B · faster" },
    { value: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B · preview" },
  ],
  gemini: [
    { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash · best quality" },
    { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite · faster" },
  ],
};

export const TTS_MODELS = [
  { value: "msedge-tts", label: "Microsoft Edge Neural TTS · free" },
] as const;

export const EDGE_TTS_VOICES = [
  { value: "en-US-AriaNeural", label: "Aria · Female · US" },
  { value: "en-US-JennyNeural", label: "Jenny · Female · US" },
  { value: "en-US-MichelleNeural", label: "Michelle · Female · US" },
  { value: "en-US-SaraNeural", label: "Sara · Female · US" },
  { value: "en-GB-SoniaNeural", label: "Sonia · Female · UK" },
  { value: "en-AU-NatashaNeural", label: "Natasha · Female · Australia" },
  { value: "en-IN-NeerjaNeural", label: "Neerja · Female · India" },
  { value: "en-US-GuyNeural", label: "Guy · Male · US" },
  { value: "en-US-DavisNeural", label: "Davis · Male · US" },
  { value: "en-GB-RyanNeural", label: "Ryan · Male · UK" },
] as const;

export const DEFAULT_TTS_SETTINGS = {
  ttsProvider: "edge" as const,
  ttsModel: "msedge-tts",
  voice: "en-US-AriaNeural",
};

export function voicesFor() {
  return EDGE_TTS_VOICES.map((voice) => ({ ...voice }));
}

export function defaultsForProvider(provider: AiProvider) {
  return {
    provider,
    model: TEXT_MODELS[provider][0].value,
  };
}

export const DEFAULT_AI_SETTINGS = {
  ...defaultsForProvider("groq"),
  ...DEFAULT_TTS_SETTINGS,
};

export function normalizeAiSettings(value: any) {
  const provider: AiProvider = value?.provider === "gemini" ? "gemini" : "groq";
  const textDefaults = defaultsForProvider(provider);
  const model = TEXT_MODELS[provider].some((item) => item.value === value?.model)
    ? value.model
    : textDefaults.model;
  const voice = EDGE_TTS_VOICES.some((item) => item.value === value?.voice)
    ? value.voice
    : DEFAULT_TTS_SETTINGS.voice;
  return {
    provider,
    model,
    ttsProvider: DEFAULT_TTS_SETTINGS.ttsProvider,
    ttsModel: DEFAULT_TTS_SETTINGS.ttsModel,
    voice,
  };
}
