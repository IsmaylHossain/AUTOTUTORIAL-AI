# FFmpeg runtime fix

The render server resolves `ffmpeg-static` from the real project `node_modules` directory instead of relying only on a Next.js-bundled `require.resolve()` path.

Run:

```bash
npm install
npm run setup:media
npm run diagnose:media
npm run check
npm run dev
```

The server must be stopped and restarted after installing media binaries.
