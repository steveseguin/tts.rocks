// pocket-tts-js — browser API for the Pocket TTS ONNX model.
//
// All heavy work happens in a Web Worker, so synthesis never blocks the UI.
// Only the files required for the chosen language + quantization are
// downloaded; the voice encoder is fetched only when cloning is enabled, and
// built-in voices (voices.bin) only when one is actually requested.

const DEFAULT_MODEL_BASE_URL = "https://huggingface.co/vlapky/pocket-tts-onnx/resolve/main/onnx";
const DEFAULT_ORT_BASE_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/";
// Keep in sync with CACHE_NAME in worker.js.
const CACHE_NAME = "pocket-tts-js-v1";

export const LANGUAGES = [
    "english_2026-04",
    "french_24l",
    "german",
    "german_24l",
    "italian",
    "italian_24l",
    "portuguese",
    "portuguese_24l",
    "spanish",
    "spanish_24l",
];

export class PocketTTS {
    /**
     * @param {object} [options]
     * @param {string} [options.language="english_2026-04"]  Language bundle to load.
     * @param {boolean} [options.quantized=true]  Use INT8 models (smaller/faster) vs full precision.
     * @param {boolean} [options.voiceCloning=true]  Download the encoder so cloneVoice() works.
     * @param {string} [options.modelBaseUrl]  Base URL of the `onnx/` folder on Hugging Face.
     * @param {string} [options.ortBaseUrl]  Base URL for onnxruntime-web dist files.
     * @param {string} [options.voicesUrl]  Optional explicit URL to a voices.bin for built-in voices.
     * @param {number} [options.maxThreads=8]  Max WASM threads (needs cross-origin isolation).
     * @param {boolean} [options.cache=true]  Persist downloaded assets in Cache Storage so later loads are instant/offline.
     * @param {string} [options.cacheName]  Override the Cache Storage bucket name.
     */
    constructor(options = {}) {
        this.options = {
            language: options.language || "english_2026-04",
            quantized: options.quantized !== false,
            voiceCloning: options.voiceCloning !== false,
            modelBaseUrl: (options.modelBaseUrl || DEFAULT_MODEL_BASE_URL).replace(/\/$/, ""),
            ortBaseUrl: options.ortBaseUrl || DEFAULT_ORT_BASE_URL,
            voicesUrl: options.voicesUrl || null,
            maxThreads: options.maxThreads || 8,
            cache: options.cache !== false,
            cacheName: options.cacheName || CACHE_NAME,
        };

        this.worker = null;
        this.bundle = null;
        this.ready = false;
        this._nextId = 1;
        this._pending = new Map();
        this._onChunk = null;
        this._onProgress = null;
        this._cloneCounter = 0;
    }

    get sampleRate() {
        return this.bundle ? this.bundle.sampleRate : 24000;
    }

    get predefinedVoices() {
        return this.bundle ? this.bundle.predefinedVoices : [];
    }

    _ensureWorker() {
        if (this.worker) return;
        this.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
        this.worker.onmessage = (e) => this._handleMessage(e.data);
        this.worker.onerror = (e) => {
            const err = new Error(e.message || "Worker error");
            for (const { reject } of this._pending.values()) reject(err);
            this._pending.clear();
        };
    }

    _handleMessage(msg) {
        switch (msg.type) {
            case "ready":
                this.bundle = msg.bundle;
                return;
            case "chunk":
                if (this._onChunk) this._onChunk(msg.audio, msg.meta);
                return;
            case "progress":
                if (this._onProgress) this._onProgress(msg);
                return;
            case "status":
                if (this._onProgress) this._onProgress(msg);
                return;
            case "result": {
                const p = this._pending.get(msg.id);
                if (p) {
                    this._pending.delete(msg.id);
                    p.resolve(msg.result);
                }
                return;
            }
            case "error": {
                const p = this._pending.get(msg.id);
                if (p) {
                    this._pending.delete(msg.id);
                    p.reject(new Error(msg.error));
                } else if (this._onChunk || this._onProgress) {
                    // Surface uncorrelated errors via the active stream.
                    const err = new Error(msg.error);
                    for (const { reject } of this._pending.values()) reject(err);
                    this._pending.clear();
                }
                return;
            }
            default:
                return;
        }
    }

    _request(type, payload, transfer) {
        this._ensureWorker();
        const id = this._nextId++;
        return new Promise((resolve, reject) => {
            this._pending.set(id, { resolve, reject });
            this.worker.postMessage({ id, type, payload }, transfer || []);
        });
    }

