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

## 2. Configure Groq

Create `.env.local`:

```env
GROQ_API_KEY=your_groq_key_here
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_TTS_MODEL=canopylabs/orpheus-v1-english
GROQ_TTS_VOICE=hannah
```

The application uses Groq for tutorial-step generation and narration. If Groq narration fails on macOS, the local `say` command is used as a non-cloud fallback.

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
