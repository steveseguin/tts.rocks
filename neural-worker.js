import { KokoroTTS, env, ort, phonemize, phonemizeKokoro, AutoTokenizer, MusicgenForConditionalGeneration } from './thirdparty/neural/runtime.js';
import { splitText, joinAudio, pcmToWav } from './audio-utils.js';
import { cachedFetch } from './model-assets.js';

const runtimeURL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
const threads = self.crossOriginIsolated ? Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2))) : 1;
ort.env.wasm.numThreads = threads;
ort.env.wasm.wasmPaths = runtimeURL;
env.backends.onnx.wasm.numThreads = threads;
env.backends.onnx.wasm.wasmPaths = runtimeURL;
env.allowLocalModels = false;
env.remotePathTemplate = '{model}/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/';

let instance;
let instanceKey;
let device;
let dtype;
let busy = false;
let kittenModels;
const styles = new Map();
const supertonicBase = 'https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46';

function downloadProgress(name, info, progress) {
    if (info.cached) { progress({ message: `Loading cached ${name}...` }); return; }
    const size = (info.loaded / 1048576).toFixed(1);
    const total = info.total ? ` / ${(info.total / 1048576).toFixed(1)} MB` : ' MB';
    progress({ message: `${info.done ? 'Preparing' : 'Downloading'} ${name}: ${size}${total}`,
        percent: info.total ? Math.min(100, info.loaded / info.total * 100) : undefined });
}

async function initialize(options, progress) {
    const key = [options.engine, options.device, options.quality, options.model].join(':');
    if (instance && instanceKey === key) return;
    if (instance) {
        if (instance.model && instance.model.dispose) await instance.model.dispose();
        if (instance.session) await instance.session.release();
        for (const name of ['dpOrt', 'textEncOrt', 'vectorEstOrt', 'vocoderOrt']) {
            if (instance[name]) await instance[name].release();
        }
    }
    instance = null;
    for (const style of styles.values()) {
        if (style.ttl) style.ttl.dispose();
        if (style.dp) style.dp.dispose();
    }
    styles.clear();
    device = 'wasm';
    if (['kokoro', 'supertonic'].includes(options.engine) && (options.device === 'webgpu' || (options.device !== 'wasm' && options.engine === 'kokoro'))) {
        try {
            const preference = ['low-power', 'high-performance'].includes(options.powerPreference) ? options.powerPreference : undefined;
            ort.env.webgpu.powerPreference = preference;
            env.backends.onnx.webgpu.powerPreference = preference;
            const adapter = navigator.gpu && await navigator.gpu.requestAdapter(preference ? { powerPreference: preference } : {});
            if (adapter) {
                if (options.engine === 'kokoro' && options.quality === 'fp16' && !adapter.features.has('shader-f16')) throw new Error('This GPU does not support FP16. Choose Full quality or Compact.');
                device = 'webgpu';
            }
            else if (options.device === 'webgpu') throw new Error('WebGPU is unavailable. Select CPU or Automatic.');
        } catch (error) {
            if (options.device === 'webgpu' || (options.engine === 'kokoro' && options.quality === 'fp16')) throw error;
        }
    }
    if (options.engine === 'kokoro') {
        env.remotePathTemplate = '{model}/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/';
        dtype = options.quality === 'auto' ? (device === 'webgpu' ? 'fp32' : 'q8') : options.quality;
        const load = () => KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
            device, dtype, progress_callback: item => progress({ message: item.file ? `Loading ${item.file}` : 'Preparing Kokoro…', percent: item.progress })
        });
        try { instance = await load(); }
        catch (error) {
            if (device !== 'webgpu' || options.device === 'webgpu') throw error;
            device = 'wasm'; dtype = 'q8';
            progress({ message: 'GPU initialization failed; loading the compact CPU model…' });
            instance = await load();
        }
    } else if (options.engine === 'musicgen') {
        device = 'wasm';
        dtype = 'q8 / FP32 audio decoder';
        env.remotePathTemplate = '{model}/resolve/6a8096dabfff72909ef5eae41461408e29ae20fd/';
        const modelId = 'Xenova/musicgen-small';
        const progress_callback = item => progress({ message: item.file ? `Loading MusicGen ${item.file}` : 'Preparing MusicGen…', percent: item.progress });
        const tokenizer = await AutoTokenizer.from_pretrained(modelId, { progress_callback });
        const model = await MusicgenForConditionalGeneration.from_pretrained(modelId, { device: 'wasm',
            dtype: { text_encoder: 'q8', decoder_model_merged: 'q8', encodec_decode: 'fp32' }, progress_callback });
        instance = { tokenizer, model };
    } else if (options.engine === 'kitten-v08') {
        device = 'wasm';
        if (!kittenModels) kittenModels = await (await fetch(new URL('./thirdparty/neural/kitten-models.json', import.meta.url))).json();
        const model = kittenModels[options.model] || kittenModels.nano;
        progress({ message: `Loading Kitten ${options.model || 'nano'} 0.8…` });
        const bytes = await (await cachedFetch(model.base + model.config.model_file,
            info => downloadProgress(`Kitten ${options.model || 'nano'}`, info, progress))).arrayBuffer();
        instance = { session: await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }), config: model, assetBase: options.assetBase };
        dtype = options.model === 'nano' ? 'int8' : 'fp32';
    } else if (options.engine === 'supertonic') {
        const helper = await import('./thirdparty/neural/supertonic.js');
        const loaded = await helper.loadTextToSpeech(supertonicBase + '/onnx', {
            executionProviders: [device], graphOptimizationLevel: 'all'
        }, (name, index, count, info) => info ? downloadProgress(name, info, progress) : progress({ message: `Loading Supertonic ${index}/${count}: ${name}...` }));
        instance = loaded.textToSpeech;
        dtype = 'fp32';
    } else throw new Error('Unknown local engine');
    instanceKey = key;
}

