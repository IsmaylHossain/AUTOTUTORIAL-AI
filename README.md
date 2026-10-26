# AutoTutorial AI

Local-first application for turning a demonstrated website workflow into a narrated step-by-step tutorial.

The implementation follows the supplied design prompt: local Next.js UI, real Playwright browser recording, captured actions/screenshots, human-guided AI interpretation, one narration segment per meaningful action, highlighter-based visual guidance, review/editing, timeline creation, FFmpeg rendering, local tutorial library and MP4 export.

## Run

```bash
npm install
npm run check
npm run dev
```

No Homebrew FFmpeg installation is required: rendering uses `ffmpeg-static` and `ffprobe-static`. Groq and Gemini credentials are read server-side and generate tutorial titles and instructions. Narration uses Microsoft Edge Neural TTS by default, supports multiple voices, retries temporary failures, and converts every result to clean PCM WAV. Native system speech keeps narration working if Edge TTS is unavailable.

The real demonstration site opens in a Playwright Chromium window rather than an iframe because arbitrary websites cannot reliably be embedded while retaining full interaction control.
