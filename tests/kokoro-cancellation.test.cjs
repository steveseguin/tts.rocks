const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = process.env.SOURCE_ROOT || require('node:path').join(__dirname, '..');
const source = fs.readFileSync(require('node:path').join(root, 'main-enhanced-v2.js'), 'utf8');
const test = require('node:test');
const results = [];
const defer = () => { let resolve, reject; const promise = new Promise((r,j)=>{resolve=r;reject=j}); return {promise,resolve,reject}; };
function fixture() {
  const streams=[], loads=[], plays=[], downloads=[], statuses=[];
  const element=()=>({style:{},value:'',disabled:false,classList:{add(){},remove(){}},addEventListener(){}});
  const context={console:{log(){},error(){},warn(){}},Blob,ArrayBuffer,AbortController,setTimeout,clearTimeout,
    TextSplitterStream:class {push(text){this.text=text}close(){}},
    SpeechSynthesisUtterance:class {constructor(text){this.text=text}},
    URL:{createObjectURL(blob){downloads.push(blob);return 'blob:fixture'},revokeObjectURL(){}},
    document:{addEventListener(){},createElement(){return {click(){}}}},
    speechSynthesis:{cancel(){},getVoices(){return []},speak(u){queueMicrotask(()=>u.onend())}},
    TTS:{audioContext:{}},localStorage:{getItem(){return null}},fetch(){throw Error('Offline test must not fetch')} };
  context.window=context;vm.createContext(context);
  vm.runInContext(source.replace(/^import .*;\r?\n/m,'')+'\nglobalThis.TTSApp=TTSApp;',context);
  const app=Object.create(context.TTSApp.prototype);
  Object.assign(app,{currentEngine:'kokoro',isGenerating:false,isInitializing:false,audioBlob:null,activeGeneration:null,kokoroGeneration:null,
    textInput:{value:'First text'},voiceSelect:{value:'af_aoede'},speedSlider:{value:'1'},pitchSlider:{value:'1'},languageSelect:{value:'en-US'},
    generateBtn:element(),downloadBtn:element(),stopBtn:element(),audioSection:element(),audioPlayer:{src:'',pause(){},currentTime:0},
    showStatus(message,type){statuses.push({message,type})},
    waveformPlayer:{async loadAudio(blob){loads.push(blob);this.blob=blob},play(){plays.push(this.blob)},stop(){}},
    kokoroTTS:{stream(input,options){const d=defer();streams.push({text:input.text,options,...d});return (async function*(){yield await d.promise;})()}} });
  function finish(i){const stream=streams[i];stream.resolve({audio:{toBlob(){return new Blob([stream.text],{type:'audio/wav'})}}})}
  return {app,context,streams,loads,plays,downloads,statuses,finish};
}
test('ordinary generation plays and downloads its own blob',async()=>{const f=fixture();const p=f.app.generateSpeech();f.finish(0);await p;assert.equal(await f.app.audioBlob.text(),'First text');assert.equal(f.plays.length,1);f.app.downloadAudio();assert.equal(await f.downloads[0].text(),'First text');});
test('Stop discards pending result and leaves download disabled',async()=>{const f=fixture();const p=f.app.generateSpeech();f.app.stopGeneration();f.finish(0);await p;assert.equal(f.app.audioBlob,null);assert.equal(f.plays.length,0);assert.equal(f.app.downloadBtn.disabled,true);});
test('Stop keeps shared producer locked until resolution',async()=>{const f=fixture();const p=f.app.generateSpeech();f.app.stopGeneration();f.app.generateSpeech();assert.equal(f.streams.length,1);assert.equal(f.app.isGenerating,true);assert.equal(f.app.generateBtn.disabled,true);f.finish(0);await p;assert.equal(f.app.isGenerating,false);assert.equal(f.app.generateBtn.disabled,false);});
test('next valid request succeeds after cancelled result drains',async()=>{const f=fixture();const p=f.app.generateSpeech();f.app.stopGeneration();f.finish(0);await p;f.app.textInput.value='Second text';const next=f.app.generateSpeech();f.finish(1);await next;assert.equal(await f.app.audioBlob.text(),'Second text');assert.equal(f.plays.length,1);assert.equal(f.app.downloadBtn.disabled,false);});
test('cancelled rejection recovers controls without publishing error',async()=>{const f=fixture();const p=f.app.generateSpeech();f.app.stopGeneration();f.streams[0].reject(Error('cancelled old inference'));await p;assert.equal(f.app.generateBtn.disabled,false);assert.equal(f.app.isGenerating,false);assert.equal(f.statuses.length,0);const next=f.app.generateSpeech();f.finish(1);await next;assert.equal(f.plays.length,1);});
test('uncancelled rejection still displays an error and recovers',async()=>{const f=fixture();const p=f.app.generateSpeech();f.streams[0].reject(Error('inference failed'));await p;assert.equal(f.statuses.length,1);assert.match(f.statuses[0].message,/inference failed/);assert.equal(f.app.generateBtn.disabled,false);});
test('Stop immediately stops active waveform and audio elements',async()=>{const f=fixture();let stopped=0,paused=0;f.app.waveformPlayer.stop=()=>stopped++;f.app.audioPlayer.pause=()=>paused++;const p=f.app.generateSpeech();f.app.stopGeneration();assert.equal(stopped,1);assert.equal(paused,1);f.finish(0);await p;});
test('Stop during decode cannot autoplay or expose cancelled export',async()=>{const f=fixture();const decode=defer();f.app.waveformPlayer.loadAudio=async()=>decode.promise;const p=f.app.generateSpeech();f.finish(0);for(let i=0;i<10;i++)await Promise.resolve();f.app.stopGeneration();decode.resolve();await p;assert.equal(f.app.audioBlob,null);assert.equal(f.plays.length,0);assert.equal(f.app.downloadBtn.disabled,true);});
test('button state refresh keeps a draining generation disabled',async()=>{const f=fixture();const p=f.app.generateSpeech();f.app.stopGeneration();f.app.updateGenerateButtonState();assert.equal(f.app.generateBtn.disabled,true);f.finish(0);await p;});
test('repeated Stop and Generate attempts do not create overlapping inference',async()=>{const f=fixture();const p=f.app.generateSpeech();for(let i=0;i<20;i++){f.app.stopGeneration();f.app.generateSpeech();}assert.equal(f.streams.length,1);f.finish(0);await p;assert.equal(f.app.activeGeneration,null);});
test('cancelled browser completion cannot release a newer Kokoro lock',async()=>{const f=fixture();let utterance;f.context.speechSynthesis.speak=u=>utterance=u;f.app.currentEngine='browser';const first=f.app.generateSpeech();f.app.stopGeneration();f.app.currentEngine='kokoro';const second=f.app.generateSpeech();utterance.onerror(Error('interrupted'));await first;assert.equal(f.app.isGenerating,true);assert.equal(f.app.generateBtn.disabled,true);assert.ok(f.app.kokoroGeneration);f.finish(0);await second;assert.equal(f.plays.length,1);});
function waveformFixture(){
 const ctx={console:{log(){},error(){}},window:{},Blob,ArrayBuffer,AudioBuffer:class{},setTimeout(){},AbortController};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('node:path').join(root,'waveform-player.js'),'utf8')+'\nglobalThis.Player=WaveformPlayer;',ctx);const player=Object.create(ctx.Player.prototype), decode=defer(),old={duration:2};Object.assign(player,{audioBuffer:old,duration:2,audioContext:{decodeAudioData:()=>decode.promise},totalTimeEl:{textContent:'0:02'},playPauseBtn:{disabled:true},peaks:[],resizeCanvases(){},generateWaveform(){},drawWaveform(){},formatTime:t=>String(t)});return {player,decode,old};
}
test('actual waveform preserves old buffer when cancelled during decode',async()=>{const f=waveformFixture();const c=new AbortController();const p=f.player.loadAudio(new ArrayBuffer(4),c.signal);c.abort();f.decode.resolve({duration:8});await p;assert.equal(f.player.audioBuffer,f.old);assert.equal(f.player.duration,2);assert.equal(f.player.playPauseBtn.disabled,true);});
test('actual waveform still accepts normal loads without a signal',async()=>{const f=waveformFixture();const next={duration:8};const p=f.player.loadAudio(new ArrayBuffer(4));f.decode.resolve(next);await p;assert.equal(f.player.audioBuffer,next);assert.equal(f.player.duration,8);assert.equal(f.player.playPauseBtn.disabled,false);});
test('actual waveform skips already cancelled loads',async()=>{const f=waveformFixture();let calls=0;f.player.audioContext.decodeAudioData=()=>{calls++;};const c=new AbortController();c.abort();await f.player.loadAudio(new ArrayBuffer(4),c.signal);assert.equal(calls,0);assert.equal(f.player.audioBuffer,f.old);});
