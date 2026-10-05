const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const code = fs.readFileSync(process.env.PLAYER_SOURCE || path.join(__dirname, '..', 'waveform-player.js'), 'utf8');
const sandbox={window:{},console:{log(){},error(){}},requestAnimationFrame(){}};vm.runInNewContext(code,sandbox);
const Player=sandbox.window.WaveformPlayer;
function setup(rate='1'){
 const tasks=[],sources=[]; const p=Object.create(Player.prototype);
 Object.assign(p,{audioBuffer:{duration:30},audioContext:{state:'running',currentTime:0,createBufferSource(){const s={playbackRate:{value:1},connect(){},start(when,offset){this.offset=offset},stop(){this.stopped=true;tasks.push(()=>this.onended?.())}};sources.push(s);return s;}},gainNode:{},isLooping:false,pauseTime:0,startTime:0,isPlaying:false,duration:30,rateSelector:{value:rate},playIcon:{style:{}},pauseIcon:{style:{}},currentTimeEl:{},progressCanvas:{width:600,height:100},progressCtx:{clearRect(){}},drawProgress(){}});
 return {p,tasks,sources,flush(){let n=0;while(tasks.length){assert.ok(n++<10);tasks.shift()();}}};
}
test('natural completion resets playback', () => {
 const h=setup(); h.p.play(); h.p.audioContext.currentTime=5;
 assert.equal(h.p.getCurrentTime(),5); h.sources[0].onended(); h.flush();
 assert.equal(h.p.isPlaying,false); assert.equal(h.p.pauseTime,0);
});
test('pause retains position after queued ended event', () => {
 const h=setup(); h.p.play(); h.p.audioContext.currentTime=5; h.p.pause(); h.flush();
 assert.equal(h.p.pauseTime,5); h.p.play(); assert.equal(h.sources[1].offset,5);
});
test('seek does not let old ended event stop replacement', () => {
 const h=setup(); h.p.play(); h.p.audioContext.currentTime=2; h.p.seek(10); h.flush();
 assert.equal(h.sources[1].offset,10); assert.equal(h.p.source,h.sources[1]);
 assert.equal(h.p.isPlaying,true); assert.notEqual(h.sources[1].stopped,true);
});
test('immediate resume survives queued ended event', () => {
 const h=setup(); h.p.play(); h.p.audioContext.currentTime=5; h.p.pause(); h.p.play(); h.flush();
 assert.equal(h.sources[1].offset,5); assert.equal(h.p.isPlaying,true);
 assert.notEqual(h.sources[1].stopped,true);
});
test('captured stale callback cannot stop a replacement', () => {
 const h=setup(); h.p.play(); const stale=h.sources[0].onended;
 h.p.audioContext.currentTime=5; h.p.seek(10); stale(); h.flush();
 assert.equal(h.p.isPlaying,true); assert.equal(h.p.source,h.sources[1]);
 assert.equal(h.p.pauseTime,10);
});
test('explicit stop resets state despite queued event', () => {
 const h=setup(); h.p.play(); h.p.audioContext.currentTime=5; h.p.stop(); h.flush();
 assert.equal(h.p.isPlaying,false); assert.equal(h.p.pauseTime,0); assert.equal(h.p.source,null);
});
test('repeated pause-resume cycles retain progress', () => {
 const h=setup(); h.p.play();
 for(let i=1;i<=3;i++){h.p.audioContext.currentTime=i*5;h.p.pause();h.flush();
 assert.equal(h.p.pauseTime,i*5);h.p.play();assert.equal(h.p.source.offset,i*5);}
});
test('looping pause-resume still retains position', () => {
 const h=setup();h.p.isLooping=true;h.p.play();h.p.audioContext.currentTime=5;h.p.pause();h.flush();h.p.play();
 assert.equal(h.p.source.offset,5);assert.equal(h.p.source.loop,true);
});
test('current source still completes after seeking', () => {
 const h=setup();h.p.play();h.p.seek(10);h.flush();h.sources[1].onended();h.flush();
 assert.equal(h.p.isPlaying,false);assert.equal(h.p.pauseTime,0);
});
