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
