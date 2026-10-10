import { ChatterboxModel, AutoTokenizer, Tensor, env } from './thirdparty/neural/chatterbox-runtime.js';
import { splitText, chunksToWav, joinAudio } from './audio-utils.js';

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2))) : 1;
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
const repository = 'onnx-community/chatterbox-ONNX';
const revision = '3cab09af388d3f02bba43443fce88c1f4525ac43';
let model, tokenizer, device, dtype, speaker, referenceKey;
let busy = false;

self.onmessage = async ({ data: { id, type, options } }) => {
    if (busy) { self.postMessage({ id, error: 'A speech request is already running' }); return; }
    busy = true;
    const progress = data => self.postMessage({ id, type: 'progress', ...data }, data.chunk ? [data.chunk.buffer] : []);
    try {
        if (!model) {
            let adapter;
            if (options.device !== 'wasm') {
                const preference = ['low-power', 'high-performance'].includes(options.powerPreference) ? options.powerPreference : undefined;
                adapter = await navigator.gpu?.requestAdapter(preference ? { powerPreference: preference } : {});
                env.backends.onnx.webgpu.powerPreference = preference;
                if (!adapter && options.device === 'webgpu') throw new Error('WebGPU is unavailable. Choose CPU or another browser.');
            }
            device = adapter ? 'webgpu' : 'wasm';
            dtype = adapter?.features.has('shader-f16') ? 'q4f16' : 'q4';
            progress({ device, message: 'Loading Chatterbox (about 1.5 GB). First preparation can take several minutes; Stop cancels it.' });
            tokenizer = await AutoTokenizer.from_pretrained(repository, { revision });
            let lastProgress = 0;
            model = await ChatterboxModel.from_pretrained(repository, { revision, device,
                dtype: { embed_tokens: 'fp32', speech_encoder: 'fp32', language_model: dtype, conditional_decoder: 'fp32' },
                progress_callback: item => {
                    const now = performance.now();
                    if (item.status === 'progress' && now - lastProgress < 500) return;
                    lastProgress = now;
                    progress({ message: item.file ? `Loading Chatterbox ${item.file}` : 'Preparing Chatterbox sessions…', percent: item.progress });
                } });
        }
        progress({ device, dtype, message: `Chatterbox ready on ${device === 'webgpu' ? 'GPU' : 'CPU'}.` });
        if (type === 'prepare') { self.postMessage({ id, result: { device, dtype } }); return; }
        if (type !== 'generate') throw new Error('Unsupported Chatterbox operation');
        const reference = options.reference;
        if (!(reference instanceof Float32Array) || reference.length < 72000 || reference.length > 240000) throw new Error('Choose a reference between 3 and 10 seconds at 24 kHz.');
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', reference))).join(',');
        if (hash !== referenceKey) {
            if (speaker) Object.values(speaker).forEach(tensor => tensor.dispose());
            speaker = null; referenceKey = null;
            progress({ message: 'Encoding the reference voice locally…' });
            const tensor = new Tensor('float32', reference, [1, reference.length]);
            try { speaker = await model.encode_speech(tensor); referenceKey = hash; }
            finally { tensor.dispose(); }
        }
        const sentences = splitText(options.text, Math.min(180, Number(options.chunkSize) || 180));
        const chunks = [], pauses = [], cues = [];
        const sampleRate = 24000;
        const started = performance.now();
        let sampleOffset = 0, generatedSamples = 0;
        for (let index = 0; index < sentences.length; index++) {
            progress({ message: `Generating part ${index + 1} of ${sentences.length}…`, percent: index / sentences.length * 100 });
            const inputs = tokenizer(sentences[index]);
            let output, ended = false, tokens = 0;
            try {
                output = await model.generate({ ...inputs, ...speaker, exaggeration: options.exaggeration ?? 0.5, max_new_tokens: 512,
                    streamer: {
                        put(ids) {
                            if (++tokens === 1) return; // The first callback contains the input prompt.
                            if (ids[0].some(token => token === 6562n || token === 2n)) ended = true;
                            if (tokens % 50 === 0) progress({ message: `Generating part ${index + 1} of ${sentences.length} (${tokens - 1} speech tokens)…` });
                        }, end() {}
                    } });
                if (!ended) throw new Error('Chatterbox reached its speech limit. Use a shorter chunk size and generate again.');
                const audio = Float32Array.from(output.data);
                if (!audio.length || audio.some(value => !Number.isFinite(value))) throw new Error('Chatterbox returned invalid audio. Try CPU or a shorter passage.');
                chunks.push(audio);
                const pause = index < sentences.length - 1 ? options.pauseMs || 0 : 0;
                pauses.push(pause);
                cues.push({ text: sentences[index], start: sampleOffset / sampleRate, end: (sampleOffset + audio.length) / sampleRate });
                sampleOffset += audio.length + Math.round(sampleRate * pause / 1000);
                generatedSamples += audio.length;
                const metrics = { device, dtype, duration: generatedSamples / sampleRate, seconds: (performance.now() - started) / 1000 };
                if (options.stream) progress({ chunk: joinAudio([audio], sampleRate), sampleRate, gap: pause / 1000, ...metrics });
                else progress(metrics);
            } finally {
                output?.dispose();
                Object.values(inputs).forEach(tensor => tensor.dispose());
            }
        }
        self.postMessage({ id, result: { blob: chunksToWav(chunks, sampleRate, pauses), duration: sampleOffset / sampleRate,
            generatedDuration: generatedSamples / sampleRate, sampleRate, device, dtype, cues, chunks: chunks.length, seconds: (performance.now() - started) / 1000 } });
    } catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
    finally { busy = false; }
};
