// Pocket TTS inference worker.
//
// Runs entirely off the main thread so synthesis never blocks the UI. It
// dynamically imports onnxruntime-web from a CDN (kept out of the npm bundle to
// stay tiny) and downloads only the model files actually needed for the chosen
// language + quantization, plus the voice encoder only when cloning is enabled.

import { SentencePieceTokenizer } from "./tokenizer.js";
import { parseNpyFloat32, parseVoiceStatesBin } from "./binary.js";

let ort = null;

const MODEL_STEMS = ["mimi_encoder", "text_conditioner", "flow_lm_main", "flow_lm_flow", "mimi_decoder"];

// Bump the version suffix to invalidate previously cached assets.
const CACHE_NAME = "pocket-tts-js-v1";

const CHUNK_GAP_SEC = 0.25;
const MAX_FRAMES = 500;
const LSD_STEPS = 1;
const TEMPERATURE = 0.7;
const EOS_THRESHOLD = -4.0;

// ----- configurable state (set at init) -----
let config = null;
let bundleMetadata = null;
let tokenizer = null;
let bosBeforeVoice = null;

let mimiEncoderSession = null;
let textConditionerSession = null;
let flowLmMainSession = null;
let flowLmFlowSession = null;
let mimiDecoderSession = null;

let sampleRate = 24000;
let samplesPerFrame = 1920;
let latentDim = 32;
let conditioningDim = 1024;
let maxTokenPerChunk = 50;

let predefinedVoiceRecords = null; // lazily loaded from voices.bin
let voiceStateCache = new Map(); // voiceRef -> conditioned flow_lm state
let customEmbeddings = new Map(); // voiceRef -> mimi embedding for cloned voices

let stTensors = [];
let isGenerating = false;

function modelUrl(language, filename) {
    return `${config.modelBaseUrl}/${language}/${filename}`;
}

function stem(name) {
    return config.quantized ? `${name}_int8.onnx` : `${name}.onnx`;
}

function post(msg, transfer) {
    self.postMessage(msg, transfer || []);
}

// ----- tensor helpers (ported from the reference implementation) -----

function makeFilledArray(shape, dtype, fill) {
    const size = shape.reduce((a, b) => a * b, 1);
    if (dtype === "int64") return new BigInt64Array(size);
    if (dtype === "bool") return new Uint8Array(size);
    const data = new Float32Array(size);
    if (fill === "nan") data.fill(NaN);
    else if (fill === "ones") data.fill(1);
    return data;
}

function createTensor(dtype, data, dims) {
    return new ort.Tensor(dtype, data, dims);
}

function initStateFromManifest(manifest) {
    const state = {};
    for (const entry of manifest) {
        state[entry.input_name] = createTensor(
            entry.dtype,
            makeFilledArray(entry.shape, entry.dtype, entry.fill),
            entry.shape
        );
    }
    return state;
}

function updateStateFromManifestOutputs(state, result, manifest) {
    for (const entry of manifest) {
        state[entry.input_name] = result[entry.output_name];
    }
}

function groupVoiceRecordByModule(record) {
    const grouped = {};
    for (const [key, value] of Object.entries(record)) {
        const slash = key.indexOf("/");
        if (slash === -1) continue;
        const moduleName = key.slice(0, slash);
        const tensorKey = key.slice(slash + 1);
        if (!grouped[moduleName]) grouped[moduleName] = {};
        grouped[moduleName][tensorKey] = value;
    }
    return grouped;
}

function adaptTypedArray(source, entry) {
    const targetShape = entry.shape;
    const targetSize = targetShape.reduce((a, b) => a * b, 1);
    const target = makeFilledArray(targetShape, entry.dtype, entry.fill);

    const cast = (src) => {
        if (entry.dtype === "int64") return new BigInt64Array(src);
        if (entry.dtype === "bool") return new Uint8Array(src);
        return new Float32Array(src);
    };

    if (source.shape.length === targetShape.length) {
        if (source.shape.every((dim, idx) => dim === targetShape[idx])) return cast(source.data);
    }
    if (source.data.length === targetSize) return cast(source.data);
    if (source.shape.length !== targetShape.length) return target;

    const strides = [];
    let stride = 1;
    for (let i = source.shape.length - 1; i >= 0; i--) {
        strides[i] = stride;
        stride *= source.shape[i];
    }
    const indices = new Array(source.shape.length).fill(0);
    const maxIndices = source.shape.map((dim, idx) => Math.min(dim, targetShape[idx]));

    function targetIndex(coords) {
        let idx = 0;
        let tStride = 1;
        for (let i = targetShape.length - 1; i >= 0; i--) {
            idx += coords[i] * tStride;
            tStride *= targetShape[i];
        }
        return idx;
    }

    let done = false;
    while (!done) {
        let sourceIdx = 0;
        for (let i = 0; i < indices.length; i++) sourceIdx += indices[i] * strides[i];
        target[targetIndex(indices)] = source.data[sourceIdx];
        for (let dim = indices.length - 1; dim >= 0; dim--) {
            indices[dim] += 1;
            if (indices[dim] < maxIndices[dim]) break;
            indices[dim] = 0;
            if (dim === 0) done = true;
        }
    }
    return target;
}

