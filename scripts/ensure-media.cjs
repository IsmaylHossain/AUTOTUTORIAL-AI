const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

function packageDir(name) {
  try { return path.dirname(require.resolve(`${name}/package.json`)); } catch {}
  try { return path.dirname(require.resolve(name)); } catch {}
  return null;
}

function ensureFfmpeg() {
  const dir = packageDir('ffmpeg-static');
  if (!dir) return false;
  const candidates = [
    path.join(dir, 'ffmpeg'),
    path.join(dir, 'ffmpeg.exe'),
    path.join(dir, 'bin', 'ffmpeg'),
  ];
  if (candidates.some(p => fs.existsSync(p))) return true;
  const installer = path.join(dir, 'install.js');
  if (!fs.existsSync(installer)) return false;
  try {
    cp.execFileSync(process.execPath, [installer], { stdio: 'inherit' });
  } catch (e) {
    console.warn('[AutoTutorial AI] ffmpeg-static installer did not complete:', e.message);
  }
  return candidates.some(p => fs.existsSync(p));
}

function ensureFfprobe() {
  const dir = packageDir('ffprobe-static');
  if (!dir) return false;
  const candidates = [
    path.join(dir, 'bin', process.platform, process.arch, 'ffprobe'),
    path.join(dir, 'bin', process.platform, 'x64', 'ffprobe'),
    path.join(dir, 'bin', process.platform, 'arm64', 'ffprobe'),
    path.join(dir, 'bin', 'ffprobe'),
  ];
  if (candidates.some(p => fs.existsSync(p))) return true;
  const installer = path.join(dir, 'install.js');
  if (fs.existsSync(installer)) {
    try { cp.execFileSync(process.execPath, [installer], { stdio: 'inherit' }); } catch {}
  }
  const installed = candidates.some(p => fs.existsSync(p));
  if (installed) {
    const found = candidates.find(p => fs.existsSync(p));
    try { fs.chmodSync(found, 0o755); } catch {}
  }
  return installed;
}

const ffmpeg = ensureFfmpeg();
const ffprobe = ensureFfprobe();
console.log(`[AutoTutorial AI] FFmpeg: ${ffmpeg ? 'ready' : 'missing'}`);
if (ffmpeg) {
  const dir = packageDir('ffmpeg-static');
  const candidates = [dir && path.join(dir, 'ffmpeg'), dir && path.join(dir, 'ffmpeg.exe'), dir && path.join(dir, 'bin', 'ffmpeg')].filter(Boolean);
  const found = candidates.find(p => fs.existsSync(p));
  if (found) { try { fs.chmodSync(found, 0o755); } catch {} console.log(`[AutoTutorial AI] FFmpeg binary: ${found}`); }
}
console.log(`[AutoTutorial AI] FFprobe: ${ffprobe ? 'ready' : 'optional/missing'}`);
if (ffprobe) {
  const dir = packageDir('ffprobe-static');
  const candidates = [dir && path.join(dir, 'bin', process.platform, process.arch, 'ffprobe'), dir && path.join(dir, 'bin', process.platform, 'x64', 'ffprobe'), dir && path.join(dir, 'bin', process.platform, 'arm64', 'ffprobe'), dir && path.join(dir, 'bin', 'ffprobe')].filter(Boolean);
  const found = candidates.find(p => fs.existsSync(p));
  if (found) { try { fs.chmodSync(found, 0o755); } catch {} console.log(`[AutoTutorial AI] FFprobe binary: ${found}`); }
}
if (!ffmpeg) {
  console.warn('[AutoTutorial AI] FFmpeg could not be installed automatically. The app will show a clear setup error instead of a generic render 500.');
}
