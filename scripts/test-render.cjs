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
  assert.ok(Math.abs(media.readMediaDuration(t.video)-8)<0.15);
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
  assert.ok(Math.abs(media.readMediaDuration(t.video)-10)<0.15);
  assert.equal(t.videoOpeningMs,2000);
  assert.equal(t.videoStepOffsetMs,1000);
  const transitionFrames=[];
  for(const second of [4.5,4.85,5.05]) {
    const frame=execFileSync(ffmpeg,['-ss',String(second),'-i',t.video,'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],{stdio:['ignore','pipe','ignore']});
    transitionFrames.push(await sharp(frame).removeAlpha().raw().toBuffer());
  }
  const distance=(a,b)=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;
  assert.ok(distance(transitionFrames[0],transitionFrames[1])<1,'Welcome must remain fully visible without a fade');
  assert.ok(distance(transitionFrames[1],transitionFrames[2])>1,'Recording must replace the welcome at its boundary');
  console.log('PASS: 2-second opening, 3-second welcome/ending, synchronized narration offsets, welcome without fades.');
  // Saved edits must invalidate only the changed voice, preserving reordered voices.
  const update = require('../app/api/tutorial/update/route.ts');
  const edited = structuredClone(t.steps);
  const savedRender=t.video;
  const savedRenderBytes=fs.readFileSync(savedRender);
  edited[0].title = 'Edited welcome'; edited[0].instruction = 'Updated spoken welcome';
  [edited[1], edited[2]] = [edited[2], edited[1]];
  const response = await update.POST(new Request('http://localhost/api/tutorial/update', {
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,steps:edited}) }));
  assert.equal(response.status,200);
  t=store.get(id);
  assert.equal(t.video,savedRender);
  assert.equal(t.videoOutdated,true);
  assert.deepEqual(fs.readFileSync(t.video),savedRenderBytes);
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
  assert.equal(t.videoOutdated,false);
  assert.equal(t.steps[0].audioText,'Updated spoken welcome');
  const trimmedDuration=media.readMediaDuration(t.video);
  assert.ok(trimmedDuration>=6.9 && trimmedDuration<7.2, `Stop cutoff with default ending: ${trimmedDuration}`);
  const presentation=await require('../lib/export.ts').createPptx(id);
  const zip=await require('jszip').loadAsync(presentation);
  const cover=await zip.file('ppt/slides/slide1.xml').async('string');
  assert.equal(store.get(id).steps[0].title,'Welcome step');
  assert.ok(!cover.includes('Edited welcome'));
  assert.ok(cover.includes('Updated spoken welcome'));
  const { recordingPreview, activeRecordingRanges } = require('../lib/recording-preview.ts');
  assert.deepEqual(activeRecordingRanges({pauseIntervals:[{startMs:20000,endMs:80000}],recordingStopMs:180000},180),
    [{start:0,end:20},{start:80,end:180}]);
  const rawBytes = fs.readFileSync(recording);
  t=store.get(id);
  t.videoStartOffsetMs=200; t.recordingStopMs=1600;
  t.pauseIntervals=[{startMs:400,endMs:800}]; store.save(t);
  const originalSteps=structuredClone(t.steps);
  const originalActions=fs.readFileSync(path.join(d,'actions.json'),'utf8');
  const previews=await Promise.all([recordingPreview(id),recordingPreview(id)]);
  assert.equal(previews[0],previews[1]);
  assert.notEqual(previews[0],recording);
  const previewDuration=media.readMediaDuration(previews[0]);
  assert.ok(Math.abs(previewDuration-1.2)<0.1, `Active preview: ${previewDuration}`);
  assert.deepEqual(fs.readFileSync(recording),rawBytes);
  assert.deepEqual(store.get(id).steps,originalSteps);
  assert.equal(fs.readFileSync(path.join(d,'actions.json'),'utf8'),originalActions);
  const assets=await require('../app/api/assets/route.ts').GET(new Request(`http://localhost/api/assets?id=${id}`));
  assert.equal(assets.status,200);
  assert.ok((await assets.json()).recordingUrl.includes(path.basename(previews[0])));
  renderer.startRender(id); t=await settled(id);
  assert.equal(t.status,'ready',t.message);
  const activeDuration=media.readMediaDuration(path.join(d,'recording-active.mp4'));
  assert.ok(Math.abs(activeDuration-previewDuration)<0.05, 'Preview and renderer must use the same active footage without double trimming');
  const { finalizeActiveRecording } = require('../lib/recording-preview.ts');
  // Old projects have no cleanup authorization and must retain their source.
  await finalizeActiveRecording(id);
  assert.ok(fs.existsSync(recording));
  const windowFile=path.join(d,'window-source.webm');
  fs.copyFileSync(recording,windowFile);
  const unrelatedFile=path.join(d,'unrelated.mp4');
  fs.copyFileSync(recording,unrelatedFile);
  t=store.get(id);
  const finalVideo=t.video;
  t.recordingCleanupFiles=[path.basename(recording),path.basename(windowFile),path.basename(finalVideo),'../outside.mp4'];
  store.save(t);
  // A readable but wrong-duration preview must never authorize source deletion.
  const verifiedBytes=fs.readFileSync(previews[0]);
  fs.copyFileSync(recording,previews[0]);
  await assert.rejects(finalizeActiveRecording(id),/verification failed/);
  assert.ok(fs.existsSync(recording));
  assert.ok(fs.existsSync(windowFile));
  fs.writeFileSync(previews[0],verifiedBytes);
  const kept=await finalizeActiveRecording(id);
  assert.equal(kept,previews[0]);
  assert.ok(!fs.existsSync(recording));
  assert.ok(!fs.existsSync(windowFile));
  assert.ok(fs.existsSync(unrelatedFile));
  assert.ok(fs.existsSync(finalVideo));
  assert.equal(store.get(id).recordingIsActive,true);
  assert.equal(store.get(id).recordingCleanupFiles,undefined);
  assert.deepEqual(store.get(id).steps,originalSteps);
  assert.equal(fs.readFileSync(path.join(d,'actions.json'),'utf8'),originalActions);
  assert.equal(await recordingPreview(id),kept);
  assert.equal(await finalizeActiveRecording(id),kept);
  assert.deepEqual(activeRecordingRanges(store.get(id),previewDuration),[{start:0,end:previewDuration}]);
  renderer.startRender(id); t=await settled(id);
  assert.equal(t.status,'ready',t.message);
  assert.ok(Math.abs(media.readMediaDuration(t.video)-(6+previewDuration))<0.15);
  // Reordering/deleting the welcome must not remove the template ending.
  t.templateImage=image; t.music=music;
  t.steps.push(t.steps.shift()); store.save(t);
  renderer.startRender(id); t=await settled(id);
  assert.equal(t.status,'ready',t.message);
  assert.ok(Math.abs(media.readMediaDuration(t.video)-(8+previewDuration))<0.15);
  const movedEnd=execFileSync(ffmpeg,['-ss',String(media.readMediaDuration(t.video)-1),'-i',t.video,'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],{stdio:['ignore','pipe','ignore']});
  assert.ok(movedEnd.length>0,'Welcome plus ending must have actual video frames through the final second');
  const templatePptx=await require('jszip').loadAsync(await require('../lib/export.ts').createPptx(id));
  const welcomeSlide=await templatePptx.file('ppt/slides/slide2.xml').async('string');
  assert.ok(welcomeSlide.includes('Updated spoken welcome'));
  assert.ok(!welcomeSlide.includes('Welcome step'));
  t.steps=t.steps.filter(step=>step.action!=='introduction'); store.save(t);
  renderer.startRender(id); t=await settled(id);
  assert.equal(t.status,'ready',t.message);
  const noWelcomeDuration=media.readMediaDuration(t.video);
  assert.ok(Math.abs(noWelcomeDuration-(5+previewDuration))<0.15);
  const endFrame=execFileSync(ffmpeg,['-ss',String(noWelcomeDuration-1),'-i',t.video,'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],{stdio:['ignore','pipe','ignore']});
  const pixel=await sharp(endFrame).extract({left:5,top:5,width:1,height:1}).removeAlpha().raw().toBuffer();
  assert.ok(Math.abs(pixel[0]-35)<10 && Math.abs(pixel[1]-138)<10 && Math.abs(pixel[2]-203)<10,'Ending frame must show template background');
  console.log('PASS: moved/deleted welcome retains template ending; PPTX welcome uses edited description; stable welcome title.');
  const edits=require('../lib/video-edits.ts');
  const editId='edit-fixture', editDir=store.dir(editId), editSource=path.join(editDir,'source.mp4');
  fs.writeFileSync(editSource,rawBytes);
  const editActions=[200,600,1400].map((ms,i)=>({type:'click',ts:10000+ms,activeMs:ms,screenshotMs:ms+50,
    targetRect:{x:20,y:20,width:80,height:20},viewportWidth:320,viewportHeight:180}));
  fs.writeFileSync(path.join(editDir,'actions.json'),editActions.map(a=>JSON.stringify(a)).join('\n'));
  store.save({id:editId,name:'Editing',url:'https://example.test',createdAt:new Date().toISOString(),status:'review',stage:'steps',
    recording:editSource,recordingIsActive:true,steps:[{action:'introduction',title:'Welcome step',instruction:'Welcome',startMs:0,endMs:4000,audio:voice},
      ...editActions.map((a,i)=>({action:'click',actionIndex:i,title:`Action ${i}`,instruction:`Click ${i}`,startMs:4000+a.activeMs,endMs:4100+a.activeMs,audio:voice}))]});
  assert.deepEqual(edits.normalizeCuts([{start:0.4,end:0.7},{start:0.5,end:0.8}],2),[{start:0.4,end:0.8}]);
  await assert.rejects(edits.editRecording(editId,[{start:0,end:2}],editSource),/Keep at least/);
  assert.ok(fs.existsSync(editSource));
  const saving=edits.editRecording(editId,[{start:0.4,end:0.8},{start:1.6,end:1.8}],editSource);
  assert.throws(()=>renderer.startRender(editId),/video edits/);
  const editResult=await saving;
  assert.equal(editResult.removedSteps,1);
  let editedProject=store.get(editId);
  assert.ok(Math.abs(media.readMediaDuration(editedProject.recording)-1.4)<0.1);
  assert.ok(!fs.existsSync(editSource));
  assert.equal(editedProject.steps.length,3);
  assert.equal(editedProject.steps[2].title,'Action 2');
  assert.equal(editedProject.steps[2].actionIndex,1);
  assert.equal(editedProject.steps[2].startMs,5000);
  const adjustedActions=require('../lib/timeline.ts').readActions(editId);
  assert.equal(adjustedActions.length,2);
  assert.equal(adjustedActions[1].activeMs,1000);
  assert.equal(adjustedActions[1].screenshotMs,1050);
  await assert.rejects(edits.editRecording(editId,[{start:0,end:0.1}],editSource),/Recording changed/);
  renderer.startRender(editId); editedProject=await settled(editId);
  assert.equal(editedProject.status,'ready',editedProject.message);
  assert.ok(Math.abs(media.readMediaDuration(editedProject.video)-7.4)<0.15);
  const editedDeck=await require('jszip').loadAsync(await require('../lib/export.ts').createPptx(editId));
  assert.ok(editedDeck.file('ppt/slides/slide1.xml'));
  assert.equal(require('../lib/ai.ts').validateTutorialSteps(editId).issues.length,0);
  await edits.editRecording(editId,[{start:0,end:0.1}],editedProject.recording);
  assert.equal(store.get(editId).video,editedProject.video);
  assert.equal(store.get(editId).videoOutdated,true);
  assert.equal(store.get(editId).steps[2].startMs,4900);
  assert.equal(require('../lib/timeline.ts').readActions(editId)[1].activeMs,900);
  // Old metadata can hide an existing render; restore it without deleting it.
  let hidden=store.get(editId); hidden.video=undefined; store.save(hidden);
  assert.equal(store.get(editId).video,editedProject.video);
  assert.equal(store.get(editId).videoOutdated,true);
  const legacyRender=path.join(editDir,'previous-render.mp4');
  fs.renameSync(editedProject.video,legacyRender);
  hidden=store.get(editId); hidden.video=legacyRender; store.save(hidden);
  renderer.startRender(editId); const replacement=await settled(editId);
  assert.equal(replacement.status,'ready',replacement.message);
  assert.equal(replacement.videoOutdated,false);
  assert.ok(fs.existsSync(replacement.video));
  assert.ok(!fs.existsSync(legacyRender));
  const missingTemplate=store.get(editId);
  missingTemplate.templateImage=path.join(editDir,'missing-template.png');
  missingTemplate.steps=missingTemplate.steps.filter(step=>step.action!=='introduction');
  store.save(missingTemplate);
  renderer.startRender(editId); const defaultEnding=await settled(editId);
  assert.equal(defaultEnding.status,'ready',defaultEnding.message);
  const defaultDuration=media.readMediaDuration(defaultEnding.video);
  assert.ok(Math.abs(defaultDuration-(media.readMediaDuration(defaultEnding.recording)+3))<0.15);
  const defaultFrame=execFileSync(ffmpeg,['-ss',String(defaultDuration-1),'-i',defaultEnding.video,'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],{stdio:['ignore','pipe','ignore']});
  const defaultPixel=await sharp(defaultFrame).extract({left:5,top:5,width:1,height:1}).removeAlpha().raw().toBuffer();
  assert.ok(defaultPixel[0]<60 && defaultPixel[1]<60 && defaultPixel[2]<100,'Default ending must show the dark cover instead of recorded footage');
  console.log('PASS: default 3-second Thank You ending with missing template and deleted welcome.');
  console.log('PASS: edits retain outdated render, hidden render recovery, verified replacement deletes previous render.');
  console.log('PASS: manual cuts, action removal/remapping, narration timing, repeat edits, stale edit rejection, render lock, PPTX and re-render.');
  console.log('PASS: verified source cleanup, failed verification preserves originals, old projects untouched, protected files retained, no double trimming.');
  console.log('PASS: paused preview duration, concurrent preview cache, unchanged source/steps/actions, matching rendered active footage.');
  console.log('PASS: saved welcome/PPTX, reordered voice references, missing narration regeneration, Stop cutoff.');
  console.log(`PASS: 18 highlights, duplicate prevention, cancellation, preserved output, stale recovery, template scenes and music (${((Date.now()-started)/1000).toFixed(1)}s).`);
  console.log(`Test artifacts: ${root}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