function deriveStep(moduleState) {
    if (moduleState.step) {
        return { data: BigInt64Array.from([BigInt(moduleState.step.data[0])]), shape: [1], dtype: "int64" };
    }
    if (moduleState.offset && !moduleState.end_offset) {
        return { data: BigInt64Array.from([BigInt(moduleState.offset.data[0])]), shape: [1], dtype: "int64" };
    }
    if (moduleState.current_end) {
        return { data: BigInt64Array.from([BigInt(moduleState.current_end.shape[0])]), shape: [1], dtype: "int64" };
    }
    return { data: BigInt64Array.from([0n]), shape: [1], dtype: "int64" };
}

function stateFromVoiceRecord(record) {
    const grouped = groupVoiceRecordByModule(record);
    const state = initStateFromManifest(bundleMetadata.flow_lm_state_manifest);
    for (const entry of bundleMetadata.flow_lm_state_manifest) {
        const moduleState = grouped[entry.module] || {};
        let source = moduleState[entry.key];
        if (!source && entry.key === "step") source = deriveStep(moduleState);
        if (!source) continue;
        const data = adaptTypedArray(source, entry);
        state[entry.input_name] = createTensor(entry.dtype, data, entry.shape);
    }
    return state;
}

function prepareVoiceEmbeddingData(voiceEmb) {
    let data = voiceEmb.data;
    let dims = voiceEmb.shape.slice();
    if (bundleMetadata.insert_bos_before_voice && bosBeforeVoice) {
        const bosData = bosBeforeVoice.data;
        const combined = new Float32Array(bosData.length + data.length);
        combined.set(bosData, 0);
        combined.set(data, bosData.length);
        data = combined;
        dims = [1, dims[1] + bosBeforeVoice.shape[1], dims[2]];
    }
    return createTensor("float32", data, dims);
}

async function buildVoiceConditionedState(voiceEmb) {
    const flowLmState = initStateFromManifest(bundleMetadata.flow_lm_state_manifest);
    const emptySeq = createTensor("float32", new Float32Array(0), [1, 0, latentDim]);
    const voiceTensor = prepareVoiceEmbeddingData(voiceEmb);
    const result = await flowLmMainSession.run({
        sequence: emptySeq,
        text_embeddings: voiceTensor,
        ...flowLmState,
    });
    updateStateFromManifestOutputs(flowLmState, result, bundleMetadata.flow_lm_state_manifest);
    return flowLmState;
}

async function encodeVoiceAudio(audioData) {
    if (!mimiEncoderSession) throw new Error("Voice cloning is disabled (encoder not loaded).");
    const input = createTensor("float32", audioData, [1, 1, audioData.length]);
    const outputs = await mimiEncoderSession.run({ audio: input });
    const embeddings = outputs[mimiEncoderSession.outputNames[0]];
    let dims = embeddings.dims.slice();
    const data = new Float32Array(embeddings.data);
    while (dims.length > 3) {
        if (dims[0] !== 1) break;
        dims = dims.slice(1);
    }
    if (dims.length < 3) dims = [1, dims[0], dims[1]];
    return { data, shape: dims };
}

// ----- text chunking -----

