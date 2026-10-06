const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// No browser, models, packages, timers, sockets or live services are required.
// TTS_SOURCE_ROOT lets the same tests demonstrate the failure on an unmodified tree.
const root = process.env.TTS_SOURCE_ROOT || path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'tts.js'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'readme.md'), 'utf8');
const flush = () => new Promise(setImmediate);

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function fixture() {
    const generated = [], nativeSpeech = [], audio = [], errors = [];
    const textInput = { value: '' };
    let rejectPlayback = false;
    const context = {
        location: { origin: 'https://tts.example.test' },
        navigator: { userAgent: 'offline-test', vendor: '' },
        console: { log() {}, warn() {}, error(...args) { errors.push(args); } },
        Blob,
        URL: { createObjectURL() { return 'blob:offline-test'; } },
        AudioContext: class { constructor() { this.state = 'running'; } },
        SpeechSynthesisUtterance: class { addEventListener() {} },
        speechSynthesis: {
            getVoices() { return []; },
            speak(utterance) { nativeSpeech.push(utterance.text); },
            cancel() {}
        },
        document: {
            addEventListener() {},
            getElementsByTagName() { return []; },
            getElementById(id) { return id === 'text' ? textInput : null; },
            createElement(tag) {
                assert.equal(tag, 'audio', 'Unexpected asset/model loading in offline test');
                const element = {
                    currentTime: 5, paused: false,
                    pause() { this.paused = true; },
                    play() {
                        this.paused = false;
                        if (rejectPlayback) {
                            rejectPlayback = false;
                            return Promise.reject(new Error('Simulated playback failure'));
                        }
                        return Promise.resolve();
                    }
                };
                audio.push(element);
                return element;
            }
        },
        fetch() { throw new Error('No network is permitted in this test'); }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'tts.js' });
    const TTS = context.TTS;
    return {
        context, TTS, generated, audio, errors, nativeSpeech,
        useRealProvider(provider) {
            TTS.TTSProvider = provider;
            TTS[`${provider}Loaded`] = true;
            TTS[`${provider}Instance`] = {
                speak(text) {
                    const pending = deferred();
                    generated.push({ text, ...pending });
                    return pending.promise;
                }
            };
        },
        useReadmeIntegration() {
            const integration = readme.split('### Embedding in Your Website')[1]
                .split('### Advanced Integration')[0];
            const inlineScript = integration.match(/<script>([\s\S]*?)<\/script>/);
            assert.ok(inlineScript, 'The documented integration script must exist');
            vm.runInContext(inlineScript[1], context, { filename: 'readme-integration.js' });
        },
        async clickSpeak(text) {
            textInput.value = text;
            await context.speak();
        },
        failNextPlayback() { rejectPlayback = true; },
        async resolve(index) {
            generated[index].resolve(new ArrayBuffer(4));
            await flush();
        },
        async reject(index) {
            generated[index].reject(new Error('Simulated synthesis failure'));
            await flush();
        }
    };
}

const providers = [
    ['piper', 'piperTTS'], ['espeak', 'espeakTTS'], ['kitten', 'kittenTTS'],
    ['kokoro', 'kokoroTTS'], ['google', 'googleTTS', 'GoogleAPIKey'],
    ['elevenlabs', 'ElevenLabsTTS', 'ElevenLabsKey'],
    ['speechify', 'SpeechifyTTS', 'SpeechifyAPIKey'], ['openai', 'openAITTS', 'OpenAIAPIKey']
];

function dispatchFixture(provider = providers[0]) {
    const f = fixture();
    const [name, method, key] = provider;
    f.TTS.TTSProvider = name;
    if (key) f.TTS[key] = 'offline-test-key';
    // Isolate queue dispatch for each branch; integration tests below retain real providers.
    f.TTS[method] = async text => {
        f.generated.push(text);
        f.TTS.premiumQueueActive = true;
    };
    f.TTS.audio = f.context.document.createElement('audio');
    return f;
}