async function kitten(text, voice, speed) {
    const { config, session } = instance;
    const voiceId = config.config.voice_aliases[voice];
    const table = config.voices[voiceId];
    if (!table) throw new Error('Choose a Kitten voice');
    if (!styles.has(voiceId)) {
        const response = await fetch(new URL(table.file, instance.assetBase));
        if (!response.ok) throw new Error('Could not load the Kitten voice');
        styles.set(voiceId, new Float32Array(await response.arrayBuffer()));
    }
    const symbols = '$' + ';:,.!?¡¿—…"«»"" ' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' + "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";
    const dictionary = new Map(Array.from(symbols, (symbol, index) => [symbol, index]));
    const phonemes = (await phonemize(text, 'en-us')).join(' ');
    // Match the upstream Unicode word/punctuation tokenizer, including stress marks.
    const normalized = (phonemes.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) || []).join(' ');
    const ids = [0, ...Array.from(normalized).filter(char => dictionary.has(char)).map(char => dictionary.get(char)), 10, 0];
    const width = table.shape[table.shape.length - 1];
    const row = Math.min(Array.from(text).length, table.shape[0] - 1);
    const feeds = {
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        style: new ort.Tensor('float32', styles.get(voiceId).slice(row * width, (row + 1) * width), [1, width]),
        speed: new ort.Tensor('float32', [speed * (config.config.speed_priors[voiceId] || 1)], [1])
    };
    let output;
    try {
        output = await session.run(feeds);
        const tensor = output[session.outputNames[0]];
        // The model appends a padding tail; follow the upstream 0.8 decoder.
        const audio = tensor.data.slice(0, Math.max(1, tensor.data.length - 5000));
        return { audio, sampling_rate: 24000 };
    } finally {
        Object.values(feeds).forEach(value => value.dispose());
        if (output) Object.values(output).forEach(value => value.dispose());
    }
}

