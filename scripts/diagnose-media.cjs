const fs = require("fs");
const path = require("path");
console.log("[AutoTutorial AI] cwd:", process.cwd());
const p = path.join(
  process.cwd(),
  "node_modules",
  "ffmpeg-static",
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
);
console.log("[AutoTutorial AI] expected FFmpeg:", p);
console.log("[AutoTutorial AI] exists:", fs.existsSync(p));
console.log(
  "[AutoTutorial AI] executable:",
  fs.existsSync(p) && !!(fs.statSync(p).mode & 0o111),
);
try {
  console.log("[AutoTutorial AI] package export:", require("ffmpeg-static"));
} catch (e) {
  console.log("[AutoTutorial AI] package export error:", e.message);
}
try {
  console.log(
    "[AutoTutorial AI] ffprobe export:",
    require("ffprobe-static").path || require("ffprobe-static"),
  );
} catch (e) {
  console.log("[AutoTutorial AI] ffprobe export error:", e.message);
}
