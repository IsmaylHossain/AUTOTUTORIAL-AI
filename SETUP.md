# AutoTutorial AI — local setup

## 1. Install dependencies

```bash
npm install
```

The postinstall step installs Playwright Chromium and explicitly installs the bundled `ffmpeg-static` binary. This avoids requiring Homebrew or administrator access.

If your package manager skipped dependency install scripts, run:

```bash
npm run setup:media
```

Then restart the development server.

## 2. Configure Groq and/or Gemini

Create `.env.local`:

```env
AI_PROVIDER=groq
GROQ_API_KEY=your_groq_key_here
GROQ_MODEL=openai/gpt-oss-120b
GEMINI_API_KEY=your_gemini_key_here
GEMINI_MODEL=gemini-3.8-flash
EDGE_TTS_VOICE=en-US-AriaNeural
```

You can also enter both keys in the Settings page. Choose a text provider and model there. Tutorial narration defaults to Microsoft Edge Neural TTS and needs no API key. The Settings voice selector includes female and male voices such as Aria and Jenny. Edge audio is retried and converted to PCM WAV with FFmpeg. If it fails, narration uses native system speech (`say` on macOS, System.Speech on Windows, or espeak-ng on Linux).

Cloud AI is preferred for step text. If it fails, the app uses professional local step templates.

## 3. Check local dependencies

```bash
npm run check
```

Then:

```bash
npm run dev
```

Open the localhost URL shown by Next.js.

## 4. If rendering says FFmpeg is missing

Run:

```bash
npm run setup:media
```

Then completely stop and restart `npm run dev`.

The application resolves `ffmpeg-static` at runtime and does not require `/opt/homebrew/bin/ffmpeg`.
