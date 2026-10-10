import { checkedText, readDocument } from './document-import.js';
import { parseDialogue } from './dialogue.js';
import { chatterboxReference } from './reference-audio.js';

const el = id => document.getElementById(id);
const safeName = name => name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'document';
const MAX_AUDIO = 512 * 1024 * 1024;

// Keep every word, with each request small enough for the existing speech workers.
export function sections(text, mode) {
    const turns = mode === 'dialogue' ? parseDialogue(text, 10000) : text.split(/\n\s*\n/).filter(part => part.trim()).map((part, index) => ({ text: part, speaker: mode === 'alternating' ? (index % 2 ? 'B' : 'A') : undefined }));
    const result = [];
    for (const turn of turns) {
        let rest = turn.text.trim();
        while (rest) {
            let end = Math.min(3000, rest.length);
            if (rest.length > end) {
                const prefix = rest.slice(0, end);
                const sentences = [...prefix.matchAll(/[.!?]["'”’]?\s+/g)];
                const sentence = sentences.at(-1);
                const whitespace = prefix.search(/\s+\S*$/);
                end = sentence && sentence.index > 1500 ? sentence.index + sentence[0].length : whitespace > 0 ? whitespace : end;
                if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
            }
            result.push({ text: rest.slice(0, end).trim(), speaker: turn.speaker });
            rest = rest.slice(end).trim();
        }
    }
    // Merge short adjacent paragraphs for single-voice recordings only.
    if (mode !== 'narration') return result;
    const grouped = [];
    for (const part of result) {
        const last = grouped.at(-1);
        if (last && last.text.length + part.text.length + 2 <= 3000) last.text += '\n\n' + part.text;
        else grouped.push({ ...part });
    }
    return grouped;
}

async function waveInfo(blob) {
    const bytes = await blob.slice(0, 44).arrayBuffer();
    const view = new DataView(bytes);
    const tag = offset => String.fromCharCode(...new Uint8Array(bytes, offset, 4));
    if (bytes.byteLength !== 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint16(34, true) !== 16 || tag(36) !== 'data' || view.getUint32(40, true) !== blob.size - 44) throw new Error('The engine returned an unsupported audio format. Download the completed sections separately.');
    const rate = view.getUint32(24, true);
    if (!rate || (blob.size - 44) % 2) throw new Error('The engine returned invalid audio.');
    return { header: bytes, rate, duration: (blob.size - 44) / (rate * 2) };
}

export class DocumentStudio {
    constructor(app) {
        this.app = app;
        this.active = Boolean(app.settings.documentMode);
        this.name = app.settings.documentName || 'document';
        this.parts = [];
        this.state = 'idle';
        this.message = '';
        this.api = Object.freeze({
            import: file => this.import(file),
            useText: (text, name = 'document') => this.useText(text, name),
            status: () => this.status(),
            generate: () => this.generate(),
            cancel: () => { this.cancel(); return this.status(); },
            download: (format = 'wav', section) => this.download(format, section)
        });
        el('documentFile').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; if (file) this.import(file).catch(error => this.error(error)); });
        el('uploadDocument').addEventListener('click', () => el('documentFile').click());
        el('useDocumentText').addEventListener('click', () => {
            if (this.busy()) return;
            try {
                if (app.textInput.value.trim()) this.useText(app.textInput.value, 'Long text');
                else {
                    this.reset(); this.active = true; this.name = 'Long text'; this.update('', 'ready');
                    app.updateCharCount(); app.updateStudioControls(); app.updateGenerateButtonState();
                }
                app.textInput.focus();
            } catch (error) { this.error(error); }
        });
        el('leaveDocument').addEventListener('click', () => {
            if (this.busy()) return;
            this.active = false;
            if (el('scriptMode').value === 'alternating') el('scriptMode').value = 'narration';
            this.refresh(); app.updateCharCount(); app.updateStudioControls(); app.updateGenerateButtonState();
        });
        el('cancelDocumentImport').addEventListener('click', () => this.cancel());
        for (const format of ['wav', 'vtt', 'txt']) el(`documentDownload_${format}`).addEventListener('click', () => { try { this.download(format); } catch (error) { this.error(error); } });
        this.refresh();
        app.textInput.addEventListener('input', () => {
            if (this.active && (this.parts.length || this.episode) && app.textInput.value.trim() !== this.script) this.update('Text changed. Generate Episode starts a new recording; downloads below contain the previous script.');
        });
    }

    busy() { return this.importing || this.running || this.app.isGenerating || this.app.clearingDownloads || this.app.localText?.busy; }
    error(error) { this.app.showStatus(error.message, 'error'); }
    status() { return { active: this.active, name: this.name, state: this.state, message: this.message, completed: this.parts.length, total: this.plan?.length || 0, duration: this.duration || 0 }; }
    refresh() {
        el('documentControls').hidden = !this.active;
        this.app.downloadBtn.hidden = this.active;
        el('documentName').textContent = this.name;
        el('alternateNarrators').disabled = !this.active;
        el('alternateNarrators').hidden = !this.active;
        el('documentFile').disabled = Boolean(this.busy());
        el('uploadDocument').disabled = Boolean(this.busy());
        el('useDocumentText').hidden = this.active;
        el('useDocumentText').disabled = Boolean(this.busy());
        el('leaveDocument').disabled = Boolean(this.busy());
        el('cancelDocumentImport').hidden = !this.importing;
        el('documentProgress').textContent = this.message;
        el('documentProgress').dataset.state = this.state;
        el('documentProgress').hidden = !this.message || !this.active && !['importing', 'error'].includes(this.state);
        el('documentResults').hidden = !this.parts.length && !this.episode;
        el('documentSections').parentElement.hidden = !this.parts.length;
        el('documentDownload_wav').disabled = !this.episode;
        el('documentDownload_vtt').disabled = !this.episode;
        window.dispatchEvent(new CustomEvent('ttsrocks:document', { detail: this.status() }));
    }
    update(message, state = this.state) { this.message = message; this.state = state; this.refresh(); }
    reset() {
        if (this.url) URL.revokeObjectURL(this.url);
        this.url = null; this.episode = null; this.parts = []; this.plan = null; this.duration = 0;
        this.signature = null; this.referenceFile = null; this.script = null; this.cues = [];
        el('documentPlayer').removeAttribute('src'); el('documentPlayer').load();
        el('documentSections').replaceChildren();
    }
    useText(text, name = 'document') {
        if (this.busy()) throw new Error('Stop the current operation before replacing the document.');
        if (typeof text !== 'string' || typeof name !== 'string') throw new Error('Pass document text and a filename as strings.');
        const checked = checkedText(text);
        this.reset(); this.active = true; this.name = name.slice(0, 200); this.app.textInput.value = checked;
        this.update('', 'ready');
        this.app.updateCharCount(); this.app.updateStudioControls(); this.app.updateGenerateButtonState();
        return this.status();
    }
    async import(file) {
        if (this.busy()) throw new Error('Stop the current operation before importing a document.');
        this.importing = true;
        this.importController = new AbortController();
        this.update('Reading document…', 'importing'); this.app.updateGenerateButtonState();
        try {
            const result = await readDocument(file, this.importController.signal, message => this.update(message));
            this.importing = false;
            this.useText(result.text, file.name);
            this.update(result.warning || '', 'ready');
            return this.status();
        } catch (error) {
            this.update(this.importController.signal.aborted ? 'Import cancelled. Existing text is unchanged.' : error.message, 'error');
            throw error;
        } finally { this.importing = false; this.refresh(); this.app.updateGenerateButtonState(); }
    }
    cancel() {
        if (this.importing) this.importController.abort();
        if (this.running) this.app.stopGeneration();
    }
    async generate() {
        const app = this.app;
        if (this.busy() || app.library?.busy) throw new Error('Another operation is still running. Wait for it to finish.');
        if (!this.active) throw new Error('Upload a file or choose Long text first.');
        const text = checkedText(app.textInput.value);
        const options = { ...app.neuralOptions('', false), includeCues: true };
        const mode = el('scriptMode').value;
        if (!['kokoro', 'kitten-v08', 'supertonic', 'chatterbox'].includes(options.engine)) throw new Error('Choose Kokoro, Kitten 0.8, Supertonic or Chatterbox for document narration.');
        if (mode !== 'narration' && options.engine === 'chatterbox') throw new Error('Choose Single voice for Chatterbox, or Kokoro, Kitten 0.8 or Supertonic for two narrators.');
        if (mode !== 'narration' && app.backgroundMusic) throw new Error('Clear the music bed for document generation. You can add music to the downloaded episode in your video or audio editor.');
        const secondVoice = el('secondVoice').value;
        const pauseMs = mode === 'narration' ? options.pauseMs : Number(el('turnPause').value);
        const referenceFile = options.engine === 'chatterbox' ? el('referenceAudio').files[0] : null;
        const signature = JSON.stringify({ text, options, mode, secondVoice, pauseMs });
        if (this.signature !== signature || this.referenceFile !== referenceFile) {
            const plan = sections(text, mode);
            this.reset(); this.plan = plan; this.signature = signature; this.referenceFile = referenceFile; this.script = text;
        }
        if (this.episode) { this.update('Episode already complete. Download it below.', 'complete'); return this.status(); }
        if (this.parts.reduce((sum, part) => sum + part.blob.size, 0) > MAX_AUDIO) throw new Error('This episode exceeds 512 MB. Download completed sections and divide the text into smaller documents.');
        this.running = true; app.isGenerating = true;
        app.library.clearRecording(); app.library.stopPreview();
        const id = ++app.generationId;
        const controller = app.requestController = new AbortController();
        app.audioBlob = null; app.downloadBtn.disabled = true; app.audioSection.style.display = 'none'; app.waveformPlayer?.stop();
        app.stopBtn.style.display = 'inline-block';
        const locked = [app.textInput, app.clearBtn, el('scriptMode'), el('summarizeBtn'), el('improveBtn'), el('translateBtn')].map(node => [node, node.disabled]);
        locked.forEach(([node]) => { node.disabled = true; });
        this.update(`Generating section ${this.parts.length + 1} of ${this.plan.length}…`, 'generating'); app.updateGenerateButtonState();
        try {
            if (options.engine === 'chatterbox') options.reference = await chatterboxReference(referenceFile, controller.signal);
            for (let index = this.parts.length; index < this.plan.length; index++) {
                controller.signal.throwIfAborted();
                const section = this.plan[index];
                const result = await app.neural.request('generate', { ...options, text: section.text, voice: section.speaker === 'B' ? secondVoice : options.voice }, progress => {
                    if (id === app.generationId) this.update(`Section ${index + 1} of ${this.plan.length}: ${progress.message || 'Generating…'}`);
                });
                controller.signal.throwIfAborted();
                const info = await waveInfo(result.blob);
                controller.signal.throwIfAborted();
                if (this.parts.length && this.parts[0].rate !== info.rate) throw new Error('The audio sample rate changed. Download completed sections, then start again with the same engine settings.');
                const part = { ...info, blob: result.blob, cues: (result.cues || []).map(cue => ({ ...cue, speaker: section.speaker })) };
                this.parts.push(part);
                this.duration += part.duration;
                const button = document.createElement('button'); button.className = 'secondary';
                button.textContent = `Download section ${index + 1} (${Math.round(part.duration)}s)`;
                button.addEventListener('click', () => this.download('wav', index)); el('documentSections').append(button);
                app.updateGenerationMetrics(result);
                this.update(`${this.parts.length} of ${this.plan.length} sections complete.`, 'generating');
                if (this.parts.reduce((sum, item) => sum + item.blob.size, 0) > MAX_AUDIO) throw new Error('This episode exceeds 512 MB. Download the completed sections and divide the text into smaller documents.');
            }
            await this.assemble(pauseMs);
            controller.signal.throwIfAborted();
            this.url = URL.createObjectURL(this.episode); el('documentPlayer').src = this.url;
            app.library.record({ audio: this.episode, script: text, cues: this.cues, engine: options.engine });
            this.update(`Ready · ${(this.duration / 60).toFixed(1)} min`, 'complete');
            return this.status();
        } catch (error) {
            if (controller.signal.aborted) this.update(`Paused · ${this.parts.length}/${this.plan.length} sections saved. Generate Episode to resume.`, 'paused');
            else this.update(`${error.message} Completed sections remain available.`, 'error');
            throw error;
        } finally {
            this.running = false;
            locked.forEach(([node, disabled]) => { node.disabled = disabled; });
            if (id === app.generationId) { app.isGenerating = false; app.stopBtn.style.display = 'none'; }
            this.refresh(); app.updateGenerateButtonState();
        }
    }
    async assemble(pauseMs) {
        const first = this.parts[0];
        const gap = new Uint8Array(Math.round(first.rate * pauseMs / 1000) * 2);
        const buffers = [], cues = [];
        let size = 0, offset = 0;
        for (let index = 0; index < this.parts.length; index++) {
            const part = this.parts[index];
            if (index) { buffers.push(gap); size += gap.length; offset += gap.length / (first.rate * 2); }
            buffers.push(part.blob.slice(44)); size += part.blob.size - 44;
            cues.push(...part.cues.map(cue => ({ ...cue, start: cue.start + offset, end: cue.end + offset })));
            offset += part.duration;
        }
        if (size > MAX_AUDIO) throw new Error('The combined episode exceeds 512 MB. Download the sections separately.');
        const header = first.header.slice(0), view = new DataView(header);
        view.setUint32(4, 36 + size, true); view.setUint32(40, size, true);
        this.episode = new Blob([header, ...buffers], { type: 'audio/wav' }); this.cues = cues; this.duration = offset;
    }
    download(format, section) {
        let blob, suffix = '';
        if (section !== undefined) {
            if (format !== 'wav' || !Number.isInteger(section) || !this.parts[section]) throw new Error('Choose an available WAV section (zero-based index).');
            blob = this.parts[section].blob; suffix = `-section-${section + 1}`;
        } else if (format === 'txt') blob = new Blob([this.script || this.app.textInput.value], { type: 'text/plain;charset=utf-8' });
        else {
            if (!this.episode) throw new Error('Finish generating the episode before downloading the complete recording or captions.');
            if (format === 'wav') blob = this.episode;
            else if (format === 'vtt') {
                const stamp = seconds => new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
                const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/\s+/g, ' ');
                blob = new Blob(['WEBVTT\n\n' + this.cues.map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.speaker ? `<v Speaker ${cue.speaker}>` : ''}${escape(cue.text)}\n`).join('\n')], { type: 'text/vtt' });
            } else throw new Error('Choose wav, vtt or txt.');
        }
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url;
        const base = this.app.library.filename(format, `${safeName(this.name)}.${format}`).slice(0, -(format.length + 1));
        link.download = `${base}${suffix}.${format}`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return { filename: link.download, bytes: blob.size };
    }
}
