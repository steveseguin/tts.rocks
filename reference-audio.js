// Inspect a local recording's duration before allocating its decoded PCM buffer.
export async function referenceDuration(file, signal, { min = 3, max = 30, message = 'Use a clear reference between 3 and 30 seconds; the first 10 seconds will be used.' } = {}) {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    audio.preload = 'metadata';
    let abort;
    try {
        return await new Promise((resolve, reject) => {
            abort = () => reject(new DOMException('Stopped', 'AbortError'));
            audio.onloadedmetadata = () => {
                if (!Number.isFinite(audio.duration) || audio.duration < min || audio.duration > max) {
                    reject(new Error(message));
                } else resolve(audio.duration);
            };
            audio.onerror = () => reject(new Error('This recording could not be read. Try a WAV or MP3 file.'));
            if (signal?.aborted) { abort(); return; }
            signal?.addEventListener('abort', abort, { once: true });
            audio.src = url;
        });
    } finally {
        signal?.removeEventListener('abort', abort);
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
    }
}

export async function chatterboxReference(file, signal) {
    if (typeof OfflineAudioContext !== 'function') throw new Error('Chatterbox needs a browser that can decode reference audio. Try Chrome or Edge.');
    if (!file) {
        const response = await fetch('https://huggingface.co/onnx-community/chatterbox-ONNX/resolve/3cab09af388d3f02bba43443fce88c1f4525ac43/default_voice.wav', { signal });
        if (!response.ok) throw new Error('Could not download the Chatterbox default voice. Try again or choose a reference recording.');
        file = await response.blob();
    }
    if (!(file instanceof Blob) || file.size > 20 * 1024 * 1024) throw new Error('Use a reference audio file smaller than 20 MB.');
    await referenceDuration(file, signal);
    signal?.throwIfAborted();
    const decoded = await new OfflineAudioContext(1, 1, 24000).decodeAudioData(await file.arrayBuffer());
    signal?.throwIfAborted();
    if (decoded.duration < 3 || decoded.duration > 30) throw new Error('Use a reference between 3 and 30 seconds; the first 10 seconds will be used.');
    const mono = new Float32Array(Math.min(decoded.length, 240000));
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const values = decoded.getChannelData(channel);
        for (let i = 0; i < mono.length; i++) mono[i] += values[i] / decoded.numberOfChannels;
    }
    if (mono.some(value => !Number.isFinite(value))) throw new Error('The reference contains invalid audio.');
    let energy = 0;
    for (const value of mono) energy += value * value;
    if (energy / mono.length < 1e-8) throw new Error('The reference is silent. Choose a clear voice recording.');
    return mono;
}
