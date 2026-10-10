export async function cachedFetch(url, onProgress) {
    let cache;
    try {
        cache = await caches.open('tts-rocks-models-v1');
        const response = await cache.match(url);
        if (response) {
            if (onProgress) onProgress({ cached: true, done: true });
            return response;
        }
    } catch (_) { /* Synthesis also works when persistent storage is unavailable. */ }
    let response = await fetch(url);
    if (!response.ok) throw new Error(`Model download failed (${response.status}): ${new URL(url).pathname.split('/').pop()}`);
    if (onProgress && response.body) {
        let loaded = 0;
        const total = Number(response.headers.get('Content-Length')) || 0;
        let lastUpdate = 0;
        response = new Response(response.body.pipeThrough(new TransformStream({
            transform(chunk, controller) {
                loaded += chunk.byteLength;
                const now = performance.now();
                if (now - lastUpdate > 500) {
                    lastUpdate = now;
                    onProgress({ loaded, total, done: false });
                }
                controller.enqueue(chunk);
            },
            flush() { onProgress({ loaded, total, done: true }); }
        })), { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    if (cache) {
        // Consume both tee branches concurrently so the caller can read while caching.
        // This optional write finishes while the caller reads and initializes the model.
        void cache.put(url, response.clone()).catch(() => { /* Storage may be full. */ });
    }
    return response;
}

export async function clearModelCache(engine) {
    const repositories = {
        kokoro: ['onnx-community/Kokoro-82M-v1.0-ONNX'],
        chatterbox: ['onnx-community/chatterbox-ONNX'],
        'kitten-v08': ['KittenML/kitten-tts-nano-0.8-int8', 'KittenML/kitten-tts-micro-0.8', 'KittenML/kitten-tts-mini-0.8'],
        supertonic: ['supertone-oss-archive/supertonic-3'],
        pocket: ['vlapky/pocket-tts-onnx'],
        musicgen: ['Xenova/musicgen-small']
    };
    const prefixes = repositories[engine]?.map(repo => `https://huggingface.co/${repo}/`);
    if (!prefixes) throw new Error('Select a supported local neural engine first.');
    if (typeof caches === 'undefined') throw new Error('Model cache storage is unavailable in this browser.');
    const buckets = ['musicgen', 'chatterbox'].includes(engine) ? ['transformers-cache'] : engine === 'kokoro' ? ['transformers-cache', 'kokoro-voices', 'tts-rocks-models-v1']
        : engine === 'pocket' ? ['pocket-tts-js-v1'] : ['tts-rocks-models-v1'];
    const available = await caches.keys();
    let removed = 0;
    for (const name of buckets) {
        if (!available.includes(name)) continue;
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
            if (prefixes.some(prefix => request.url.startsWith(prefix)) && await cache.delete(request)) removed++;
        }
    }
    return removed;
}
