const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = process.env.TTS_SOURCE_ROOT || path.join(__dirname, '..');
const voices = ['en_US-amy-medium', 'en_US-danny-low', 'en_GB-alan-low', 'en_GB-alba-medium'];
const legacyVoice = 'en_US-hfc_female-medium';
const base = 'https://tts.example.test';
const asset = voice => `${base}/thirdparty/piper/piper-voices/${voices.includes(voice) ? `${voice}/` : ''}${voice}`;

function fixture() {
    const requests = [], spoken = [], failures = new Set(), synthesisGates = new Map();
    const document = {
        currentScript: { src: `${base}/thirdparty/piper/piper-tts-proper.js` },
        addEventListener() {}, getElementsByTagName() { return []; }, getElementById() { return null; },
        createElement() { return { style: {} }; },
        head: { appendChild(script) { queueMicrotask(() => script.onload()); } }
    };
    const context = {
        document, location: { origin: base, href: `${base}/index.html` },
        navigator: { userAgent: 'offline-test', vendor: '' },
        console: { log() {}, warn() {}, error() {} },
        Blob, URL: { createObjectURL() { return 'blob:offline-test'; }, revokeObjectURL() {} },
        setTimeout(callback) { queueMicrotask(callback); return 1; }, clearTimeout() {},
        setInterval() { return 1; }, clearInterval() {},
        AudioContext: class { constructor() { this.state = 'running'; } },
        Audio: class {
            async play() {}
            set onended(callback) { queueMicrotask(callback); }
        },
        speechSynthesis: { getVoices() { return []; } },
        ort: { env: { wasm: {} }, InferenceSession: { async create() { return {}; } } },
        async fetch(url) {
            requests.push(url);
            const voice = [...voices, legacyVoice].find(id => url === `${asset(id)}.onnx` || url === `${asset(id)}.onnx.json`);
            if (!voice || failures.has(voice)) return { ok: false, status: 404 };
            return { ok: true, async json() { return { audio: { sample_rate: 22050 }, espeak: { voice: 'en-us' } }; }, async arrayBuffer() { return new ArrayBuffer(4); } };
        }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, 'tts.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'thirdparty/piper/piper-tts-proper.js'), 'utf8'), context);
    const Provider = context.ProperPiperTTS;
    // Boundary doubles replace phonemizer/model inference and audio completion only.
    // Production initialization, asset URLs, voice changes, queues and app dispatch run unchanged.
    Provider.prototype.loadPhonemizer = async function () {};
    Provider.prototype.synthesize = async function (text, speed) {
        const gate = synthesisGates.get(this.voiceId);
        if (gate) await gate;
        spoken.push({ voice: this.voiceId, text, speed });
        return new Blob(['synthetic audio'], { type: 'audio/wav' });
    };
    const source = fs.readFileSync(path.join(root, 'main-enhanced-v2.js'), 'utf8');
    vm.runInContext(source.replace(/^import .*;\r?\n/m, '') + '\nglobalThis.App = TTSApp;', context);
    const app = Object.create(context.App.prototype);
    Object.assign(app, {
        voiceSelect: { value: voices[0] }, speedSlider: { value: '1' }, pitchSlider: { value: '1' },
        audioSection: { style: {} }, showInlineProgress() {}, hideInlineProgress() {}
    });
    return {
        app, context, requests, spoken, failures, synthesisGates,
        async generate(voice, text = 'Voice selection test') {
            app.voiceSelect.value = voice;
            await app.generateWithTTSLib('piper', text);
            await new Promise(setImmediate);
        }
    };
}

for (const voice of voices) {
    test(`the first generation uses selected ${voice} and its bundled asset paths`, async () => {
        const f = fixture();
        await f.generate(voice);
        assert.equal(f.context.TTS.piperSettings.voice, voice);
        assert.equal(f.context.TTS.piperInstance.getCurrentVoice(), voice);
        assert.deepEqual(f.spoken.map(item => item.voice), [voice]);
        assert.deepEqual(f.requests, [`${asset(voice)}.onnx.json`, `${asset(voice)}.onnx`]);
    });
}

test('changing all four voices loads the selected provider and speaks each selection', async () => {
    const f = fixture();
    await f.generate(voices[0]);
    const provider = f.context.TTS.piperInstance;
    for (const voice of voices.slice(1)) {
        await f.generate(voice);
        assert.notEqual(f.context.TTS.piperInstance, provider);
    }
    assert.deepEqual(f.spoken.map(item => item.voice), voices);
    assert.deepEqual(f.requests, voices.flatMap(voice => [`${asset(voice)}.onnx.json`, `${asset(voice)}.onnx`]));
});

test('repeating the same voice reuses its initialized model', async () => {
    const f = fixture();
    await f.generate(voices[1]);
    await f.generate(voices[1]);
    assert.deepEqual(f.spoken.map(item => item.voice), [voices[1], voices[1]]);
    assert.equal(f.requests.length, 2);
});

test('the legacy HFC voice retains its existing flat model paths', async () => {
    const f = fixture();
    f.context.TTS.piperSettings.voice = legacyVoice;
    assert.equal(await f.context.TTS.initPiper(), true);
    assert.equal(f.context.TTS.piperInstance.getCurrentVoice(), legacyVoice);
    assert.deepEqual(f.requests, [`${asset(legacyVoice)}.onnx.json`, `${asset(legacyVoice)}.onnx`]);
});

test('a failed initial model load does not speak a different voice and can retry', async () => {
    const f = fixture();
    f.failures.add(voices[2]);
    await f.generate(voices[2]);
    assert.equal(f.context.TTS.piperLoaded, false);
    assert.equal(f.spoken.length, 0);
    f.failures.clear();
    await f.generate(voices[2]);
    assert.deepEqual(f.spoken.map(item => item.voice), [voices[2]]);
    assert.equal(f.context.TTS.piperLoaded, true);
});

test('a failed voice change does not fall back to the previous voice and can retry', async () => {
    const f = fixture();
    await f.generate(voices[0]);
    f.failures.add(voices[3]);
    await f.generate(voices[3]);
    assert.equal(f.context.TTS.piperLoaded, false);
    assert.deepEqual(f.spoken.map(item => item.voice), [voices[0]]);
    f.failures.clear();
    await f.generate(voices[3]);
    assert.deepEqual(f.spoken.map(item => item.voice), [voices[0], voices[3]]);
});

for (const enabled of [false, true]) {
    test(`switching voices preserves in-flight speech (queue enabled: ${enabled})`, async () => {
        const f = fixture();
        f.context.TTS.speech = enabled;
        let finishFirst;
        f.synthesisGates.set(voices[0], new Promise(resolve => { finishFirst = resolve; }));
        await f.generate(voices[0], 'First sentence');
        const first = f.context.TTS.piperInstance;
        const session = first.session;
        const config = first.voiceConfig;
        assert.equal(first.isProcessingQueue, true);
        await f.generate(voices[1], 'Second sentence');
        assert.notEqual(f.context.TTS.piperInstance, first);
        assert.equal(first.getCurrentVoice(), voices[0]);
        assert.equal(first.session, session);
        assert.equal(first.voiceConfig, config);
        finishFirst();
        await new Promise(setImmediate);
        assert.equal(f.spoken[0].voice, voices[0]);
        assert.equal(f.spoken[0].text, 'First sentence');
        if (enabled) assert.deepEqual(f.spoken.map(item => item.voice), voices.slice(0, 2));
    });
}