function prepareTextPrompt(text) {
    let prompt = text.trim();
    if (!prompt) return { text: "", framesAfterEos: 1 };
    prompt = prompt.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ");
    if (bundleMetadata.remove_semicolons) prompt = prompt.replace(/;/g, ",");

    const wordCount = prompt.split(/\s+/).filter(Boolean).length;
    let framesAfterEos = wordCount <= 4 ? 3 : 1;
    if (bundleMetadata.model_recommended_frames_after_eos != null) {
        framesAfterEos = Number(bundleMetadata.model_recommended_frames_after_eos);
    }
    if (prompt && !/[A-ZÀ-Þ]/.test(prompt[0])) prompt = prompt[0].toUpperCase() + prompt.slice(1);
    if (prompt && /[0-9A-Za-zÀ-ÿ]/.test(prompt[prompt.length - 1])) prompt += ".";
    if (bundleMetadata.pad_with_spaces_for_short_inputs && wordCount < 5) prompt = "        " + prompt;
    return { text: prompt, framesAfterEos };
}

const SENTENCE_SPLIT_RE = /[^.!?]+[.!?]+|[^.!?]+$/g;

function splitTextIntoSentences(text) {
    const matches = text.match(SENTENCE_SPLIT_RE);
    if (!matches) return [];
    return matches.map((s) => s.trim()).filter(Boolean);
}

function splitTokenIdsIntoChunks(tokenIds, maxTokens) {
    const chunks = [];
    for (let i = 0; i < tokenIds.length; i += maxTokens) {
        const chunkText = tokenizer.decodeIds(tokenIds.slice(i, i + maxTokens)).trim();
        if (chunkText) chunks.push(chunkText);
    }
    return chunks;
}

function splitIntoBestSentences(text) {
    const prepared = prepareTextPrompt(text);
    if (!prepared.text) return { chunks: [], framesAfterEos: prepared.framesAfterEos };

    const sentences = splitTextIntoSentences(prepared.text);
    if (!sentences.length) return { chunks: [prepared.text], framesAfterEos: prepared.framesAfterEos };

    const chunks = [];
    let currentChunk = "";
    for (const sentenceText of sentences) {
        const sentenceTokenIds = tokenizer.encodeIds(sentenceText);
        if (sentenceTokenIds.length > maxTokenPerChunk) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = "";
            }
            for (const splitChunk of splitTokenIdsIntoChunks(sentenceTokenIds, maxTokenPerChunk)) {
                if (splitChunk) chunks.push(splitChunk.trim());
            }
            continue;
        }
        if (!currentChunk) {
            currentChunk = sentenceText;
            continue;
        }
        const combined = `${currentChunk} ${sentenceText}`;
        if (tokenizer.encodeIds(combined).length > maxTokenPerChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = sentenceText;
        } else {
            currentChunk = combined;
        }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    return { chunks, framesAfterEos: prepared.framesAfterEos };
}

function precomputeFlowBuffers() {
    stTensors = [];
    const dt = 1.0 / LSD_STEPS;
    for (let step = 0; step < LSD_STEPS; step++) {
        const s = step / LSD_STEPS;
        const t = s + dt;
        stTensors.push({
            s: createTensor("float32", new Float32Array([s]), [1, 1]),
            t: createTensor("float32", new Float32Array([t]), [1, 1]),
        });
    }
}

// ----- loading -----

async function openCache() {
    if (!config.cache) return null;
    try {
        if (typeof caches === "undefined") return null; // needs a secure context
        return await caches.open(config.cacheName || CACHE_NAME);
    } catch {
        return null;
    }
}

async function readBodyWithProgress(response, label, onProgress, fromCache) {
    const total = Number(response.headers.get("content-length")) || 0;
    if (!response.body || !total) {
        const buf = await response.arrayBuffer();
        if (onProgress) onProgress({ label, loaded: buf.byteLength, total: buf.byteLength, fromCache });
        return new Uint8Array(buf);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (onProgress) onProgress({ label, loaded, total, fromCache });
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
    }
    return out;
}

