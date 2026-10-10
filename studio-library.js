const el = id => document.getElementById(id);
const MAX_AUDIO = 128 * 1024 * 1024;
const extras = engine => engine === 'openai' ? ['openaiModel', 'speechInstructions'] : engine === 'elevenlabs' ? ['elevenlabsModel'] : [];
const samples = {
    kokoro: [['af_aoede', 'Aoede', 'kokoro-af_aoede'], ['af_heart', 'Heart', 'kokoro-af_heart'], ['am_michael', 'Michael', 'kokoro-am_michael']],
    'kitten-v08': [['Bella', 'Bella', 'kitten-bella'], ['Jasper', 'Jasper', 'kitten-jasper'], ['Luna', 'Luna', 'kitten-luna']]
};
const safeName = name => name.trim().replace(/\.(wav|mp3|zip|vtt|txt)$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80).replace(/^(con|prn|aux|nul|com\d|lpt\d)$/i, '$1_') || 'narration';
let database;
function db() {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('This browser cannot save projects locally. Download your recording instead.'));
    if (!database) database = new Promise((resolve, reject) => {
        const request = indexedDB.open('tts-rocks-library', 1);
        request.onupgradeneeded = () => {
            for (const name of ['projects', 'voices']) request.result.createObjectStore(name, { keyPath: 'id' });
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Close other TTS.Rocks tabs, then try saving again.'));
        request.onsuccess = () => {
            request.result.onversionchange = () => { request.result.close(); database = null; };
            resolve(request.result);
        };
    }).catch(error => { database = null; throw error; });
    return database;
}
async function stored(store, method, value) {
    const connection = await db();
    return new Promise((resolve, reject) => {
        const tx = connection.transaction(store, ['get', 'getAll'].includes(method) ? 'readonly' : 'readwrite');
        const request = tx.objectStore(store)[method](value);
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = () => reject(tx.error || request.error || new Error('Browser storage is unavailable. Download your files instead.'));
        tx.onerror = () => {};
    });
}
function captions(cues) {
    const time = seconds => {
        const ms = Math.round(seconds * 1000);
        return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
    };
    const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/\s+/g, ' ');
    return 'WEBVTT\n\n' + cues.map((cue, index) => `${index + 1}\n${time(cue.start)} --> ${time(cue.end)}\n${cue.speaker ? `<v Speaker ${cue.speaker}>` : ''}${escape(cue.text)}\n`).join('\n');
}

