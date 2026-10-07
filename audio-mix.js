import { pcmToWav } from './audio-utils.js';

// Render the complete podcast locally at a common sample rate.
export async function mixPodcast(speech, music, { volume = 0.1, intro = 1, outro = 2, signal } = {}) {
    const check = () => { if (signal?.aborted) throw new DOMException('Stopped', 'AbortError'); };
    check();
    const rate = 24000;
    const context = new OfflineAudioContext(1, 1, rate);
    const voice = await context.decodeAudioData(await speech.arrayBuffer());
    check();
    const bed = await context.decodeAudioData(await music.arrayBuffer());
    check();
    if (!bed.length) throw new Error('The music recording is empty.');
    const lead = Math.round(intro * rate);
    const output = new Float32Array(lead + voice.length + Math.round(outro * rate));
    const musicData = new Float32Array(bed.length);
    for (let c = 0; c < bed.numberOfChannels; c++) {
        const channel = bed.getChannelData(c);
        for (let i = 0; i < bed.length; i++) musicData[i] += channel[i] / bed.numberOfChannels;
    }
    const overlap = Math.min(Math.round(0.03 * rate), Math.floor(bed.length / 4));
    const period = bed.length - overlap;
    let gain = volume;
    for (let i = 0; i < output.length; i++) {
        if (i && i % 240000 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); check(); }
        const position = i % period;
        let value = musicData[position];
        if (i >= period && position < overlap) {
            const blend = position / overlap;
            value = musicData[period + position] * (1 - blend) + value * blend;
        }
        const target = i >= lead && i < lead + voice.length ? volume * 0.35 : volume;
        gain += (target - gain) / (rate * 0.03);
        const fade = Math.min(1, i / (rate * 0.2), (output.length - 1 - i) / (rate * 0.3));
        output[i] = value * gain * fade;
    }
    for (let c = 0; c < voice.numberOfChannels; c++) {
        const channel = voice.getChannelData(c);
        for (let i = 0; i < voice.length; i++) output[lead + i] += channel[i] / voice.numberOfChannels;
    }
    let peak = 0;
    for (const value of output) peak = Math.max(peak, Math.abs(value));
    if (peak > 0.98) for (let i = 0; i < output.length; i++) output[i] *= 0.98 / peak;
    check();
    return pcmToWav(output, rate);
}