for (const provider of providers) {
    test(`${provider[0]} keeps forced queued requests in order while speech is off`, () => {
        const f = dispatchFixture(provider);
        assert.equal(f.TTS.speech, false);
        for (const text of ['First', 'Second', 'Third']) f.TTS.speak(text, true);
        assert.deepEqual(f.generated, ['First']);
        f.TTS.finishedAudio();
        assert.deepEqual(f.generated, ['First', 'Second']);
        f.TTS.finishedAudio();
        assert.deepEqual(f.generated, ['First', 'Second', 'Third']);
        f.TTS.finishedAudio();
        f.TTS.finishedAudio();
        assert.equal(f.TTS.premiumQueueTTS.length, 0);
        assert.equal(f.TTS.premiumQueueActive, false);
        assert.equal(f.TTS.speech, false);
        assert.equal(f.generated.length, 3, 'Extra empty completion events must not replay text');
    });
}

test('the README integration supports repeated explicit clicks during eSpeak playback', async () => {
    const f = fixture();
    f.useReadmeIntegration();
    // The README documents changing TTSProvider to another supported engine.
    // Only the model/audio boundary is replaced; the documented speak function,
    // real TTS.speak, real espeakTTS and its onended callback all execute.
    f.useRealProvider('espeak');
    for (const text of ['First click', 'Second click', 'Third click']) await f.clickSpeak(text);
    assert.equal(f.TTS.speech, false);
    assert.deepEqual(f.generated.map(item => item.text), ['First click']);
    await f.resolve(0);
    f.TTS.audio.onended();
    assert.deepEqual(f.generated.map(item => item.text), ['First click', 'Second click']);
    await f.resolve(1);
    f.TTS.audio.onended();
    assert.deepEqual(f.generated.map(item => item.text), ['First click', 'Second click', 'Third click']);
    await f.resolve(2);
    f.TTS.audio.onended();
    assert.equal(f.TTS.premiumQueueActive, false);
    await f.clickSpeak('Later click');
    await f.resolve(3);
    f.TTS.audio.onended();
    assert.equal(f.generated.length, 4);
    assert.equal(f.errors.length, 0);
});

for (const provider of ['espeak', 'piper']) {
    test(`${provider} synthesis failure drains the next forced request`, async () => {
        const f = fixture();
        f.useRealProvider(provider);
        f.TTS.speak('Fails', true);
        f.TTS.speak('Recovers', true);
        f.TTS.speak('Then continues', true);
        await f.reject(0);
        assert.deepEqual(f.generated.map(item => item.text), ['Fails', 'Recovers']);
        await f.resolve(1);
        if (provider === 'espeak') f.TTS.audio.onended();
        assert.deepEqual(f.generated.map(item => item.text), ['Fails', 'Recovers', 'Then continues']);
        await f.resolve(2);
        if (provider === 'espeak') f.TTS.audio.onended();
        assert.equal(f.TTS.premiumQueueActive, false);
        assert.equal(f.TTS.premiumQueueTTS.length, 0);
        assert.equal(f.errors.length, 1);
    });
}

test('eSpeak playback rejection drains the next forced request', async () => {
    const f = fixture();
    f.useRealProvider('espeak');
    f.failNextPlayback();
    f.TTS.speak('Playback fails', true);
    f.TTS.speak('Playback recovers', true);
    await f.resolve(0);
    assert.deepEqual(f.generated.map(item => item.text), ['Playback fails', 'Playback recovers']);
    await f.resolve(1);
    f.TTS.audio.onended();
    assert.equal(f.TTS.premiumQueueActive, false);
    assert.equal(f.errors.length, 1);
});

test('enabled ordinary requests still drain without force', () => {
    const f = dispatchFixture();
    f.TTS.speech = true;
    f.TTS.speak('First');
    f.TTS.speak('Second');
    f.TTS.finishedAudio();
    f.TTS.finishedAudio();
    assert.deepEqual(f.generated, ['First', 'Second']);
    assert.equal(f.TTS.premiumQueueActive, false);
});

test('disabled ordinary requests do not speak or enter the queue', () => {
    const f = dispatchFixture();
    f.TTS.speak('Disabled');
    f.TTS.speak('Explicit', true);
    f.TTS.speak('Still disabled');
    assert.deepEqual(f.generated, ['Explicit']);
    assert.equal(f.TTS.premiumQueueTTS.length, 0);
    assert.equal(f.TTS.speech, false);
});