export class StudioLibrary {
    constructor(app) {
        this.app = app;
        this.initializing = true;
        this.preview = new Audio();
        for (const [id, task] of [
            ['taskVoiceover', () => this.task('voiceover')], ['taskDocument', () => this.task('document')],
            ['taskClone', () => this.task('clone')], ['taskSummarize', () => this.task('summarize')],
            ['openProjects', () => this.openDialog()], ['saveProject', () => this.save(false)],
            ['saveProjectCopy', () => this.save(true)], ['loadProject', () => this.load()],
            ['deleteProject', () => this.removeProject()], ['downloadBundle', () => this.bundle()],
            ['saveReference', () => this.saveVoice()], ['loadReference', () => this.loadVoice()],
            ['deleteReference', () => this.deleteVoice()]
        ]) el(id).addEventListener('click', () => { void this.run(task); });
        el('closeProjects').addEventListener('click', () => { if (!this.busy) el('projectDialog').close(); });
        el('projectDialog').addEventListener('cancel', event => { if (this.busy) event.preventDefault(); });
        el('projectList').addEventListener('change', () => this.refresh());
        el('savedReference').addEventListener('change', () => this.refresh());
        el('exportName').addEventListener('input', () => this.refresh());
        app.textInput.addEventListener('input', () => this.refresh());
        app.voiceSelect.addEventListener('change', () => this.stopPreview());
        app.engineSelect.addEventListener('change', () => this.stopPreview());
        new MutationObserver(() => this.refreshSamples()).observe(app.voiceSelect, { childList: true });
        el('stopVoiceSample').addEventListener('click', () => this.stopPreview());
        this.preview.onended = () => this.stopPreview();
        this.preview.onerror = () => { if (this.preview.getAttribute('src')) { this.stopPreview(); app.showStatus('This voice sample could not load. Try again when connected.', 'error'); } };
        el('savedVoices').addEventListener('toggle', () => { if (el('savedVoices').open) void this.run(() => this.listVoices()); });
        void app.ready.then(() => { this.initializing = false; this.refreshSamples(); this.refresh(); });
        this.refresh();
    }
    working() {
        const app = this.app;
        return Boolean(this.initializing || this.busy || app.isGenerating || app.clearingDownloads || app.documents.importing || app.documents.running || app.localText.busy);
    }
    async run(task) {
        if (this.working()) return;
        this.busy = true;
        this.app.updateGenerateButtonState();
        try { await task(); }
        catch (error) {
            const message = error.name === 'QuotaExceededError' ? 'Browser storage is full. Download your recording, or save the project without audio.' : error.message;
            el('projectStatus').textContent = message;
            this.app.showStatus(message, 'error');
        } finally { this.busy = false; this.app.updateGenerateButtonState(); }
    }
    filename(extension, fallback) {
        return el('exportName').value.trim() ? `${safeName(el('exportName').value)}.${extension}` : fallback;
    }
    refresh() {
        const busy = this.working();
        for (const id of ['taskVoiceover', 'taskDocument', 'taskClone', 'taskSummarize', 'openProjects', 'saveProject', 'saveProjectCopy', 'saveReference']) el(id).disabled = busy;
        for (const id of ['loadProject', 'deleteProject']) el(id).disabled = busy || !el('projectList').value;
        for (const id of ['loadReference', 'deleteReference']) el(id).disabled = busy || !el('savedReference').value;
        el('downloadBundle').disabled = busy || !this.recording;
        el('closeProjects').disabled = this.busy;
        el('saveProjectCopy').hidden = !this.projectId;
        const stale = this.recording && this.recording.script.trim() !== this.app.textInput.value.trim();
        el('exportStatus').textContent = !this.recording ? 'Generate audio to download a bundle with the recording, script and captions.' : stale ? 'The last recording uses earlier text. Generate again to include your edits.' : 'Bundle includes the last completed recording, its script, timing details and any captions.';
        for (const button of el('voiceSamples').querySelectorAll('button')) button.disabled = busy;
    }
    record(recording) {
        this.recording = { ...recording, cues: structuredClone(recording.cues || []), createdAt: new Date().toISOString() };
        this.refresh();
    }
    clearRecording() { this.recording = null; this.refresh(); }
    async task(kind) {
        const app = this.app;
        this.stopPreview();
        if (kind === 'summarize') {
            if (!app.textInput.value.trim()) {
                app.textInput.focus();
                app.showStatus('Paste text or select a passage of up to 3,000 characters, then choose Summarize.', 'info');
                return;
            }
            el('localTextAction').value = 'summarize';
            app.localText.open();
            return;
        }
        if (kind === 'voiceover') {
            if (app.documents.active) el('leaveDocument').click();
            el('scriptMode').value = 'narration';
            el('scriptMode').dispatchEvent(new Event('change', { bubbles: true }));
            if (['musicgen', 'browser'].includes(app.currentEngine)) {
                app.engineSelect.value = 'kokoro'; await app.onEngineChange();
            }
            app.textInput.focus();
        }
        if (kind === 'document') {
            // Keep the file picker in the click handler's user gesture.
            let ready;
            if (!['kokoro', 'kitten-v08', 'supertonic', 'chatterbox'].includes(app.currentEngine)) {
                app.engineSelect.value = 'kitten-v08'; ready = app.onEngineChange();
            }
            el('uploadDocument').click();
            await ready;
        }
        if (kind === 'clone') {
            if (!['chatterbox', 'pocket'].includes(app.currentEngine) || app.documents.active && app.currentEngine === 'pocket') {
                app.engineSelect.value = 'chatterbox';
                await app.onEngineChange();
            }
            app.switchTab(el('engine-tab-button'));
            el('referenceAudio').focus();
        }
    }
    stopPreview() {
        this.previewVersion = (this.previewVersion || 0) + 1;
        this.preview.pause(); this.preview.removeAttribute('src'); this.preview.load();
        el('stopVoiceSample').hidden = true;
        el('voiceSampleStatus').textContent = '';
    }
    refreshSamples() {
        this.stopPreview();
        const app = this.app, choices = samples[app.currentEngine] || [];
        el('voiceSamplesSection').hidden = !choices.length;
        el('voiceSamples').replaceChildren();
        for (const [voice, label, file] of choices) {
            const button = document.createElement('button');
            button.className = 'secondary'; button.textContent = `Hear ${label}`;
            button.addEventListener('click', () => {
                if (this.working()) return;
                this.stopPreview();
                app.voiceSelect.value = voice; app.voiceSelect.dispatchEvent(new Event('change', { bubbles: true }));
                this.preview.src = new URL(`./voice-samples/${file}.wav`, import.meta.url).href;
                const version = this.previewVersion;
                el('stopVoiceSample').hidden = false;
                el('voiceSampleStatus').textContent = `${label} selected. Playing a prerecorded sample.`;
                void this.preview.play().catch(() => {
                    if (version !== this.previewVersion) return;
                    this.stopPreview(); app.showStatus('Audio preview is unavailable in this browser.', 'info');
                });
            });
            el('voiceSamples').append(button);
        }
        this.refresh();
    }
    async listProjects() {
        const projects = await stored('projects', 'getAll');
        el('projectList').replaceChildren(new Option('Choose a saved project', ''));
        for (const project of projects.sort((a, b) => b.updated - a.updated)) el('projectList').add(new Option(`${project.name} · ${new Date(project.updated).toLocaleDateString()}`, project.id));
        if (this.projectId) el('projectList').value = this.projectId;
        this.refresh();
    }
    async openDialog() {
        el('projectStatus').textContent = '';
        el('projectName').value = el('exportName').value || (this.app.documents.active ? this.app.documents.name : '') || '';
        el('projectDialog').showModal();
        await this.listProjects();
    }
    async save(copy) {
        const name = el('projectName').value.trim();
        if (!name) throw new Error('Enter a project name.');
        const app = this.app;
        app.saveSettings();
        const recording = el('projectIncludeAudio').checked ? this.recording : null;
        if (recording?.audio.size > MAX_AUDIO) throw new Error('For recordings over 128 MB, uncheck Include audio and download the recording separately.');
        const settings = structuredClone(app.settings);
        const controls = Object.fromEntries(extras(app.currentEngine).filter(id => el(id)).map(id => [id, el(id).value]));
        const id = !copy && this.projectId || crypto.randomUUID();
        await stored('projects', 'put', { id, name, updated: Date.now(), settings, controls, recording });
        this.projectId = id; el('exportName').value = name;
        await this.listProjects();
        el('projectStatus').textContent = 'Saved on this device. Reference recordings and music files are not included.';
    }
    async load() {
        const project = await stored('projects', 'get', el('projectList').value);
        if (!project) throw new Error('This project is no longer available.');
        const app = this.app;
        this.stopPreview(); app.stopGeneration(); app.waveformPlayer.stop();
        app.documents.reset(); app.documents.active = Boolean(project.settings.documentMode);
        app.documents.name = project.settings.documentName || project.name;
        app.documents.state = app.documents.active ? 'ready' : 'idle'; app.documents.message = '';
        app.audioBlob = null; app.audioCues = []; app.downloadBtn.disabled = true; app.audioSection.style.display = 'none';
        el('downloadCaptions').hidden = true;
        app.backgroundMusic = null; el('backgroundMusic').value = ''; el('musicBedName').textContent = 'No music selected';
        el('referenceAudio').value = ''; app.clearReferenceVoice();
        app.settings = structuredClone(project.settings); app.podcastVoices = app.settings.podcastVoices || {};
        await app.restoreState();
        app.settings.voices = structuredClone(project.settings.voices || {});
        for (const id of extras(app.currentEngine)) if (el(id) && project.controls?.[id] !== undefined) {
            el(id).value = project.controls[id];
            el(id).dispatchEvent(new Event('change', { bubbles: true }));
        }
        this.projectId = project.id; el('exportName').value = project.name;
        this.recording = project.recording;
        if (this.recording) {
            const record = this.recording;
            if (app.documents.active && record.audio.type.includes('wav')) {
                app.documents.episode = record.audio; app.documents.cues = record.cues;
                app.documents.script = record.script;
                app.documents.duration = record.cues.at(-1)?.end || 0;
                app.documents.url = URL.createObjectURL(record.audio); el('documentPlayer').src = app.documents.url;
                app.documents.state = 'complete'; app.documents.message = 'Saved recording ready. Generate Episode makes a new recording from your current text.';
            } else if (!app.documents.active) {
                app.audioBlob = record.audio; app.audioCues = record.cues; app.downloadBtn.disabled = false;
                el('downloadCaptions').hidden = !record.cues.length;
                if (app.audioPlaybackSupported) {
                    try { await app.waveformPlayer.loadAudio(record.audio); app.audioSection.style.display = 'block'; }
                    catch (_) { app.audioSection.style.display = 'none'; }
                }
            }
        }
        app.documents.refresh(); app.updateStudioControls(); app.saveSettings();
        el('projectDialog').close();
        app.showStatus('Project opened. Select a saved reference voice or music file again if needed.', 'success');
        this.refresh();
    }
    async removeProject() {
        const id = el('projectList').value;
        await stored('projects', 'delete', id);
        if (this.projectId === id) this.projectId = null;
        await this.listProjects(); el('projectStatus').textContent = 'Saved project deleted. The open script and recording are still available.';
    }
    async bundle() {
        const record = this.recording;
        if (!record) throw new Error('Generate a recording first.');
        if (record.audio.size > MAX_AUDIO) throw new Error('For recordings over 128 MB, download the audio and captions separately.');
        const { zipSync, strToU8 } = await import('./thirdparty/documents/fflate.js');
        const name = safeName(el('exportName').value);
        const format = record.audio.type.includes('mpeg') ? 'mp3' : 'wav';
        const files = { [`${name}.${format}`]: new Uint8Array(await record.audio.arrayBuffer()), [`${name}.txt`]: strToU8(record.script),
            [`${name}.json`]: strToU8(JSON.stringify({ engine: record.engine, createdAt: record.createdAt, format, bytes: record.audio.size, cues: record.cues }, null, 2)) };
        if (record.cues.length) files[`${name}.vtt`] = strToU8(captions(record.cues));
        this.app.downloadFile(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), name + '.zip');
    }
    async listVoices() {
        const voices = await stored('voices', 'getAll');
        el('savedReference').replaceChildren(new Option('Choose a saved reference', ''));
        for (const voice of voices.sort((a, b) => a.name.localeCompare(b.name))) el('savedReference').add(new Option(voice.name, voice.id));
        this.refresh();
    }
    async saveVoice() {
        const file = el('referenceAudio').files[0], name = el('referenceName').value.trim();
        if (!file) throw new Error('Choose a reference recording first.');
        if (!name) throw new Error('Give this reference voice a name.');
        if (file.size > 20 * 1024 * 1024) throw new Error('Choose a reference recording smaller than 20 MB.');
        const id = crypto.randomUUID();
        await stored('voices', 'put', { id, name, file });
        await this.listVoices(); el('savedReference').value = id;
        this.app.showStatus('Reference voice saved on this device.', 'success');
    }
    async loadVoice() {
        const voice = await stored('voices', 'get', el('savedReference').value);
        if (!voice) throw new Error('This saved voice is no longer available.');
        const transfer = new DataTransfer();
        transfer.items.add(new File([voice.file], voice.file.name || 'reference.wav', { type: voice.file.type }));
        el('referenceAudio').files = transfer.files;
        el('referenceAudio').dispatchEvent(new Event('change', { bubbles: true }));
        el('referenceName').value = voice.name;
        this.app.showStatus(`Reference selected: ${voice.name}`, 'success');
    }
    async deleteVoice() {
        await stored('voices', 'delete', el('savedReference').value);
        await this.listVoices();
        this.app.showStatus('Saved reference deleted. Clear reference also removes it from this recording.', 'success');
    }
}
