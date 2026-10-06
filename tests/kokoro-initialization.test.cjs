const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const sourcePath = process.env.TTS_APP_SOURCE || path.join(__dirname, '../main-enhanced-v2.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const importLine = /^import \{ KokoroTTS, TextSplitterStream, detectWebGPU \} from '\.\/dist\/lib\/kokoro-bundle\.es\.js';\r?\n/m;
assert.match(source, importLine, 'Only the known third-party import is replaced');

// Small DOM boundary double. Select values behave like a single-select DOM node:
// replacing options selects the first entry, and assigning an unknown value clears it.
class Element {
    constructor(id = '', tag = 'div') {
        this.id = id;
        this.tag = tag;
        this.options = [];
        this.children = [];
        this._value = '';
        this._html = '';
        this.style = { setProperty() {} };
        this.classList = { add() {}, remove() {} };
        this.listeners = new Map();
        this.parentElement = { appendChild() {} };
    }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    removeAttribute() {}
    get value() { return this._value; }
    set value(value) {
        this._value = this.id === 'voiceSelect' && !this.options.some(option => option.value === value)
            ? '' : value;
    }
    get innerHTML() { return this._html; }
    set innerHTML(html) {
        this._html = html;
        if (this.id !== 'voiceSelect') return;
        this.options = [...html.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)]
            .map(([, value, textContent]) => ({ value, textContent }));
        this._value = this.options[0]?.value || '';
    }
    appendChild(child) {
        this.children.push(child);
        if (this.id === 'voiceSelect') this.options.push(child);
    }
}

const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ cached = new Uint8Array([1, 2, 3]) } = {}) {
    const elements = new Map();
    const document = {
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, new Element(id));
            return elements.get(id);
        },
        createElement(tag) { return new Element('', tag); },
        querySelectorAll() { return []; },
        addEventListener() {}
    };
    const defaults = { languageSelect: 'en-US', speedSlider: '1', pitchSlider: '1', stabilitySlider: '0.5', similaritySlider: '0.5' };
    for (const [id, value] of Object.entries(defaults)) document.getElementById(id).value = value;
    const store = new Map();
    const calls = { cached: [], saved: [], loaded: [], fetched: [] };
    let completeModel;
    const modelReady = new Promise(resolve => { completeModel = resolve; });
    const model = { voices: { af_aoede: { name: 'Aoede', gender: 'Female' }, am_adam: { name: 'Adam', gender: 'Male' } } };
    const timers = new Map();
    let nextTimer = 1;
    const context = vm.createContext({
        document,
        self: {},
        window: {
            ModelCacheManager: class {
                async cleanupOldModels() { return 0; }
                async getCacheInfo() { return { totalModels: cached ? 1 : 0 }; }
                async getModel(key) { calls.cached.push(key); return cached; }
                async saveModel(key, bytes, metadata) { calls.saved.push({ key, bytes, metadata }); }
            },
            speechSynthesis: { getVoices() { return [{ name: 'Local English', lang: 'en-US' }]; } }
        },
        MutationObserver: class { observe() {} },
        localStorage: { getItem(key) { return store.get(key) ?? null; }, setItem(key, value) { store.set(key, value); } },
        console: { log() {}, warn() {}, error() {} },
        setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        Blob,
        Uint8Array,
        detectWebGPU: async () => false,
        KokoroTTS: {
            async from_pretrained(name, options) {
                calls.loaded.push({ name, options, bytes: await options.load_fn() });
                return modelReady;
            }
        },
        TextSplitterStream: class {},
        fetch: async url => {
            calls.fetched.push(url);
            const chunks = [new Uint8Array([4, 5]), new Uint8Array([6])];
            let offset = 0;
            return {
                ok: true,
                headers: { get() { return '3'; } },
                body: { getReader() { return { async read() { return offset < chunks.length ? { done: false, value: chunks[offset++] } : { done: true }; } }; } }
            };
        }
    });
    vm.runInContext(source.replace(importLine, '') + '\n;globalThis.TestApp = TTSApp;', context, { filename: sourcePath });
    const app = new context.TestApp();
    await flush();
    assert.equal(app.currentEngine, 'kokoro');
    assert.equal(app.isInitializing, true);
    assert.equal(calls.loaded.length, 1);
    return {
        app, calls, context,
        async select(engine) { app.engineSelect.value = engine; await app.onEngineChange(); },
        async finish() { completeModel(model); await flush(); assert.equal(app.isInitializing, false); }
    };
}

test('normal startup initializes Kokoro and populates its default voice', async () => {
    const f = await fixture();
    await f.finish();
    assert.equal(f.app.voiceSelect.value, 'af_aoede');
    assert.equal(f.app.engineInitStatus.kokoro, true);
    assert.deepEqual(f.app.voiceSelect.options.map(option => option.value), ['', 'af_aoede', 'am_adam']);
});

test('switching to eSpeak during Kokoro initialization preserves eSpeak voices', async () => {
    const f = await fixture();
    await f.select('espeak');
    const values = f.app.voiceSelect.options.map(option => option.value);
    assert.equal(f.app.voiceSelect.value, 'en');
    await f.finish();
    assert.equal(f.app.currentEngine, 'espeak');
    assert.equal(f.app.voiceSelect.value, 'en');
    assert.deepEqual(f.app.voiceSelect.options.map(option => option.value), values);
});

test('a user-selected eSpeak voice survives late Kokoro completion', async () => {
    const f = await fixture();
    await f.select('espeak');
    f.app.voiceSelect.value = 'fr';
    await f.finish();
    assert.equal(f.app.voiceSelect.value, 'fr');
});

test('switching to browser synthesis during initialization preserves system voices', async () => {
    const f = await fixture();
    await f.select('browser');
    assert.equal(f.app.voiceSelect.value, 'Local English');
    await f.finish();
    assert.equal(f.app.currentEngine, 'browser');
    assert.equal(f.app.voiceSelect.value, 'Local English');
    assert.deepEqual(f.app.voiceSelect.options.map(option => option.value), ['', 'Local English']);
});

test('switching away and back before initialization finishes populates Kokoro', async () => {
    const f = await fixture();
    await f.select('espeak');
    await f.select('kokoro');
    await f.finish();
    assert.equal(f.app.voiceSelect.value, 'af_aoede');
    assert.equal(f.calls.loaded.length, 1);
});

test('returning to Kokoro after it completed in the background uses the ready model', async () => {
    const f = await fixture();
    await f.select('espeak');
    await f.finish();
    await f.select('kokoro');
    assert.equal(f.app.voiceSelect.value, 'af_aoede');
    assert.equal(f.calls.loaded.length, 1);
});

test('warm-cache initialization does not download the model', async () => {
    const f = await fixture();
    await f.finish();
    assert.deepEqual(f.calls.cached, ['kokoro-82M']);
    assert.deepEqual(Array.from(f.calls.loaded[0].bytes), [1, 2, 3]);
    assert.equal(f.calls.fetched.length, 0);
    assert.equal(f.calls.saved.length, 0);
});

test('cold-cache initialization downloads ordered bytes, saves once, and passes them to the loader', async () => {
    const f = await fixture({ cached: null });
    await f.finish();
    assert.equal(f.calls.fetched.length, 1);
    assert.equal(f.calls.saved.length, 1);
    assert.equal(f.calls.saved[0].key, 'kokoro-82M');
    assert.equal(f.calls.saved[0].metadata.engine, 'kokoro');
    assert.deepEqual(Array.from(f.calls.saved[0].bytes), [4, 5, 6]);
    assert.deepEqual(Array.from(f.calls.loaded[0].bytes), [4, 5, 6]);
});
