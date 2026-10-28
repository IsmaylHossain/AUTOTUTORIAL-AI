// Isolated regression checks; never reads or changes real project data.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autotutorial-render-test-'));
process.env.AUTOTUTORIAL_DATA_DIR = root;
const store = require('../lib/store.ts');
const renderer = require('../lib/render.ts');
const media = require('../lib/media.ts');
const sharp = require('sharp');
const ffmpeg = media.ffmpegPath();
async function settled(id) {
  const deadline = Date.now() + 60000;
  while (renderer.renderActive(id)) {
    if (Date.now() > deadline) { renderer.cancelRender(id); throw new Error('Render timed out'); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return store.get(id);
}
async function main() {
  const id = 'fixture';
  const d = store.dir(id);
  const recording = path.join(d, 'recording.mp4');
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-t', '2', '-c:v', 'libx264', recording], { stdio: 'ignore' });
  fs.writeFileSync(path.join(d, 'actions.json'), Array.from({length:18}, (_,i) => JSON.stringify({type:'click',ts:i*80,activeMs:i*80,screenshotMs:i*80,viewportWidth:320,viewportHeight:180,targetRect:{x:20+i*2,y:40,width:100,height:30}})).join('\n'));
  store.save({ id, name:'Render test', url:'https://example.test', createdAt:new Date().toISOString(), status:'review',stage:'steps',recording, steps:[{action:'introduction',title:'Welcome',instruction:'Welcome',startMs:0,endMs:4000}] });
  const voice = path.join(d, 'audio', 'step-001.wav');
  execFileSync(ffmpeg, ['-y','-f','lavfi','-i','sine=frequency=880:duration=1',voice], {stdio:'ignore'});
  const voiced = store.get(id); voiced.steps[0].audio = voice;
  voiced.steps.push(...Array.from({length:18},(_,i)=>({action:'click',actionIndex:i,title:`Click ${i}`,instruction:`Click ${i}`,startMs:4000+i*80,endMs:4100+i*80,audio:voice})));
  store.save(voiced);
  const started = Date.now();
  assert.equal(renderer.startRender(id), true);
  assert.equal(renderer.startRender(id), false);
  let t = await settled(id);
  assert.equal(t.status, 'ready', t.message);
  assert.ok(media.readMediaDuration(t.video) >= 5.9);
  assert.ok(!fs.readFileSync(path.join(d,'render.log'),'utf8').includes('clean MP4 fallback'));
  const original = fs.readFileSync(t.video);
  assert.equal(renderer.startRender(id), true);
  while (renderer.renderActive(id) && !globalThis.tutorialRenderJobs.get(id)?.process) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(globalThis.tutorialRenderJobs.get(id)?.process, 'FFmpeg must be running before cancellation');
  renderer.cancelRender(id);
  t = await settled(id);
  assert.equal(t.status,'review');
  assert.match(t.message,/cancelled/);
  assert.deepEqual(fs.readFileSync(t.video), original);
  assert.ok(!fs.readFileSync(path.join(d,'render.log'),'utf8').includes('clean MP4 fallback'));
  t.status='rendering'; store.save(t);
  assert.equal(renderer.recoverRender(id).status,'review');
  const image = path.join(d,'template.png');
  await sharp({create:{width:320,height:180,channels:3,background:'#238acb'}}).png().toFile(image);
  const music = path.join(d,'music.wav');
  execFileSync(ffmpeg,['-y','-f','lavfi','-i','sine=frequency=440:duration=1',music],{stdio:'ignore'});
  t=store.get(id); t.templateImage=image; t.music=music; store.save(t);
  renderer.startRender(id);
  t=await settled(id);
  assert.equal(t.status,'ready',t.message);
  assert.ok(media.readMediaDuration(t.video)>=12.9);
  assert.equal(t.videoOpeningMs,3000);
  // Saved edits must invalidate only the changed voice, preserving reordered voices.
  const update = require('../app/api/tutorial/update/route.ts');
  const edited = structuredClone(t.steps);
  edited[0].title = 'Edited welcome'; edited[0].instruction = 'Updated spoken welcome';
  [edited[1], edited[2]] = [edited[2], edited[1]];
  const response = await update.POST(new Request('http://localhost/api/tutorial/update', {
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,steps:edited}) }));
  assert.equal(response.status,200);
  t=store.get(id);
  assert.equal(t.steps[0].audio,undefined);
  assert.equal(t.steps[1].audio,voice);
  assert.equal(t.steps[1].actionIndex,1);
  // Use a local fake speech generator to verify regeneration without network requests.
  let regenerated = 0;
  require('../lib/tts.ts').generateTTS = async (id,index) => {
    regenerated++;
    const current=store.get(id);
    const output=path.join(d,'audio','updated-voice.wav');
    fs.copyFileSync(voice,output);
    current.steps[index].audio=output;
    current.steps[index].audioText=current.steps[index].instruction;
    store.save(current);
    return output;
  };
  t.music=undefined; t.templateImage=undefined; t.recordingStopMs=1000; store.save(t);
  renderer.startRender(id); t=await settled(id);
  assert.equal(t.status,'ready',t.message);
  assert.equal(regenerated,1);
  assert.equal(t.steps[0].audioText,'Updated spoken welcome');
  const trimmedDuration=media.readMediaDuration(t.video);
  assert.ok(trimmedDuration>=4.9 && trimmedDuration<5.2, `Stop cutoff: ${trimmedDuration}`);
  const presentation=await require('../lib/export.ts').createPptx(id);
  const zip=await require('jszip').loadAsync(presentation);
  const cover=await zip.file('ppt/slides/slide1.xml').async('string');
  assert.ok(cover.includes('Edited welcome'));
  assert.ok(cover.includes('Updated spoken welcome'));
  console.log('PASS: saved welcome/PPTX, reordered voice references, missing narration regeneration, Stop cutoff.');
  console.log(`PASS: 18 highlights, duplicate prevention, cancellation, preserved output, stale recovery, template scenes and music (${((Date.now()-started)/1000).toFixed(1)}s).`);
  console.log(`Test artifacts: ${root}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