test('disabled ordinary backlog cannot strand later forced requests', () => {
    const f = dispatchFixture();
    f.TTS.speech = true;
    f.TTS.speak('Playing');
    f.TTS.speak('Ordinary queued');
    f.TTS.speak('Explicit queued', true);
    f.TTS.speak('Another ordinary queued');
    f.TTS.speak('Another explicit queued', true);
    f.TTS.speech = false;
    f.TTS.finishedAudio();
    assert.deepEqual(f.generated, ['Playing', 'Explicit queued']);
    f.TTS.finishedAudio();
    f.TTS.finishedAudio();
    assert.deepEqual(f.generated, ['Playing', 'Explicit queued', 'Another explicit queued']);
    assert.equal(f.TTS.premiumQueueTTS.length, 0);
});

test('global disable overrides force for new and queued requests', () => {
    const f = dispatchFixture();
    f.TTS.speak('Playing', true);
    f.TTS.speak('Queued', true);
    f.TTS.speak('Also queued', true);
    f.TTS.disableTTS = true;
    f.TTS.speak('Globally disabled', true);
    f.TTS.finishedAudio();
    assert.deepEqual(f.generated, ['Playing']);
    assert.equal(f.TTS.premiumQueueTTS.length, 0);
    assert.equal(f.TTS.premiumQueueActive, false);
    f.TTS.disableTTS = false;
    f.TTS.speak('New explicit request', true);
    assert.deepEqual(f.generated, ['Playing', 'New explicit request']);
});

test('toggle clears forced backlog and later explicit requests start normally', () => {
    const f = dispatchFixture();
    f.TTS.speak('Playing', true);
    f.TTS.speak('Cancelled', true);
    f.TTS.toggle();
    assert.equal(f.TTS.audio.paused, true);
    assert.equal(f.TTS.speech, false);
    assert.equal(f.TTS.premiumQueueActive, false);
    assert.equal(f.TTS.premiumQueueTTS.length, 0);
    f.TTS.finishedAudio();
    f.TTS.speak('New explicit request', true);
    f.TTS.finishedAudio();
    assert.deepEqual(f.generated, ['Playing', 'New explicit request']);
});

test('clearQueue removes pending force and keeps existing pause behavior', () => {
    const f = dispatchFixture();
    f.TTS.speak('Playing', true);
    f.TTS.speak('Cleared', true);
    f.TTS.clearQueue();
    assert.equal(f.TTS.audio.paused, true);
    assert.equal(f.TTS.premiumQueueTTS.length, 0);
    f.TTS.finishedAudio();
    f.TTS.speak('After clearing', true);
    f.TTS.finishedAudio();
    assert.deepEqual(f.generated, ['Playing', 'After clearing']);
});

test('skipCurrent advances forced requests without enabling ordinary speech', () => {
    const f = dispatchFixture();
    for (const text of ['First', 'Second', 'Third']) f.TTS.speak(text, true);
    f.TTS.skipCurrent();
    assert.deepEqual(f.generated, ['First', 'Second']);
    assert.equal(f.TTS.audio.currentTime, 0);
    f.TTS.skipCurrent();
    assert.deepEqual(f.generated, ['First', 'Second', 'Third']);
    f.TTS.finishedAudio();
    assert.equal(f.TTS.premiumQueueActive, false);
    assert.equal(f.TTS.speech, false);
});

test('browser-native speech keeps its existing force and disable behavior', () => {
    const f = fixture();
    f.TTS.speak('Explicit native request', true);
    f.TTS.speak('Disabled native request');
    f.TTS.disableTTS = true;
    f.TTS.speak('Globally disabled native request', true);
    assert.deepEqual(f.nativeSpeech, ['Explicit native request']);
    assert.equal(f.TTS.premiumQueueTTS.length, 0);
});

test('legacy string queue entries remain ordinary requests', () => {
    const f = dispatchFixture();
    f.TTS.speech = true;
    f.TTS.speak('Playing');
    f.TTS.premiumQueueTTS.push('Legacy ordinary');
    f.TTS.finishedAudio();
    assert.deepEqual(f.generated, ['Playing', 'Legacy ordinary']);
    f.TTS.premiumQueueTTS.push('Disabled legacy ordinary');
    f.TTS.speak('Explicit after legacy', true);
    f.TTS.speech = false;
    f.TTS.finishedAudio();
    assert.deepEqual(f.generated, ['Playing', 'Legacy ordinary', 'Explicit after legacy']);
});
