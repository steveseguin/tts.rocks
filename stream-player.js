// Schedule PCM chunks without joining speech across sentence boundaries.
export class StreamPlayer {
    constructor(volume = 1) {
        this.context = new (window.AudioContext || window.webkitAudioContext)();
        this.gain = this.context.createGain();
        this.gain.connect(this.context.destination);
        this.setVolume(volume);
        this.paused = false;
        this.stopped = false;
        void this.context.resume().catch(() => { /* Stopping can close a pending resume. */ });
        this.nextTime = 0;
        this.sources = new Set();
        this.finished = null;
    }

    enqueue(samples, sampleRate, gap = 0) {
        if (!samples.length || this.stopped) return;
        const buffer = this.context.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(samples, 0);
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gain);
        // Leave time for the output device to wake before the first word.
        const start = Math.max(this.context.currentTime + (this.sources.size ? 0.025 : 0.15), this.nextTime);
        this.nextTime = start + buffer.duration + gap;
        this.sources.add(source);
        source.onended = () => {
            source.disconnect();
            this.sources.delete(source);
            if (!this.sources.size && this.finished) this.finished();
        };
        source.start(start);
    }

    drain() {
        return this.sources.size ? new Promise(resolve => { this.finished = resolve; }) : Promise.resolve();
    }

    setVolume(volume) {
        this.gain.gain.value = Math.max(0, Math.min(1, volume));
    }

    async setPaused(paused) {
        if (this.stopped) return;
        this.paused = paused;
        if (paused) await this.context.suspend();
        else await this.context.resume();
    }

    stop() {
        if (this.stopped) return;
        this.stopped = true;
        for (const source of this.sources) {
            source.onended = null;
            source.stop();
            source.disconnect();
        }
        this.sources.clear();
        if (this.finished) this.finished();
        this.finished = null;
        this.gain.disconnect();
        if (this.context.state !== 'closed') void this.context.close().catch(() => { /* Already closing. */ });
    }
}