self.onmessage = async ({ data: { id, type, options } }) => {
    if (busy) { self.postMessage({ id, error: 'A speech request is already running' }); return; }
    busy = true;
    const progress = data => self.postMessage({ id, type: 'progress', ...data }, data.chunk ? [data.chunk.buffer] : []);
    try {
        if (type === 'voices') {
            self.postMessage({ id, result: new KokoroTTS(null, null).voices });
            return;
        }
        await initialize(options, progress);
        if (type === 'prepare') {
            self.postMessage({ id, result: { device, dtype } });
            return;
        }
        if (options.engine === 'musicgen') {
            const seconds = Math.max(3, Math.min(15, Number(options.musicSeconds) || 5));
            progress({ message: `Creating ${seconds} seconds of instrumental music on CPU. This can take several minutes; Stop cancels it.` });
            const started = performance.now();
            const inputs = instance.tokenizer(options.text);
            let output;
            try {
                output = await instance.model.generate({ ...inputs, max_new_tokens: Math.round(seconds * 50), do_sample: true, guidance_scale: 3 });
                const samples = Float32Array.from(output.data);
                const sampleRate = instance.model.config.audio_encoder.sampling_rate;
                self.postMessage({ id, result: { blob: pcmToWav(samples, sampleRate), duration: samples.length / sampleRate,
                    seconds: (performance.now() - started) / 1000, device, dtype, cues: [] } });
            } finally {
                if (output?.dispose) output.dispose();
                for (const tensor of Object.values(inputs)) if (tensor.dispose) tensor.dispose();
            }
            return;
        }
        const chunks = [];
        const pauses = [];
        const cues = [];
        let sampleOffset = 0;
        let sampleRate = 24000;
        const chunkSize = Math.max(60, Math.min(240, Number(options.chunkSize) || 240));
        const maxLength = options.engine === 'supertonic' && /^(ko|ja)/.test(options.language) ? Math.min(120, chunkSize) : chunkSize;
        const turns = options.turns || [{ text: options.text, voice: options.voice }];
        const sentences = turns.flatMap((turn, turnIndex) => splitText(turn.text, maxLength).map(text => ({ text, voice: turn.voice, speaker: turn.speaker, turnIndex })));
        const started = performance.now();
        for (let index = 0; index < sentences.length; index++) {
            progress({ message: `Generating part ${index + 1} of ${sentences.length}…`, percent: index / sentences.length * 100 });
            let audio;
            const sentence = sentences[index];
            if (options.engine === 'kokoro') {
                const voice = sentence.voice || 'af_aoede';
                const phonemes = await phonemizeKokoro(sentence.text, voice[0]);
                const { input_ids } = instance.tokenizer(phonemes, { truncation: false });
                if (input_ids.dims.at(-1) > 510) {
                    const length = Array.from(sentence.text).length;
                    if (length < 2) throw new Error('This text cannot fit in the speech model');
                    sentences.splice(index, 1, ...splitText(sentence.text, Math.max(1, Math.floor(length / 2))).map(text => ({ ...sentence, text })));
                    index--;
                    continue;
                }
                audio = await instance.generate_from_ids(input_ids, { voice, speed: options.speed });
            } else if (options.engine === 'kitten-v08') {
                audio = await kitten(sentence.text, sentence.voice, options.speed);
            } else {
                const helper = await import('./thirdparty/neural/supertonic.js');
                if (!styles.has(sentence.voice)) styles.set(sentence.voice, await helper.loadVoiceStyle([supertonicBase + '/voice_styles/' + sentence.voice + '.json']));
                const result = await instance._infer([sentence.text], [options.language.split('-')[0]], styles.get(sentence.voice), options.steps || 5, options.speed);
                sampleRate = instance.sampleRate;
                audio = { audio: Float32Array.from(result.wav).slice(0, Math.round(result.duration[0] * sampleRate)), sampling_rate: sampleRate };
            }
            sampleRate = audio.sampling_rate;
            chunks.push(audio.audio);
            const next = sentences[index + 1];
            const pause = next ? (next.turnIndex !== sentence.turnIndex ? options.turnPauseMs || 0 : options.pauseMs || 0) : 0;
            pauses.push(pause);
            if (sentence.speaker) {
                if (!cues[sentence.turnIndex]) cues[sentence.turnIndex] = { speaker: sentence.speaker, text: turns[sentence.turnIndex].text, start: sampleOffset / sampleRate };
                cues[sentence.turnIndex].end = (sampleOffset + audio.audio.length) / sampleRate;
            }
            sampleOffset += audio.audio.length + Math.round(sampleRate * pause / 1000);
            if (options.stream) {
                const chunk = joinAudio([audio.audio], sampleRate);
                progress({ chunk, sampleRate, gap: pause / 1000 });
            }
        }
        const pcm = joinAudio(chunks, sampleRate, pauses);
        self.postMessage({ id, result: { blob: pcmToWav(pcm, sampleRate), duration: pcm.length / sampleRate,
            seconds: (performance.now() - started) / 1000, device, dtype, chunks: chunks.length, cues } });
    } catch (error) {
        self.postMessage({ id, error: error.message || String(error) });
    } finally { busy = false; }
};
