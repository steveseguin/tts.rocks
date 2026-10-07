// Minimal gapless streaming player for mono Float32 PCM chunks.
//
// Schedules AudioBufferSourceNodes back-to-back on an AudioContext so chunks
// produced by the worker play smoothly as they arrive. No AudioWorklet file is
// needed, which keeps the package small and avoids cross-origin-isolation
// requirements for playback itself.
//
// To avoid an under-run after the first (intentionally tiny, low-latency)
// chunk, playback is primed: incoming chunks are buffered until ~`primeSeconds`
// of audio is queued, then released back-to-back. Because synthesis runs faster
// than real time once warmed up, that initial cushion keeps the schedule ahead
// of the producer for the rest of the stream.

export class StreamingPlayer {
    /**
     * @param {object} [opts]
     * @param {number} [opts.sampleRate=24000]
     * @param {AudioContext} [opts.audioContext]  Reuse an existing context if provided.
     * @param {number} [opts.primeSeconds=0.4]  Audio to buffer before playback starts (jitter cushion). 0 = play immediately.
     * @param {number} [opts.leadSeconds=0.05]  Small scheduling lead applied when playback starts.
     * @param {(info:{gapSeconds:number,count:number}) => void} [opts.onUnderrun]  Called when a chunk arrives late.
     */
    constructor(opts = {}) {
        this.sampleRate = opts.sampleRate || 24000;
        this.audioContext = opts.audioContext || null;
        this._ownsContext = !opts.audioContext;
        this._primeSeconds = opts.primeSeconds != null ? opts.primeSeconds : 0.4;
        this._leadSeconds = opts.leadSeconds != null ? opts.leadSeconds : 0.05;
        this._onUnderrun = opts.onUnderrun || null;

        this._nextStartTime = 0;
        this._sources = new Set();
        this._gain = null;
        this.analyser = null;

        this._pending = [];
        this._pendingDuration = 0;
        this._primed = false;
        this.underruns = 0;
    }

    _ensureContext() {
        if (!this.audioContext) {
            const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
            this.audioContext = new Ctx({ sampleRate: this.sampleRate });
        }
        if (!this._gain) {
            this._gain = this.audioContext.createGain();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this._gain.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
        }
    }

    /** Resume the underlying context (call from a user gesture if suspended). */
    async resume() {
        this._ensureContext();
        if (this.audioContext.state === "suspended") await this.audioContext.resume();
    }

    /** Reset for a new generation. */
    reset() {
        this.stop();
        this._nextStartTime = 0;
        this._pending = [];
        this._pendingDuration = 0;
        this._primed = false;
        this.underruns = 0;
    }

    /**
     * Enqueue one mono Float32 chunk.
     * @param {Float32Array} float32
     * @param {{isLast?:boolean}} [meta]  When meta.isLast is set, any buffered audio is flushed immediately.
     */
    play(float32, meta) {
        this._ensureContext();
        if (!float32 || float32.length === 0) return;

        if (!this._primed) {
            this._pending.push(float32);
            this._pendingDuration += float32.length / this.sampleRate;
            if (this._pendingDuration >= this._primeSeconds || (meta && meta.isLast)) {
                this._flushPending();
            }
            return;
        }
        this._schedule(float32);
    }

    /** Release any buffered audio immediately (e.g. when generation ends). */
    flush() {
        if (!this._primed) this._flushPending();
    }

    _flushPending() {
        this._primed = true;
        this._ensureContext();
        // Start the schedule a touch in the future so the first buffer isn't
        // already "late" relative to the audio clock.
        this._nextStartTime = this.audioContext.currentTime + this._leadSeconds;
        const pending = this._pending;
        this._pending = [];
        this._pendingDuration = 0;
        for (const chunk of pending) this._schedule(chunk);
    }

    _schedule(float32) {
        const ctx = this.audioContext;
        const buffer = ctx.createBuffer(1, float32.length, this.sampleRate);
        buffer.copyToChannel(float32, 0);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this._gain);

        const now = ctx.currentTime;
        if (this._nextStartTime < now) {
            // The producer fell behind the playback clock: a gap is unavoidable.
            this.underruns++;
            if (this._onUnderrun) this._onUnderrun({ gapSeconds: now - this._nextStartTime, count: this.underruns });
        }
        const startAt = Math.max(now, this._nextStartTime);
        source.start(startAt);
        this._nextStartTime = startAt + buffer.duration;

        this._sources.add(source);
        source.onended = () => this._sources.delete(source);
    }

    /** Stop all scheduled sources immediately and drop any buffered audio. */
    stop() {
        for (const source of this._sources) {
            try {
                source.stop();
            } catch {
                /* already stopped */
            }
        }
        this._sources.clear();
        this._pending = [];
        this._pendingDuration = 0;
        this._primed = false;
        if (this.audioContext) this._nextStartTime = this.audioContext.currentTime;
    }

    /** Release the AudioContext if this player created it. */
    async destroy() {
        this.stop();
        if (this._ownsContext && this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }
    }
}

/** Concatenate Float32 chunks into a 16-bit PCM WAV Blob. */
export function chunksToWavBlob(chunks, sampleRate) {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const pcm = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
        pcm.set(c, offset);
        offset += c.length;
    }

    const dataSize = pcm.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeString = (o, s) => {
        for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    let o = 44;
    for (let i = 0; i < pcm.length; i++, o += 2) {
        const s = Math.max(-1, Math.min(1, pcm[i]));
        view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
}