// Fetch a binary asset, persisting it in Cache Storage so subsequent page
// loads read from disk instead of re-downloading (~100s of MB).
async function fetchWithProgress(url, label, onProgress) {
    const cache = await openCache();
    if (cache) {
        try {
            const hit = await cache.match(url);
            if (hit) return readBodyWithProgress(hit, label, onProgress, true);
        } catch {
            /* fall through to network */
        }
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${label}: ${res.status}`);
    // Tee so we can both stream progress and store the original response.
    const forCache = cache ? res.clone() : null;
    const bytes = await readBodyWithProgress(res, label, onProgress, false);
    if (cache && forCache) {
        try {
            await cache.put(url, forCache);
        } catch {
            /* quota exceeded or storage unavailable — proceed without caching */
        }
    }
    return bytes;
}

async function loadOrt() {
    if (ort) return;
    post({ type: "status", status: "loading-runtime" });
    const base = config.ortBaseUrl;
    const ortModule = await import(/* @vite-ignore */ `${base}ort.min.mjs`);
    ort = ortModule.default || ortModule;
    ort.env.wasm.wasmPaths = base;
    ort.env.wasm.simd = true;
    ort.env.wasm.numThreads = self.crossOriginIsolated
        ? Math.min(navigator.hardwareConcurrency || 4, config.maxThreads || 8)
        : 1;
    precomputeFlowBuffers();
}

async function createSession(language, name, onProgress) {
    const bytes = await fetchWithProgress(modelUrl(language, stem(name)), name, onProgress);
    return ort.InferenceSession.create(bytes, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
    });
}

async function init(cfg) {
    config = cfg;
    const language = config.language;
    await loadOrt();

    post({ type: "status", status: "loading-bundle" });
    const metaBytes = await fetchWithProgress(modelUrl(language, "bundle.json"), "bundle");
    bundleMetadata = JSON.parse(new TextDecoder().decode(metaBytes));

    sampleRate = Number(bundleMetadata.sample_rate);
    samplesPerFrame = Number(bundleMetadata.samples_per_frame);
    latentDim = Number(bundleMetadata.latent_dim);
    conditioningDim = Number(bundleMetadata.conditioning_dim);
    maxTokenPerChunk = Number(bundleMetadata.max_token_per_chunk || 50);

    // Tokenizer (tiny pure-JS, no WASM).
    const tokBytes = await fetchWithProgress(
        modelUrl(language, bundleMetadata.tokenizer_file),
        "tokenizer",
        (p) => post({ type: "progress", ...p })
    );
    tokenizer = SentencePieceTokenizer.fromBytes(tokBytes);

    // Decide which models to download. The encoder is only needed for cloning.
    const needed = ["text_conditioner", "flow_lm_main", "flow_lm_flow", "mimi_decoder"];
    if (config.voiceCloning) needed.unshift("mimi_encoder");

    const onProgress = (p) => post({ type: "progress", ...p });
    const sessions = {};
    // Sequential downloads keep peak memory low and give clean progress events.
    for (const name of needed) {
        sessions[name] = await createSession(language, name, onProgress);
    }
    mimiEncoderSession = sessions.mimi_encoder || null;
    textConditionerSession = sessions.text_conditioner;
    flowLmMainSession = sessions.flow_lm_main;
    flowLmFlowSession = sessions.flow_lm_flow;
    mimiDecoderSession = sessions.mimi_decoder;

    bosBeforeVoice = null;
    if (config.voiceCloning && bundleMetadata.bos_before_voice_file) {
        try {
            const bosBytes = await fetchWithProgress(
                modelUrl(language, bundleMetadata.bos_before_voice_file),
                "bos"
            );
            bosBeforeVoice = parseNpyFloat32(bosBytes.buffer);
        } catch {
            /* optional asset */
        }
    }

    voiceStateCache = new Map();
    customEmbeddings = new Map();
    predefinedVoiceRecords = null;

    post({
        type: "ready",
        bundle: {
            language,
            sampleRate,
            samplesPerFrame,
            predefinedVoices: bundleMetadata.predefined_voices || [],
        },
    });
}

async function ensureVoicesBin() {
    if (predefinedVoiceRecords) return;
    const url = config.voicesUrl || modelUrl(config.language, "voices.bin");
    let bytes;
    try {
        bytes = await fetchWithProgress(url, "voices", (p) => post({ type: "progress", ...p }));
    } catch (err) {
        throw new Error(
            `Built-in voices unavailable (${err.message}). Provide a voicesUrl or use voice cloning.`
        );
    }
    predefinedVoiceRecords = parseVoiceStatesBin(bytes.buffer);
}

async function loadBuiltinVoice(name) {
    await ensureVoicesBin();
    if (!predefinedVoiceRecords[name]) throw new Error(`Unknown built-in voice: ${name}`);
    const ref = `builtin:${name}`;
    if (!voiceStateCache.has(ref)) {
        voiceStateCache.set(ref, stateFromVoiceRecord(predefinedVoiceRecords[name]));
    }
    return ref;
}

async function cloneVoice(audioData, ref) {
    const emb = await encodeVoiceAudio(audioData);
    customEmbeddings.set(ref, emb);
    voiceStateCache.set(ref, await buildVoiceConditionedState(emb));
    return ref;
}

// ----- generation -----

function cloneState(state) {
    return { ...state };
}

async function generate(text, voiceRef) {
    if (!voiceStateCache.has(voiceRef)) {
        throw new Error(`Voice '${voiceRef}' is not prepared.`);
    }
    isGenerating = true;
    const { chunks, framesAfterEos } = splitIntoBestSentences(text);
    if (!chunks.length) throw new Error("No text to generate.");

    const baseFlowState = voiceStateCache.get(voiceRef);
    let mimiState = initStateFromManifest(bundleMetadata.mimi_state_manifest);
    const emptySeq = createTensor("float32", new Float32Array(0), [1, 0, latentDim]);
    const emptyTextEmb = createTensor("float32", new Float32Array(0), [1, 0, conditioningDim]);
    let flowLmState = cloneState(baseFlowState);

    const firstChunkFrames = 3;
    const normalChunkFrames = 12;
    let isFirstAudioChunk = true;
    let totalFlowLmTime = 0;
    let totalDecodeTime = 0;
    let totalFrames = 0;

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        if (!isGenerating) break;
        // Each text chunk runs from the clean voice-conditioned state.
        flowLmState = cloneState(baseFlowState);
        mimiState = initStateFromManifest(bundleMetadata.mimi_state_manifest);

        const chunkText = chunks[chunkIdx];
        let isFirstAudioChunkOfTextChunk = true;
        const tokenIds = tokenizer.encodeIds(chunkText);
        const textInput = createTensor(
            "int64",
            BigInt64Array.from(tokenIds.map((t) => BigInt(t))),
            [1, tokenIds.length]
        );

        let textEmb = (await textConditionerSession.run({ token_ids: textInput }))[
            textConditionerSession.outputNames[0]
        ];
        if (textEmb.dims.length === 2) {
            textEmb = createTensor("float32", new Float32Array(textEmb.data), [1, textEmb.dims[0], textEmb.dims[1]]);
        }

        const condResult = await flowLmMainSession.run({
            sequence: emptySeq,
            text_embeddings: textEmb,
            ...flowLmState,
        });
        updateStateFromManifestOutputs(flowLmState, condResult, bundleMetadata.flow_lm_state_manifest);

        const chunkLatents = [];
        let chunkDecodedFrames = 0;
        let currentLatent = createTensor("float32", new Float32Array(latentDim).fill(NaN), [1, 1, latentDim]);
        let eosStep = null;
        let chunkEnded = false;
        let chunkGenTimeMs = 0;

        for (let step = 0; step < MAX_FRAMES; step++) {
            if (!isGenerating) break;
            if (step > 0 && step % 4 === 0) await new Promise((r) => setTimeout(r, 0));

            const stepStart = performance.now();
            const arResult = await flowLmMainSession.run({
                sequence: currentLatent,
                text_embeddings: emptyTextEmb,
                ...flowLmState,
            });
            const stepElapsed = performance.now() - stepStart;
            chunkGenTimeMs += stepElapsed;
            totalFlowLmTime += stepElapsed;

            const conditioning = arResult.conditioning;
            const eosLogit = arResult.eos_logit.data[0];
            if (eosLogit > EOS_THRESHOLD && eosStep == null) eosStep = step;
            const shouldStop = eosStep != null && step >= eosStep + framesAfterEos;

            const std = Math.sqrt(TEMPERATURE);
            const latentData = new Float32Array(latentDim);
            for (let i = 0; i < latentDim; i++) {
                let u = 0;
                let v = 0;
                while (u === 0) u = Math.random();
                while (v === 0) v = Math.random();
                latentData[i] = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * std;
            }

            const dt = 1.0 / LSD_STEPS;
            for (let lsdIndex = 0; lsdIndex < LSD_STEPS; lsdIndex++) {
                const flowResult = await flowLmFlowSession.run({
                    c: conditioning,
                    s: stTensors[lsdIndex].s,
                    t: stTensors[lsdIndex].t,
                    x: createTensor("float32", latentData, [1, latentDim]),
                });
                const flowDir = flowResult.flow_dir.data;
                for (let i = 0; i < latentDim; i++) latentData[i] += flowDir[i] * dt;
            }

            chunkLatents.push(new Float32Array(latentData));
            totalFrames++;
            currentLatent = createTensor("float32", latentData, [1, 1, latentDim]);
            updateStateFromManifestOutputs(flowLmState, arResult, bundleMetadata.flow_lm_state_manifest);

            const pending = chunkLatents.length - chunkDecodedFrames;
            let decodeSize = 0;
            if (shouldStop) decodeSize = pending;
            else if (isFirstAudioChunk && pending >= firstChunkFrames) decodeSize = firstChunkFrames;
            else if (pending >= normalChunkFrames) decodeSize = normalChunkFrames;

            if (decodeSize > 0) {
                const decodeLatents = new Float32Array(decodeSize * latentDim);
                for (let frame = 0; frame < decodeSize; frame++) {
                    decodeLatents.set(chunkLatents[chunkDecodedFrames + frame], frame * latentDim);
                }
                const decoderStart = performance.now();
                const decodeResult = await mimiDecoderSession.run({
                    latent: createTensor("float32", decodeLatents, [1, decodeSize, latentDim]),
                    ...mimiState,
                });
                const decoderElapsed = performance.now() - decoderStart;
                chunkGenTimeMs += decoderElapsed;
                totalDecodeTime += decoderElapsed;

                for (const entry of bundleMetadata.mimi_state_manifest) {
                    mimiState[entry.input_name] = decodeResult[entry.output_name];
                }
                chunkDecodedFrames += decodeSize;

                const audioFloat32 = new Float32Array(decodeResult[mimiDecoderSession.outputNames[0]].data);
                const isLastChunk = shouldStop && chunkIdx === chunks.length - 1;
                post(
                    {
                        type: "chunk",
                        audio: audioFloat32,
                        meta: {
                            chunkDuration: audioFloat32.length / sampleRate,
                            genTimeSec: chunkGenTimeMs / 1000,
                            isFirst: isFirstAudioChunk,
                            isLast: isLastChunk,
                            chunkStart: isFirstAudioChunkOfTextChunk,
                            isSilence: false,
                        },
                    },
                    [audioFloat32.buffer]
                );
                isFirstAudioChunk = false;
                isFirstAudioChunkOfTextChunk = false;
                chunkGenTimeMs = 0;
            }

            if (shouldStop) {
                chunkEnded = true;
                break;
            }
        }

        if (!chunkEnded && isGenerating) throw new Error('Pocket reached its generation limit. Shorten the text and try again.');
        if (chunkEnded && isGenerating && chunkIdx < chunks.length - 1) {
            const gapSamples = Math.max(1, Math.floor(CHUNK_GAP_SEC * sampleRate));
            const silence = new Float32Array(gapSamples);
            post(
                {
                    type: "chunk",
                    audio: silence,
                    meta: {
                        chunkDuration: gapSamples / sampleRate,
                        isFirst: false,
                        isLast: false,
                        isSilence: true,
                    },
                },
                [silence.buffer]
            );
        }
    }

    const audioSeconds = (totalFrames * samplesPerFrame) / sampleRate;
    const genTime = (totalFlowLmTime + totalDecodeTime) / 1000;
    const rtfx = genTime > 0 ? audioSeconds / genTime : 0;
    isGenerating = false;
    return { rtfx, genTime, audioDuration: audioSeconds, stopped: false };
}

// ----- message dispatch -----

self.onmessage = async (e) => {
    const { id, type, payload } = e.data;
    try {
        if (type === "init") {
            await init(payload);
            post({ id, type: "result", result: { ok: true } });
        } else if (type === "cloneVoice") {
            const ref = await cloneVoice(payload.audio, payload.ref);
            post({ id, type: "result", result: { ref } });
        } else if (type === "loadBuiltinVoice") {
            const ref = await loadBuiltinVoice(payload.name);
            post({ id, type: "result", result: { ref } });
        } else if (type === "generate") {
            const metrics = await generate(payload.text, payload.voiceRef);
            post({ id, type: "result", result: { metrics } });
        } else if (type === "stop") {
            isGenerating = false;
            post({ id, type: "result", result: { ok: true } });
        }
    } catch (err) {
        isGenerating = false;
        post({ id, type: "error", error: err && err.message ? err.message : String(err) });
    }
};