    /**
     * Download the runtime + selected models and initialise the engine.
     * @param {(info: {type:string,label?:string,loaded?:number,total?:number,status?:string}) => void} [onProgress]
     */
    async load(onProgress) {
        this._onProgress = onProgress || null;
        // The worker emits a `ready` message (captured in _handleMessage,
        // populating this.bundle) before resolving the init request.
        await this._request("init", this.options);
        this.ready = true;
        return this.bundle;
    }

    /**
     * Clone a voice from a mono reference clip.
     * @param {Float32Array} audio  Mono PCM. Resampled to the model rate if needed via `inputSampleRate`.
     * @param {object} [opts]
     * @param {number} [opts.inputSampleRate]  Sample rate of `audio` (defaults to model rate).
     * @param {string} [opts.name]  Optional id; auto-generated otherwise.
     * @returns {Promise<string>} A voice reference usable in generate().
     */
    async cloneVoice(audio, opts = {}) {
        if (!this.options.voiceCloning) throw new Error("voiceCloning is disabled in options.");
        let pcm = audio;
        const target = this.sampleRate;
        if (opts.inputSampleRate && opts.inputSampleRate !== target) {
            pcm = resampleLinear(audio, opts.inputSampleRate, target);
        }
        // Cap the reference to 10 s (matches model expectations).
        const maxSamples = target * 10;
        if (pcm.length > maxSamples) pcm = pcm.slice(0, maxSamples);

        const ref = opts.name || `clone:${++this._cloneCounter}`;
        const buf = pcm.buffer === audio.buffer ? pcm.slice() : pcm;
        const { ref: out } = await this._request("cloneVoice", { audio: buf, ref }, [buf.buffer]);
        return out;
    }

    /**
     * Prepare a built-in voice (requires voices.bin to be available).
     * @param {string} name
     * @returns {Promise<string>} A voice reference usable in generate().
     */
    async loadVoice(name) {
        const { ref } = await this._request("loadBuiltinVoice", { name });
        return ref;
    }

    /**
     * Synthesize speech, streaming audio chunks as they are produced.
     * @param {string} text
     * @param {object} opts
     * @param {string} opts.voice  A voice reference from cloneVoice()/loadVoice().
     * @param {(audio: Float32Array, meta: object) => void} [opts.onChunk]  Per-chunk callback (mono Float32 @ sampleRate).
     * @returns {Promise<{rtfx:number,genTime:number,audioDuration:number}>}
     */
    async generate(text, opts = {}) {
        if (!opts.voice) throw new Error("generate() requires a `voice` reference.");
        this._onChunk = opts.onChunk || null;
        try {
            const { metrics } = await this._request("generate", { text, voiceRef: opts.voice });
            return metrics;
        } finally {
            this._onChunk = null;
        }
    }

    /** Request the current generation to stop early. */
    async stop() {
        if (!this.worker) return;
        await this._request("stop", {});
    }

    /** Terminate the worker and free all resources. */
    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        for (const { reject } of this._pending.values()) reject(new DOMException('Generation stopped', 'AbortError'));
        this._pending.clear();
        this.ready = false;
        this.bundle = null;
    }

    /**
     * Delete all assets persisted in Cache Storage (forces a fresh download next load).
     * @param {string} [cacheName]  Defaults to the library's bucket.
     */
    static async clearCache(cacheName = CACHE_NAME) {
        if (typeof caches === "undefined") return false;
        return caches.delete(cacheName);
    }

    /**
     * Estimate how much the library has persisted (and the browser's quota), via
     * the Storage Manager API. Returns `null` if unsupported.
     * @returns {Promise<{usage:number, quota:number} | null>}
     */
    static async storageEstimate() {
        if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
        const { usage, quota } = await navigator.storage.estimate();
        return { usage, quota };
    }
}

// Simple linear resampler for reference clips.
export function resampleLinear(data, sourceRate, targetRate) {
    if (sourceRate === targetRate) return data;
    const ratio = sourceRate / targetRate;
    const outLength = Math.floor(data.length / ratio);
    const out = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
        const srcIndex = i * ratio;
        const floor = Math.floor(srcIndex);
        const ceil = Math.min(floor + 1, data.length - 1);
        const t = srcIndex - floor;
        out[i] = data[floor] * (1 - t) + data[ceil] * t;
    }
    return out;
}

export { SentencePieceTokenizer } from "./tokenizer.js";
export { StreamingPlayer, chunksToWavBlob } from "./player.js";
