import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * Resolve media binaries at runtime from the real project node_modules.
 * Next.js can bundle/relocate require.resolve() results, so relying only on
 * require.resolve('ffmpeg-static') can make a binary that is present on disk
 * appear to be missing from an API route. We deliberately inspect the actual
 * filesystem first and only then fall back to the package export.
 */
function binaryUsable(candidate: string) {
  if (!candidate) return false;
  try {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    execFileSync(candidate, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function readMediaDuration(file: string): number {
  if (!file || !fs.existsSync(file)) return 0;
  const ffprobe = ffprobePath();
  if (ffprobe) {
    try {
      const stdout = execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      const n = Number(String(stdout).trim());
      if (Number.isFinite(n) && n > 0) return n;
    } catch {}
  }

  const ffmpeg = ffmpegPath();
  if (ffmpeg) {
    try {
      const stderr = execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      const m = String(stderr).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    } catch (err: any) {
      const text = (err?.stderr || err?.stdout || '').toString();
      const m = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
  }

  return 0;
}

export async function waitForMediaDuration(file: string, timeoutMs = 20000, minBytes = 1024): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (!file || !fs.existsSync(file)) return 0;
      const stat = fs.statSync(file);
      if (stat.size >= minBytes) {
        const d = readMediaDuration(file);
        if (d > 0) return d;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return readMediaDuration(file);
}

function existingFile(candidates: string[]) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (binaryUsable(candidate)) return candidate;
    } catch {}
  }
  return '';
}

function packageExport(pkg: string) {
  try {
    const value = require(pkg);
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof (value as any).path === 'string') return (value as any).path;
  } catch {}
  return '';
}

function packageRoot(pkg: string) {
  const roots = [
    path.join(process.cwd(), 'node_modules', pkg),
    path.join(process.cwd(), 'node_modules', '.pnpm'),
  ];
  for (const root of roots) {
    try {
      if (fs.existsSync(root)) return root;
    } catch {}
  }
  return '';
}

export function ffmpegPath() {
  const root = packageRoot('ffmpeg-static');
  const exported = packageExport('ffmpeg-static');
  return existingFile([
    exported,
    root ? path.join(root, 'ffmpeg') : '',
    root ? path.join(root, 'ffmpeg.exe') : '',
    root ? path.join(root, 'bin', 'ffmpeg') : '',
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
    process.env.FFMPEG_PATH || '',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ]);
}

export function ffprobePath() {
  const root = packageRoot('ffprobe-static');
  return existingFile([
    packageExport('ffprobe-static'),
    root ? path.join(root, 'bin', process.platform, process.arch, 'ffprobe') : '',
    root ? path.join(root, 'bin', process.platform, 'x64', 'ffprobe') : '',
    root ? path.join(root, 'bin', process.platform, 'arm64', 'ffprobe') : '',
    root ? path.join(root, 'bin', 'ffprobe') : '',
    path.join(process.cwd(), 'node_modules', 'ffprobe-static', 'bin', process.platform, process.arch, 'ffprobe'),
    path.join(process.cwd(), 'node_modules', 'ffprobe-static', 'bin', process.platform, 'x64', 'ffprobe'),
    path.join(process.cwd(), 'node_modules', 'ffprobe-static', 'bin', process.platform, 'arm64', 'ffprobe'),
    process.env.FFPROBE_PATH || '',
    '/opt/homebrew/bin/ffprobe',
    '/usr/local/bin/ffprobe',
    '/usr/bin/ffprobe',
  ]);
}

export function mediaStatus() {
  const ff = ffmpegPath();
  const fp = ffprobePath();
  return {
    ffmpeg: !!ff,
    ffmpegPath: ff || null,
    ffprobe: !!fp,
    ffprobePath: fp || null,
  };
}
