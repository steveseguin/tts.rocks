const modelId = 'onnx-community/Qwen3-0.6B-ONNX';
const revision = '1e0a4a196ecabdf9a879664110574563d3f372d3';
const progress = message => self.postMessage({ type: 'progress', message });

self.onmessage = async ({ data: { text, action } }) => {
    try {
        if (typeof text !== 'string' || !text.trim() || text.length > 3000 || !['improve', 'summarize'].includes(action)) throw new Error('Choose an action and 1–3,000 characters of text.');
        const adapter = await navigator.gpu?.requestAdapter();
        if (!adapter) throw new Error('Local AI needs WebGPU. Try an updated desktop Chrome or Edge with graphics acceleration enabled.');
        const dtype = adapter.features.has('shader-f16') ? 'q4f16' : 'q4';
        progress('Loading Local AI…');
        const { env, AutoTokenizer, Qwen3ForCausalLM, TextStreamer } = await import('./thirdparty/neural/text-runtime.js');
        env.allowLocalModels = false;
        env.backends.onnx.wasm.numThreads = 1;
        env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
        const tokenizer = await AutoTokenizer.from_pretrained(modelId, { revision });
        const task = action === 'improve'
            ? 'Correct spelling and grammar in the following text. Keep its meaning, names, numbers and details. Return only the corrected text, without commentary.'
            : 'Summarize the following text in one short paragraph for spoken narration. Use only facts from the text. Return only the summary.';
        const inputs = tokenizer.apply_chat_template([{ role: 'user', content: task + '\n\n' + text }], { tokenize: true, return_dict: true, add_generation_prompt: true, enable_thinking: false });
        if (inputs.input_ids.dims[1] > 1500) throw new Error('This text is too long for Local AI. Select a shorter passage.');
        let lastProgress = 0;
        const model = await Qwen3ForCausalLM.from_pretrained(modelId, {
            revision, device: 'webgpu', dtype,
            progress_callback: p => {
                if (p.status === 'progress' && Date.now() - lastProgress > 500) {
                    lastProgress = Date.now();
                    progress(`Downloading Local AI… ${Math.round(p.progress || 0)}%`);
                } else if (p.status === 'done') progress('Preparing Local AI…');
            }
        });
        progress('Writing draft…');
        let tokens = 0;
        const streamer = new TextStreamer(tokenizer, { skip_prompt: true, skip_special_tokens: true,
            callback_function: () => {}, token_callback_function: ids => {
                tokens += ids.length;
                if (tokens % 20 < ids.length) progress(`Writing draft… ${tokens} tokens`);
            }
        });
        const output = await model.generate({ ...inputs, max_new_tokens: action === 'improve' ? 1100 : 350, do_sample: false, streamer });
        const ids = output.tolist()[0].slice(inputs.input_ids.dims[1]);
        const eos = model.generation_config.eos_token_id ?? model.config.eos_token_id;
        const endTokens = Array.isArray(eos) ? eos : [eos];
        if (!endTokens.some(id => BigInt(id) === ids.at(-1))) throw new Error('The draft reached its length limit. Select a shorter passage and try again.');
        const draft = tokenizer.decode(ids, { skip_special_tokens: true }).trim();
        if (!draft) throw new Error('No draft was returned. Try a shorter passage.');
        self.postMessage({ type: 'result', result: { text: draft, action, model: 'Qwen3-0.6B', license: 'Apache-2.0', device: 'webgpu', dtype } });
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message || 'Local AI could not load. Check available memory and your connection, then try again.' });
    }
};
