// Enhanced TTS application with multiple engines and Chrome AI integration
import { StreamPlayer } from './stream-player.js';
import { NeuralClient } from './neural-client.js';
import { chunksToWav } from './audio-utils.js';
import { clearModelCache } from './model-assets.js';
import { referenceDuration } from './reference-audio.js';
import { parseDialogue, dialogueVtt } from './dialogue.js';
import { mixPodcast } from './audio-mix.js';

class TTSApp {
    constructor() {
        this.neural = new NeuralClient();
        this.generationId = 0;
        this.voiceLists = {};
        this.accountVoices = {};
        this.sessionKeys = {};
        this.audioPlaybackSupported = typeof (window.AudioContext || window.webkitAudioContext) === 'function';
        this.pocket = null;
        this.currentEngine = 'kokoro'; // Start with kokoro by default
        this.audioBlob = null;
        this.isGenerating = false;
        this.computeMode = null; // Track compute mode for display
        this.settings = this.loadSettings();
        this.podcastVoices = this.settings.podcastVoices && typeof this.settings.podcastVoices === 'object' && !Array.isArray(this.settings.podcastVoices) ? this.settings.podcastVoices : {};
        this.audioCues = [];
        this.backgroundMusic = null;
        this.lastMusicBlob = null;
        this.chromeAI = {
            summarizer: null,
            translator: null,
            detector: null,
            writer: null
        };
        this.waveformPlayer = null;
        
        this.initializeElements();
        document.getElementById('streamSpeech').disabled = !this.audioPlaybackSupported;
        this.attachEventListeners();
        this.initializeWaveformPlayer();

        this.initializeBrowserTTS();
        this.restoreState();
        this.initializeChromeAI();
        this.updateGenerateButtonState();
        this.updateStudioControls();
        new MutationObserver(() => this.syncPodcastVoices()).observe(this.voiceSelect, { childList: true, subtree: true });
    }

    initializeElements() {
        // Text elements
        this.textInput = document.getElementById('textInput');
        this.defaultPlaceholder = this.textInput.placeholder;
        this.charCount = document.getElementById('charCount');
        this.charLimit = document.getElementById('charLimit');
        
        // Engine & Voice elements
        this.engineSelect = document.getElementById('engineSelect');
        this.voiceSelect = document.getElementById('voiceSelect');
        this.languageSelect = document.getElementById('languageSelect');
        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.apiKeySection = document.getElementById('apiKeySection');
        
        // Control elements
        this.speedSlider = document.getElementById('speedSlider');
        this.speedValue = document.getElementById('speedValue');
        this.pitchSlider = document.getElementById('pitchSlider');
        this.pitchValue = document.getElementById('pitchValue');
        this.stabilitySlider = document.getElementById('stabilitySlider');
        this.stabilityValue = document.getElementById('stabilityValue');
        this.similaritySlider = document.getElementById('similaritySlider');
        this.similarityValue = document.getElementById('similarityValue');
        
        // Buttons
        this.generateBtn = document.getElementById('generateBtn');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.summarizeBtn = document.getElementById('summarizeBtn');
        this.detectLangBtn = document.getElementById('detectLangBtn');
        this.improveBtn = document.getElementById('improveBtn');
        
        // Audio & UI elements
        this.audioPlayer = document.getElementById('audioPlayer');
        this.audioSection = document.getElementById('audioSection');
        this.waveformContainer = document.getElementById('waveformPlayerContainer');
        this.statusMessage = document.getElementById('statusMessage');
        this.progressOverlay = document.getElementById('progressOverlay');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');
        
        // Tab elements
        this.tabs = document.querySelectorAll('.tab');
        this.tabContents = document.querySelectorAll('.tab-content');
    }

    attachEventListeners() {
        document.getElementById('scriptMode').addEventListener('change', () => { this.updateStudioControls(); this.saveSettings(); });
        document.getElementById('turnPause').addEventListener('change', () => this.saveSettings());
        document.getElementById('musicSeconds').addEventListener('change', () => this.saveSettings());
        document.getElementById('chunkSize').addEventListener('change', () => this.saveSettings());
        for (const id of ['musicVolume', 'musicIntro', 'musicOutro']) document.getElementById(id).addEventListener('change', () => this.saveSettings());
        document.getElementById('backgroundMusic').addEventListener('change', event => {
            const file = event.target.files[0];
            if (file?.size > 20 * 1024 * 1024) { event.target.value = ''; this.showStatus('Choose a music file smaller than 20 MB.', 'error'); return; }
            this.backgroundMusic = file || null;
            document.getElementById('musicBedName').textContent = file?.name || 'No music selected';
            this.updateStreamingControls();
        });
        document.getElementById('useGeneratedMusic').addEventListener('click', () => {
            this.backgroundMusic = this.lastMusicBlob;
            document.getElementById('backgroundMusic').value = '';
            document.getElementById('musicBedName').textContent = 'Generated MusicGen clip (non-commercial)';
            this.updateStreamingControls();
        });
        document.getElementById('clearMusicBed').addEventListener('click', () => {
            this.backgroundMusic = null;
            document.getElementById('backgroundMusic').value = '';
            document.getElementById('musicBedName').textContent = 'No music selected';
            this.updateStreamingControls();
        });
        document.getElementById('secondVoice').addEventListener('change', () => {
            this.podcastVoices[`${this.currentEngine}:${this.languageSelect.value}`] = document.getElementById('secondVoice').value;
            this.saveSettings();
        });
        document.getElementById('compactPreset').addEventListener('click', () => this.applyStudioPreset('compact'));
        document.getElementById('narrationPreset').addEventListener('click', () => this.applyStudioPreset('narration'));
        document.getElementById('checkDevice').addEventListener('click', () => this.checkDevice());
        document.getElementById('gpuPreference').addEventListener('change', () => { this.stopGeneration(); this.neural.cancel(); this.computeMode = null; this.updateComputeModeDisplay(); this.saveSettings(); });
        document.getElementById('prepareModel').addEventListener('click', () => this.prepareModel());
        document.getElementById('downloadCaptions').addEventListener('click', () => this.downloadFile(new Blob([dialogueVtt(this.audioCues)], { type: 'text/vtt' }), 'podcast.vtt'));
        document.getElementById('deliveryPreset').addEventListener('change', event => {
            const directions = { warm: 'Speak warmly and reassuringly, with a gentle, conversational tone.', calm: 'Use calm, unhurried narration with natural pauses.', excited: 'Speak with upbeat enthusiasm and lively expression, while keeping every word clear.', news: 'Use a clear, composed newsreader delivery with precise articulation.' };
            const input = document.getElementById('speechInstructions');
            if (input && directions[event.target.value]) input.value = directions[event.target.value];
        });
        // Text input
        this.textInput.addEventListener('input', () => this.updateCharCount());
        this.clearBtn.addEventListener('click', () => this.clearText());
        
        // Engine selection
        this.engineSelect.addEventListener('change', () => this.onEngineChange());
        this.voiceSelect.addEventListener('change', () => this.saveSettings());
        for (const id of ['computeSelect', 'kokoroQuality', 'kittenModel', 'supertonicSteps', 'sentencePause', 'streamSpeech']) {
            document.getElementById(id).addEventListener('change', () => {
                this.saveSettings();
                if (!this.isGenerating && ['computeSelect', 'kokoroQuality', 'kittenModel'].includes(id)) { this.computeMode = null; this.updateComputeModeDisplay(); }
            });
        }
        document.getElementById('clearReference').addEventListener('click', () => {
            document.getElementById('referenceAudio').value = '';
            this.clearReferenceVoice();
        });
        document.getElementById('referenceAudio').addEventListener('change', () => this.clearReferenceVoice());
        document.getElementById('clearModelDownloads').addEventListener('click', () => this.clearDownloads());
        this.languageSelect.addEventListener('change', () => this.onLanguageChange());
        
        // API key
        this.apiKeyInput.addEventListener('input', () => this.saveAPIKey());
        document.getElementById('refreshVoices').addEventListener('click', () => this.refreshAPIVoices());
        
        // Sliders
        this.speedSlider.addEventListener('input', () => {
            this.speedValue.textContent = this.speedSlider.value + 'x';
            this.saveSettings();
        });
        
        this.pitchSlider.addEventListener('input', () => {
            this.pitchValue.textContent = this.pitchSlider.value;
            this.saveSettings();
        });
        
        this.stabilitySlider.addEventListener('input', () => {
            this.stabilityValue.textContent = this.stabilitySlider.value;
            this.saveSettings();
        });
        
        this.similaritySlider.addEventListener('input', () => {
            this.similarityValue.textContent = this.similaritySlider.value;
            this.saveSettings();
        });
        
        // Buttons
        this.generateBtn.addEventListener('click', () => this.generateSpeech());
        this.downloadBtn.addEventListener('click', () => this.downloadAudio());
        this.stopBtn.addEventListener('click', () => this.stopGeneration());
        document.getElementById('pauseStream').addEventListener('click', () => this.toggleStreamPause());
        document.getElementById('liveVolume').addEventListener('input', event => {
            const volume = event.target.value;
            if (this.streamPlayer) this.streamPlayer.setVolume(Number(volume) / 100);
            this.waveformPlayer.volumeSlider.value = volume;
            this.waveformPlayer.volumeSlider.dispatchEvent(new Event('input'));
        });
        
        // Chrome AI buttons
        this.summarizeBtn.addEventListener('click', () => this.summarizeText());
        this.detectLangBtn.addEventListener('click', () => this.detectLanguage());
        this.improveBtn.addEventListener('click', () => this.improveText());
        document.getElementById('translateBtn').addEventListener('click', () => this.translateText());
        
        // Tabs
        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab));
        });
    }

    switchTab(clickedTab) {
        const tabName = clickedTab.dataset.tab;
        
        this.tabs.forEach(tab => tab.classList.remove('active'));
        this.tabContents.forEach(content => content.classList.remove('active'));
        
        clickedTab.classList.add('active');
        document.getElementById(`${tabName}-tab`).classList.add('active');
    }

    initializeWaveformPlayer() {
        if (this.waveformContainer && window.WaveformPlayer) {
            console.log('Initializing waveform player...');
            this.waveformPlayer = new window.WaveformPlayer(this.waveformContainer);
            console.log('Waveform player initialized:', this.waveformPlayer);
        } else {
            console.warn('Waveform player not initialized - container or WaveformPlayer class missing');
        }
    }

    initializeBrowserTTS() {
        // Initialize browser TTS voices
        this.loadBrowserVoices();
        
        // Don't initialize audio context until user interaction
        // It will be initialized on first generate button click
    }

    async initializeKokoro() {
        if (this.voiceLists.kokoro) return;
        // Import voice metadata only when this engine is selected; models load on Generate.
        const response = await fetch(new URL('./thirdparty/neural/kokoro-voices.json', import.meta.url));
        if (!response.ok) throw new Error('Could not load the Kokoro voice list');
        const voices = await response.json();
        this.voiceLists.kokoro = voices;
        if (this.currentEngine === 'kokoro') this.populateKokoroVoices();
    }

    async initializeChromeAI() {
        for (const [name, button] of [['Summarizer', this.summarizeBtn], ['LanguageDetector', this.detectLangBtn], ['Rewriter', this.improveBtn]]) {
            try {
                if (self[name] && await self[name].availability() !== 'unavailable') button.style.display = 'inline-block';
            } catch (_) { /* Built-in AI availability varies by browser and device. */ }
        }
        document.getElementById('translateBtn').hidden = !(self.Translator && self.LanguageDetector);
    }

    aiMonitor() {
        return { monitor: monitor => monitor.addEventListener('downloadprogress', event => {
            this.showStatus(`Downloading browser language model: ${Math.round(event.loaded * 100)}%`, 'info');
        }) };
    }

    async translateText() {
        const text = this.textInput.value.trim();
        if (!text) return;
        const button = document.getElementById('translateBtn');
        button.disabled = true;
        let translator;
        try {
            this.showStatus('Preparing local translation…', 'info');
            if (!this.chromeAI.detector) this.chromeAI.detector = await LanguageDetector.create(this.aiMonitor());
            const results = await this.chromeAI.detector.detect(text);
            if (!results.length) throw new Error('Could not detect the source language');
            const options = { sourceLanguage: results[0].detectedLanguage, targetLanguage: this.languageSelect.value.split('-')[0] };
            if (options.sourceLanguage === options.targetLanguage) { this.showStatus('The text already matches the selected language.', 'info'); return; }
            if (await Translator.availability(options) === 'unavailable') throw new Error('This browser does not support that language pair');
            translator = await Translator.create({ ...options, ...this.aiMonitor() });
            const translated = await translator.translate(text);
            if (this.textInput.value.trim() !== text) throw new Error('Text changed during translation. Try again with the current text.');
            this.textInput.value = translated;
            this.updateCharCount();
            this.showStatus('Translated locally. Review the text, then generate speech.', 'success');
        } catch (error) { this.showStatus(error.message, 'error'); }
        finally { if (translator) translator.destroy(); button.disabled = false; }
    }

    async summarizeText() {
        const text = this.textInput.value.trim();
        if (!text) return;
        
        try {
            this.showStatus('Summarizing text with AI...', 'info');
            
            if (!this.chromeAI.summarizer) {
                this.chromeAI.summarizer = await Summarizer.create({ type: 'tldr', format: 'plain-text', ...this.aiMonitor() });
            }
            
            const summary = await this.chromeAI.summarizer.summarize(text);
            if (this.textInput.value.trim() !== text) throw new Error('Text changed during summarization. Try again with the current text.');
            this.textInput.value = summary;
            this.updateCharCount();
            this.showStatus('Text summarized successfully', 'success');
            
        } catch (error) {
            console.error('Summarization failed:', error);
            this.showStatus(error.message || 'Failed to summarize text', 'error');
        }
    }

    async detectLanguage() {
        const text = this.textInput.value.trim();
        if (!text) return;
        
        try {
            this.showStatus('Detecting language...', 'info');
            
            if (!this.chromeAI.detector) {
                this.chromeAI.detector = await LanguageDetector.create(this.aiMonitor());
            }
            
            const results = await this.chromeAI.detector.detect(text);
            if (this.textInput.value.trim() !== text) return;
            if (results && results.length > 0) {
                const topLanguage = results[0];
                const langCode = topLanguage.detectedLanguage;
                
                const option = Array.from(this.languageSelect.options).find(item => item.value.split('-')[0] === langCode);
                if (option && !option.disabled) {
                    this.languageSelect.value = option.value;
                    this.onLanguageChange();
                } else {
                    this.showStatus(`Detected ${langCode}. Choose an engine that supports this language.`, 'info');
                    return;
                }
                
                this.showStatus(`Language detected: ${topLanguage.detectedLanguage} (${(topLanguage.confidence * 100).toFixed(1)}% confidence)`, 'success');
            }
        } catch (error) {
            console.error('Language detection failed:', error);
            this.showStatus('Failed to detect language', 'error');
        }
    }

    async improveText() {
        const text = this.textInput.value.trim();
        if (!text) return;
        let writer;
        try {
            this.showStatus('Improving text with AI...', 'info');
            
            writer = await Rewriter.create({ ...this.aiMonitor(),
                tone: 'neutral',
                format: 'plain-text',
                length: 'as-is'
            });
            
            const improved = await writer.rewrite(text);
            if (this.textInput.value.trim() !== text) throw new Error('Text changed during rewriting. Try again with the current text.');
            this.textInput.value = improved;
            this.updateCharCount();
            this.showStatus('Text improved successfully', 'success');
            
        } catch (error) {
            console.error('Text improvement failed:', error);
            this.showStatus(error.message || 'Failed to improve text', 'error');
        } finally { if (writer) writer.destroy(); }
    }

    loadBrowserVoices() {
        if (window.speechSynthesis) {
            const loadVoices = () => {
                const voices = window.speechSynthesis.getVoices();
                if (this.currentEngine === 'browser') {
                    this.populateBrowserVoices(voices);
                }
            };
            
            loadVoices();
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }
    }

    populateBrowserVoices(voices) {
        const language = this.languageSelect.value.split('-')[0];
        this.setVoices(voices.filter(voice => voice.lang.startsWith(language)).map(voice => [voice.name, `${voice.name} (${voice.lang})`]));
    }

    populateKokoroVoices() {
        const voices = this.voiceLists.kokoro;
        if (!voices || this.currentEngine !== 'kokoro') return;
        this.setVoices(Object.entries(voices).map(([id, voice]) => [id, `${voice.name} (${voice.language}, ${voice.gender})`]), 'af_aoede');
    }

    setVoices(voices, fallback) {
        const selected = this.voiceSelect.value;
        const saved = this.savedVoice();
        this.voiceSelect.replaceChildren();
        for (const [value, label] of voices) this.voiceSelect.add(new Option(label, value));
        const values = voices.map(voice => voice[0]);
        this.voiceSelect.value = [saved, selected, fallback, values[0]].find(value => values.includes(value)) || '';
    }

    savedVoice() {
        const voices = this.settings.voices || {};
        return voices[`${this.currentEngine}:${this.languageSelect.value}`] ?? voices[this.currentEngine];
    }

    async onEngineChange() {
        this.stopGeneration();
        const engine = this.engineSelect.value || 'kokoro';
        if (engine !== 'pocket' && this.pocket) { this.pocket.destroy(); this.pocket = null; }
        if (engine === 'pocket') this.neural.cancel();
        this.currentEngine = engine;
        this.textInput.placeholder = engine === 'musicgen' ? 'Gentle acoustic guitar and soft piano, warm instrumental podcast intro, relaxed tempo.' : this.defaultPlaceholder;
        if (engine === 'musicgen') document.getElementById('scriptMode').value = 'narration';
        document.getElementById('scriptMode').parentElement.hidden = engine === 'musicgen';
        this.updateStudioControls();
        this.computeMode = null;
        this.voiceSelect.replaceChildren();
        const local = ['kokoro', 'kitten-v08', 'supertonic'].includes(engine);
        this.apiKeySection.style.display = ['elevenlabs', 'openai', 'google'].includes(engine) ? 'block' : 'none';
        for (const id of ['stabilityGroup', 'similarityGroup']) document.getElementById(id).style.display = engine === 'elevenlabs' ? 'block' : 'none';
        document.getElementById('localModelSettings').hidden = !local;
        document.getElementById('kokoroQualityGroup').hidden = engine !== 'kokoro';
        document.getElementById('kittenModelGroup').hidden = engine !== 'kitten-v08';
        document.getElementById('supertonicStepsGroup').hidden = engine !== 'supertonic';
        document.getElementById('cloneSettings').hidden = engine !== 'pocket';
        document.getElementById('musicSettings').hidden = engine !== 'musicgen';
        this.voiceSelect.disabled = engine === 'musicgen';
        this.languageSelect.disabled = engine === 'musicgen';
        document.getElementById('sentencePauseGroup').hidden = !local;
        document.getElementById('streamingGroup').hidden = !(local || engine === 'pocket');
        document.getElementById('modelStorageGroup').hidden = !(local || engine === 'pocket' || engine === 'musicgen');
        document.getElementById('computeSelect').disabled = engine === 'kitten-v08';
        this.pitchSlider.disabled = !['browser', 'espeak', 'google'].includes(engine);
        this.speedSlider.disabled = ['pocket', 'musicgen'].includes(engine);
        this.updateLanguageOptions();
        document.getElementById('refreshVoices').hidden = !['elevenlabs', 'google'].includes(engine);
        this.apiKeyInput.value = this.sessionKeys[engine] ?? this.readStorage(`tts_${engine}_key`) ?? '';
        const descriptions = {
            kokoro: 'Local English voices, including US and British accents. Downloads on first Generate; cached for reuse.',
            'kitten-v08': 'Eight English voices. Choose Nano, Micro or Mini to trade download size for model capacity. Runs locally on CPU.',
            supertonic: '31 languages, ten voices, adjustable generation steps. About 400 MB on first use. Runs locally; upstream models are archived.',
            pocket: 'Experimental local voice cloning and built-in voices. About 125 MB for English, plus 21 MB when cloning. Larger language bundles may need more memory. Speed is controlled in the player.',
            musicgen: 'Describe the music in Text Input and choose a clip length.',
            kitten: 'Original compact English model. Kitten 0.8 offers newer voices and model sizes.',
            piper: 'Local English voices, downloaded from the bundled voice library.',
            espeak: 'Small multilingual speech synthesizer. Runs locally.',
            browser: 'Uses voices installed in your browser or operating system. Audio download is unavailable.',
            elevenlabs: 'Sends text to ElevenLabs using your API key.',
            openai: 'Sends text to OpenAI using your API key.',
            google: 'Sends text to Google Cloud using your API key.'
        };
        document.getElementById('engineDescription').textContent = descriptions[engine] || '';
        try {
            switch (engine) {
                case 'kokoro':
                    this.setVoices([['af_aoede', 'Aoede (US English)'], ['af_heart', 'Heart (US English)']]);
                    await this.initializeKokoro();
                    if (this.currentEngine === engine) this.populateKokoroVoices();
                    break;
                case 'kitten-v08': this.setVoices(['Bella', 'Jasper', 'Luna', 'Bruno', 'Rosie', 'Hugo', 'Kiki', 'Leo'].map(name => [name, name])); break;
                case 'supertonic': this.setVoices(['F1','F2','F3','F4','F5','M1','M2','M3','M4','M5'].map(name => [name, `${name[0] === 'F' ? 'Female' : 'Male'} ${name.slice(1)}`])); break;
                case 'pocket': this.setVoices([['alba', 'Alba'], ['marius', 'Marius'], ['javert', 'Javert'], ['jean', 'Jean'], ['fantine', 'Fantine'], ['cosette', 'Cosette'], ['eponine', 'Eponine'], ['azelma', 'Azelma']]); break;
                case 'browser': this.loadBrowserVoices(); break;
                case 'piper': this.populatePiperVoices(); break;
                case 'espeak': this.populateEspeakVoices(); break;
                case 'kitten': this.populateKittenVoices(); break;
                case 'elevenlabs': this.populateElevenLabsVoices(); break;
                case 'openai': this.populateOpenAIVoices(); break;
                case 'google': this.populateGoogleVoices(); break;
            }
        } catch (error) {
            if (this.currentEngine === engine && error.name !== 'AbortError') this.showStatus(error.message, 'error');
        }
        if (this.currentEngine !== engine) return;
        for (const [id, provider] of [['elevenlabsModel','elevenlabs'], ['openaiModel','openai']]) {
            const select = document.getElementById(id);
            if (select) select.parentElement.hidden = engine !== provider;
        }
        const saved = this.savedVoice();
        if (saved && Array.from(this.voiceSelect.options).some(option => option.value === saved)) this.voiceSelect.value = saved;
        this.updateComputeModeDisplay();
        this.updateCharCount();
        this.updateGenerateButtonState();
        this.saveSettings();
    }

    updateGenerateButtonState() {
        this.generateBtn.disabled = this.isGenerating || this.clearingDownloads;
        const label = document.createElement('span');
        label.textContent = this.isGenerating ? (this.preparing ? 'Preparing…' : 'Generating…') : this.currentEngine === 'musicgen' ? 'Generate Music' : 'Generate Speech';
        this.generateBtn.replaceChildren(label);
        this.generateBtn.classList.toggle('loading', this.isGenerating);
        document.getElementById('prepareModel').disabled = this.isGenerating || this.clearingDownloads;
    }

    updateStudioControls() {
        const dialogue = document.getElementById('scriptMode').value === 'dialogue';
        document.getElementById('podcastSettings').hidden = !dialogue;
        document.getElementById('dialogueHint').hidden = !dialogue;
        this.voiceSelect.labels[0].textContent = dialogue ? 'Speaker A' : 'Voice';
        document.getElementById('gpuPreferenceGroup').hidden = !['kokoro', 'supertonic'].includes(this.currentEngine);
        document.getElementById('prepareModel').hidden = !['kokoro', 'kitten-v08', 'supertonic', 'musicgen'].includes(this.currentEngine);
        document.getElementById('prepareHint').hidden = document.getElementById('prepareModel').hidden;
        document.getElementById('deliverySettings').hidden = this.currentEngine !== 'openai';
        this.syncPodcastVoices();
        this.updateStreamingControls();
    }

    syncPodcastVoices() {
        const select = document.getElementById('secondVoice');
        const saved = this.podcastVoices[`${this.currentEngine}:${this.languageSelect.value}`];
        select.replaceChildren(...Array.from(this.voiceSelect.options, option => new Option(option.textContent, option.value)));
        select.value = saved || Array.from(select.options).find(option => option.value !== this.voiceSelect.value)?.value || this.voiceSelect.value;
        if (select.selectedIndex < 0 && select.options.length) select.selectedIndex = Math.min(1, select.options.length - 1);
    }

    neuralOptions(text, streaming = false) {
        return { engine: this.currentEngine, text, stream: streaming, voice: this.voiceSelect.value, language: this.languageSelect.value,
            speed: Number(this.speedSlider.value), device: document.getElementById('computeSelect').value,
            powerPreference: document.getElementById('gpuPreference').value,
            chunkSize: Number(document.getElementById('chunkSize').value),
            quality: document.getElementById('kokoroQuality').value, model: document.getElementById('kittenModel').value,
            steps: Number(document.getElementById('supertonicSteps').value), pauseMs: Number(document.getElementById('sentencePause').value), musicSeconds: Number(document.getElementById('musicSeconds').value) };
    }

    async prepareModel() {
        if (this.isGenerating || this.clearingDownloads || !['kokoro', 'kitten-v08', 'supertonic', 'musicgen'].includes(this.currentEngine)) return;
        this.stopGeneration();
        const id = ++this.generationId;
        this.isGenerating = true;
        this.preparing = true;
        this.stopBtn.style.display = 'inline-block';
        this.updateGenerateButtonState();
        try {
            const result = await this.neural.request('prepare', this.neuralOptions(''), progress => {
                if (id === this.generationId) {
                    if (progress.device) this.updateGenerationMetrics(progress);
                    if (progress.message) this.showInlineProgress(progress.message);
                }
            });
            if (id === this.generationId) this.showStatus(`Model ready (${result.device === 'webgpu' ? 'WebGPU' : 'CPU'}, ${result.dtype}). Your next recording can start without loading the model again.`, 'success');
        } catch (error) {
            if (id === this.generationId && error.name !== 'AbortError') this.showStatus(error.message, 'error');
        } finally {
            if (id === this.generationId) {
                this.isGenerating = false;
                this.preparing = false;
                this.stopBtn.style.display = this.audioBlob ? 'inline-block' : 'none';
                this.updateGenerateButtonState();
            }
        }
    }

    async applyStudioPreset(preset) {
        this.stopGeneration();
        this.engineSelect.value = preset === 'compact' ? 'kitten-v08' : 'kokoro';
        document.getElementById('computeSelect').value = preset === 'compact' ? 'wasm' : 'auto';
        document.getElementById('kittenModel').value = 'nano';
        document.getElementById('chunkSize').value = preset === 'compact' ? '120' : '240';
        document.getElementById('kokoroQuality').value = 'auto';
        document.getElementById('streamSpeech').value = preset === 'compact' && this.audioPlaybackSupported ? 'on' : 'off';
        await this.onEngineChange();
        this.showStatus(preset === 'compact' ? 'Compact Kitten Nano selected with early playback. Prepare the model before a live session for a quicker start.' : 'Kokoro selected with automatic CPU/GPU quality and complete-recording playback.', 'info');
    }

    async checkDevice() {
        const output = document.getElementById('deviceDetails');
        output.textContent = 'Checking browser capabilities…';
        const preference = document.getElementById('gpuPreference').value;
        try {
            const adapter = navigator.gpu && await navigator.gpu.requestAdapter(preference === 'default' ? {} : { powerPreference: preference });
            const gpu = adapter ? `WebGPU available${adapter.info?.vendor ? ` (${adapter.info.vendor})` : ''}; FP16 ${adapter.features.has('shader-f16') ? 'supported' : 'unavailable'}` : 'WebGPU unavailable; use CPU';
            output.textContent = `${gpu}. ${navigator.deviceMemory ? `Approximate device memory: ${navigator.deviceMemory} GB. ` : ''}For a small download, use Kitten Nano. Keep this tab in the foreground while generating.`;
        } catch (_) { output.textContent = 'GPU access could not be checked. CPU engines remain available.'; }
    }

    downloadFile(blob, name) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    
    setButtonProgress(percent) {
        this.generateBtn.style.setProperty('--progress', percent + '%');
        if (percent > 0 && percent < 100) {
            this.generateBtn.classList.add('loading');
        } else {
            this.generateBtn.classList.remove('loading');
        }
    }

    populatePiperVoices() {
        this.voiceSelect.innerHTML = `
            <option value="en_US-amy-medium">Amy (US English, Medium)</option>
            <option value="en_US-danny-low">Danny (US English, Low)</option>
            <option value="en_GB-alan-low">Alan (British English, Low)</option>
            <option value="en_GB-alba-medium">Alba (British English, Medium)</option>
        `;
    }

    populateEspeakVoices() {
        this.voiceSelect.innerHTML = `
            <option value="en">English</option>
            <option value="en-us">English (US)</option>
            <option value="en-gb">English (UK)</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="it">Italian</option>
            <option value="pt">Portuguese</option>
            <option value="ru">Russian</option>
            <option value="zh">Chinese</option>
            <option value="ja">Japanese</option>
        `;
    }

    populateKittenVoices() {
        this.setVoices(['2-f','2-m','3-f','3-m','4-f','4-m','5-f','5-m'].map(id => [`expr-voice-${id}`, `Voice ${id[0]} (${id.endsWith('f') ? 'Female' : 'Male'})`]));
    }

    populateElevenLabsVoices() {
        // Create model selection dropdown
        const modelSelectEl = document.getElementById('elevenlabsModel');
        if (!modelSelectEl) {
            // Create model selector if it doesn't exist
            const voiceGroup = this.voiceSelect.parentElement;
            const modelDiv = document.createElement('div');
            const savedModel = this.readStorage('tts_elevenlabs_model') || 'eleven_flash_v2_5';
            modelDiv.innerHTML = `
                <label for="elevenlabsModel" style="display: block; margin-top: 1rem; margin-bottom: 0.5rem;">Model:</label>
                <select id="elevenlabsModel" style="width: 100%; padding: 0.5rem; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border); border-radius: 8px;">
                    <option value="eleven_flash_v2_5" ${savedModel === 'eleven_flash_v2_5' ? 'selected' : ''}>Eleven Flash v2.5 (low latency)</option>
                    <option value="eleven_v4" ${savedModel === 'eleven_v4' ? 'selected' : ''}>Eleven v4 (expressive, up to 2000 characters)</option>
                    <option value="eleven_v3" ${savedModel === 'eleven_v3' ? 'selected' : ''}>Eleven v3 (expressive, audio tags)</option>
                    <option value="eleven_monolingual_v1" ${savedModel === 'eleven_monolingual_v1' ? 'selected' : ''}>Eleven Monolingual v1 (English)</option>
                    <option value="eleven_multilingual_v2" ${savedModel === 'eleven_multilingual_v2' ? 'selected' : ''}>Eleven Multilingual v2 (29 languages)</option>
                    <option value="eleven_turbo_v2" ${savedModel === 'eleven_turbo_v2' ? 'selected' : ''}>Eleven Turbo v2 (Fast)</option>
                    <option value="eleven_turbo_v2_5" ${savedModel === 'eleven_turbo_v2_5' ? 'selected' : ''}>Eleven Turbo v2.5 (Legacy)</option>
                </select>
            `;
            voiceGroup.appendChild(modelDiv);
            
            // Add change listener to save selection
            const newModelSelect = document.getElementById('elevenlabsModel');
            if (newModelSelect) {
                newModelSelect.addEventListener('change', (e) => {
                    try { localStorage.setItem('tts_elevenlabs_model', e.target.value); } catch (_) {}
                    this.updateElevenLabsControls();
                    this.updateCharCount();
                });
            }
        }
        this.updateElevenLabsControls();
        const account = this.accountVoices.elevenlabs;
        if (account && account.key === this.apiKeyInput.value.trim()) {
            this.setVoices(account.voices);
            return;
        }
        
        // More comprehensive voice list
        this.voiceSelect.innerHTML = `
            <optgroup label="Female Voices">
                <option value="21m00Tcm4TlvDq8ikWAM">Rachel - Calm</option>
                <option value="AZnzlk1XvdvUeBnXmlld">Domi - Strong</option>
                <option value="EXAVITQu4vr4xnSDxMaL">Bella - Soft</option>
                <option value="MF3mGyEYCl7XYWbV9V6O">Elli - Childish</option>
                <option value="XB0fDUnXU5powFXDhCwa">Charlotte - English-Swedish</option>
                <option value="XrExE9yKIg1WjnnlVkGX">Lily - English-British</option>
                <option value="pFZP5JQG7iQjIQuC4Bku">Serena - American</option>
                <option value="nPczCjzI2devNBz1zQrb">Dorothy - British</option>
            </optgroup>
            <optgroup label="Male Voices">
                <option value="ErXwobaYiN019PkySvjV">Antoni - Well-rounded</option>
                <option value="TxGEqnHWrfWFTfGW9XjX">Josh - Narrative</option>
                <option value="VR6AewLTigWG4xSOukaG">Arnold - Crisp</option>
                <option value="pNInz6obpgDQGcFmaJgB">Adam - Deep</option>
                <option value="yoZ06aMxZJJ28mfd3POQ">Sam - Raspy</option>
                <option value="2EiwWnXFnvU5JabPnv8n">Clyde - War Veteran</option>
                <option value="CYw3kZ02Hs0563khs1Fj">Dave - English-Essex</option>
                <option value="D38z5RcWu1voky8WS1ja">Fin - Irish</option>
            </optgroup>
            <optgroup label="American Accents">
                <option value="IKne3meq5aSn9XLyUdCD">Charlie - Australian</option>
                <option value="TX3LPaxmHKxFdv7VOQHJ">Liam - American</option>
                <option value="SOYHLrjzK2X1ezoPC6cr">Harry - Anxious</option>
            </optgroup>
        `;
    }

    populateOpenAIVoices() {
        let select = document.getElementById('openaiModel');
        if (!select) {
            const group = document.createElement('div');
            group.innerHTML = '<label for="openaiModel">Speech model</label><select id="openaiModel"><option value="gpt-4o-mini-tts">GPT-4o mini TTS (expressive)</option><option value="tts-1">TTS-1 (fast)</option><option value="tts-1-hd">TTS-1 HD</option></select><label for="speechInstructions">Voice direction (GPT-4o mini TTS)</label><input id="speechInstructions" placeholder="For example: warm, calm narration" maxlength="1000">';
            this.voiceSelect.parentElement.appendChild(group);
            select = document.getElementById('openaiModel');
            select.value = this.readStorage('tts_openai_model') || 'gpt-4o-mini-tts';
            if (!select.value) select.value = 'gpt-4o-mini-tts';
            select.addEventListener('change', () => {
                try { localStorage.setItem('tts_openai_model', select.value); } catch (_) {}
                this.populateOpenAIVoices();
                this.updateCharCount();
                this.saveSettings();
            });
        }
        const modern = select.value === 'gpt-4o-mini-tts';
        const names = modern ? ['marin','cedar','alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse'] : ['alloy','ash','coral','echo','fable','onyx','nova','sage','shimmer'];
        this.setVoices(names.map(name => [name, name[0].toUpperCase() + name.slice(1)]));
        document.getElementById('speechInstructions').disabled = !modern;
        document.getElementById('deliveryPreset').disabled = !modern;
    }

    populateGoogleVoices() {
        const lang = this.languageSelect.value;
        const langPrefix = lang.split('-')[0];
        const account = this.accountVoices.google;
        if (account && account.key === this.apiKeyInput.value.trim()) {
            const voices = account.voices.filter(voice => voice.languages.includes(lang));
            if (voices.length) {
                this.setVoices(voices.map(voice => [voice.id, voice.label]));
                return;
            }
        }
        
        const voiceMap = {
            'en': [
                { value: 'en-US-Standard-A', text: 'Standard A (Female)' },
                { value: 'en-US-Standard-B', text: 'Standard B (Male)' },
                { value: 'en-US-Standard-C', text: 'Standard C (Female)' },
                { value: 'en-US-Standard-D', text: 'Standard D (Male)' },
                { value: 'en-US-Standard-E', text: 'Standard E (Female)' },
                { value: 'en-US-Standard-F', text: 'Standard F (Female)' },
                { value: 'en-US-Standard-G', text: 'Standard G (Female)' },
                { value: 'en-US-Standard-H', text: 'Standard H (Female)' },
                { value: 'en-US-Standard-I', text: 'Standard I (Male)' },
                { value: 'en-US-Standard-J', text: 'Standard J (Male)' },
                { value: 'en-US-Wavenet-A', text: 'WaveNet A (Female)' },
                { value: 'en-US-Wavenet-B', text: 'WaveNet B (Male)' },
                { value: 'en-US-Wavenet-C', text: 'WaveNet C (Female)' },
                { value: 'en-US-Wavenet-D', text: 'WaveNet D (Male)' },
                { value: 'en-US-Wavenet-E', text: 'WaveNet E (Female)' },
                { value: 'en-US-Wavenet-F', text: 'WaveNet F (Female)' },
                { value: 'en-US-Neural2-A', text: 'Neural2 A (Female)' },
                { value: 'en-US-Neural2-C', text: 'Neural2 C (Female)' },
                { value: 'en-US-Neural2-D', text: 'Neural2 D (Male)' },
                { value: 'en-US-Neural2-E', text: 'Neural2 E (Female)' },
                { value: 'en-US-Neural2-F', text: 'Neural2 F (Female)' },
                { value: 'en-US-Neural2-G', text: 'Neural2 G (Female)' },
                { value: 'en-US-Neural2-H', text: 'Neural2 H (Female)' },
                { value: 'en-US-Neural2-I', text: 'Neural2 I (Male)' },
                { value: 'en-US-Neural2-J', text: 'Neural2 J (Male)' },
                { value: 'en-US-Studio-M', text: 'Studio M (Male)' },
                { value: 'en-US-Studio-O', text: 'Studio O (Female)' }
            ],
            'es': [
                { value: 'es-ES-Standard-A', text: 'Standard A (Female)' },
                { value: 'es-ES-Standard-B', text: 'Standard B (Male)' },
                { value: 'es-ES-Standard-C', text: 'Standard C (Female)' },
                { value: 'es-ES-Standard-D', text: 'Standard D (Female)' },
                { value: 'es-ES-Wavenet-B', text: 'WaveNet B (Male)' },
                { value: 'es-ES-Wavenet-C', text: 'WaveNet C (Female)' },
                { value: 'es-ES-Neural2-A', text: 'Neural2 A (Female)' },
                { value: 'es-ES-Neural2-B', text: 'Neural2 B (Male)' },
                { value: 'es-ES-Neural2-C', text: 'Neural2 C (Female)' },
                { value: 'es-ES-Neural2-D', text: 'Neural2 D (Female)' },
                { value: 'es-ES-Neural2-E', text: 'Neural2 E (Female)' },
                { value: 'es-ES-Neural2-F', text: 'Neural2 F (Male)' }
            ],
            'fr': [
                { value: 'fr-FR-Standard-A', text: 'Standard A (Female)' },
                { value: 'fr-FR-Standard-B', text: 'Standard B (Male)' },
                { value: 'fr-FR-Standard-C', text: 'Standard C (Female)' },
                { value: 'fr-FR-Standard-D', text: 'Standard D (Male)' },
                { value: 'fr-FR-Wavenet-A', text: 'WaveNet A (Female)' },
                { value: 'fr-FR-Wavenet-B', text: 'WaveNet B (Male)' },
                { value: 'fr-FR-Neural2-A', text: 'Neural2 A (Female)' },
                { value: 'fr-FR-Neural2-B', text: 'Neural2 B (Male)' }
            ],
            'de': [
                { value: 'de-DE-Standard-A', text: 'Standard A (Female)' },
                { value: 'de-DE-Standard-B', text: 'Standard B (Male)' },
                { value: 'de-DE-Standard-C', text: 'Standard C (Female)' },
                { value: 'de-DE-Standard-D', text: 'Standard D (Male)' },
                { value: 'de-DE-Wavenet-A', text: 'WaveNet A (Female)' },
                { value: 'de-DE-Wavenet-B', text: 'WaveNet B (Male)' },
                { value: 'de-DE-Neural2-A', text: 'Neural2 A (Female)' },
                { value: 'de-DE-Neural2-B', text: 'Neural2 B (Male)' }
            ]
        };
        
        const voices = (voiceMap[langPrefix] || []).filter(voice => voice.value.startsWith(lang + '-'));
        if (!voices.length) {
            this.setVoices([['', `Automatic voice (${lang}) - or load available voices`]]);
            return;
        }
        
        // Create grouped options
        this.voiceSelect.innerHTML = '';
        
        // Group voices by type
        const standardVoices = voices.filter(v => v.value.includes('Standard'));
        const wavenetVoices = voices.filter(v => v.value.includes('Wavenet'));
        const neural2Voices = voices.filter(v => v.value.includes('Neural2'));
        const studioVoices = voices.filter(v => v.value.includes('Studio'));
        
        if (standardVoices.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'Standard Voices';
            standardVoices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.value;
                option.textContent = voice.text;
                group.appendChild(option);
            });
            this.voiceSelect.appendChild(group);
        }
        
        if (wavenetVoices.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'WaveNet Voices (Better Quality)';
            wavenetVoices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.value;
                option.textContent = voice.text;
                group.appendChild(option);
            });
            this.voiceSelect.appendChild(group);
        }
        
        if (neural2Voices.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'Neural2 Voices (Best Quality)';
            neural2Voices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.value;
                option.textContent = voice.text;
                group.appendChild(option);
            });
            this.voiceSelect.appendChild(group);
        }
        
        if (studioVoices.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'Studio Voices (Premium)';
            studioVoices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.value;
                option.textContent = voice.text;
                group.appendChild(option);
            });
            this.voiceSelect.appendChild(group);
        }
    }

    updateLanguageOptions() {
        const engine = this.currentEngine;
        const supported = ['kokoro', 'kitten', 'kitten-v08', 'piper'].includes(engine) ? ['en'] : engine === 'pocket' ? ['en','fr','de','it','pt','es'] : engine === 'supertonic' ? ['en','ko','ja','ar','bg','cs','da','de','el','es','et','fi','fr','hi','hr','hu','id','it','lt','lv','nl','pl','pt','ro','ru','sk','sl','sv','tr','uk','vi'] : null;
        for (const option of this.languageSelect.options) option.disabled = Boolean(supported && !supported.includes(option.value.split('-')[0]));
        if (this.languageSelect.selectedOptions[0]?.disabled) this.languageSelect.value = 'en-US';
    }

    onLanguageChange() {
        this.updateLanguageOptions();
        if (['kokoro', 'kitten-v08', 'supertonic'].includes(this.currentEngine)) {
            const saved = this.savedVoice();
            if (Array.from(this.voiceSelect.options).some(option => option.value === saved)) this.voiceSelect.value = saved;
            this.syncPodcastVoices();
        }
        // Update voices based on new language
        if (this.currentEngine === 'browser') {
            this.loadBrowserVoices();
        } else if (this.currentEngine === 'google') {
            this.populateGoogleVoices();
            const saved = this.savedVoice();
            if (Array.from(this.voiceSelect.options).some(option => option.value === saved)) this.voiceSelect.value = saved;
        }
        
        // Update TTS.js language
        if (window.TTS) {
            window.TTS.speechLang = this.languageSelect.value;
        }
        
        this.saveSettings();
    }
    
    updateComputeModeDisplay() {
        const display = document.getElementById('computeModeDisplay');
        const engine = this.currentEngine;
        const device = document.getElementById('computeSelect').value;
        display.textContent = this.computeMode || (['kokoro', 'supertonic'].includes(engine)
            ? (device === 'auto' ? 'Automatic: actual CPU or GPU shown when the model is ready.' : device === 'webgpu' ? 'GPU requested: waiting for the model to load.' : 'CPU selected: waiting for the model to load.')
            : ['kitten-v08', 'kitten', 'piper', 'espeak', 'pocket', 'musicgen'].includes(engine) ? 'CPU (local processing)'
            : engine === 'browser' ? 'Browser / operating system voice' : 'Cloud provider (remote processing)');
    }

    updateGenerationMetrics(info, firstAudioSeconds) {
        this.computeMode = `${info.device === 'webgpu' ? 'GPU (WebGPU)' : 'CPU (WASM)'}${info.dtype ? ` \u00b7 ${info.dtype}` : ''}`;
        const duration = info.generatedDuration ?? info.duration;
        if (info.seconds > 0 && duration > 0) {
            const speed = duration / info.seconds;
            this.computeMode += ` \u00b7 ${speed.toFixed(2)}\u00d7 real time${speed < 1 ? ' (slower than playback)' : ' (faster than playback)'} \u00b7 ${duration.toFixed(1)}s audio generated in ${info.seconds.toFixed(1)}s (excludes model loading)`;
        } else this.computeMode += ' \u00b7 Model ready';
        if (Number.isFinite(firstAudioSeconds)) this.computeMode += ` \u00b7 First chunk ready in ${firstAudioSeconds.toFixed(1)}s including loading`;
        this.updateComputeModeDisplay();
    }

    updateStreamingControls() {
        const music = document.getElementById('scriptMode').value === 'dialogue' && this.backgroundMusic;
        document.getElementById('streamSpeech').disabled = !this.audioPlaybackSupported || Boolean(music);
        document.getElementById('streamingHint').textContent = !this.audioPlaybackSupported ? 'This browser supports downloads only.' : music
            ? 'Music beds play after the complete recording is mixed. Clear the music bed for early playback.'
            : 'Hear the first chunk while the rest is generated. Slower devices may pause between chunks. The download contains the full recording.';
    }

    updateCharCount() {
        const count = this.textInput.value.length;
        const limit = this.textLimit();
        this.charCount.textContent = count;
        this.charLimit.textContent = limit;
        
        if (count > limit) {
            this.charCount.style.color = 'var(--error)';
        } else if (count > limit * 0.8) {
            this.charCount.style.color = 'var(--warning)';
        } else {
            this.charCount.style.color = 'var(--text-secondary)';
        }
        
        this.saveSettings();
    }

    textLimit() {
        if (this.currentEngine === 'musicgen') return 1000;
        if (this.currentEngine === 'openai') return 4096;
        if (this.currentEngine === 'elevenlabs' && document.getElementById('elevenlabsModel')?.value === 'eleven_v4') return 2000;
        return 5000;
    }

    updateElevenLabsControls() {
        const model = document.getElementById('elevenlabsModel').value;
        this.speedSlider.disabled = ['eleven_v3', 'eleven_v4'].includes(model);
        this.similaritySlider.disabled = model === 'eleven_v3';
        this.stabilitySlider.step = model === 'eleven_v3' ? '0.5' : '0.1';
        if (model === 'eleven_v3') {
            this.stabilitySlider.value = Math.round(Number(this.stabilitySlider.value) * 2) / 2;
            this.stabilityValue.textContent = this.stabilitySlider.value;
        }
    }

    clearText() {
        this.textInput.value = '';
        this.updateCharCount();
    }

    async generateSpeech() {
        if (this.isGenerating || this.clearingDownloads) return;
        const text = this.textInput.value.trim() || this.textInput.placeholder;
        if (text.length > this.textLimit()) { this.showStatus(`Please limit text to ${this.textLimit()} characters for this model.`, 'error'); return; }
        const engine = this.currentEngine;
        const id = ++this.generationId;
        let turns;
        if (document.getElementById('scriptMode').value === 'dialogue') {
            if (!['kokoro', 'kitten-v08', 'supertonic'].includes(engine)) { this.showStatus('Choose Kokoro, Kitten 0.8 or Supertonic for a two-speaker podcast.', 'error'); return; }
            try {
                turns = parseDialogue(text).map(turn => ({ ...turn, voice: turn.speaker === 'A' ? this.voiceSelect.value : document.getElementById('secondVoice').value }));
            } catch (error) { this.showStatus(error.message, 'error'); return; }
        }
        this.isGenerating = true;
        this.audioBlob = null;
        this.audioCues = [];
        document.getElementById('downloadCaptions').hidden = true;
        this.audioSection.style.display = 'none';
        this.downloadBtn.disabled = true;
        this.stopBtn.style.display = 'inline-block';
        this.waveformPlayer.stop();
        this.updateGenerateButtonState();
        this.requestController = new AbortController();
        const music = turns && this.backgroundMusic;
        const mixOptions = { volume: Number(document.getElementById('musicVolume').value), intro: Number(document.getElementById('musicIntro').value), outro: Number(document.getElementById('musicOutro').value), signal: this.requestController.signal };
        const streaming = !music && this.audioPlaybackSupported && ['kokoro', 'kitten-v08', 'supertonic', 'pocket'].includes(engine) && document.getElementById('streamSpeech').value === 'on';
        const neuralOptions = { ...this.neuralOptions(text, streaming), turns, turnPauseMs: Number(document.getElementById('turnPause').value) };
        const requestedAt = performance.now();
        this.computeMode = null;
        this.updateComputeModeDisplay();
        let firstAudioAt;
        let streamPlayer;
        try {
            if (music) {
                if (typeof OfflineAudioContext !== 'function') throw new Error('This browser cannot mix a music bed. Clear the music bed to generate speech.');
                await referenceDuration(music, this.requestController.signal, { min: 0.1, max: 120, message: 'Choose a music clip between 0.1 seconds and 2 minutes.' });
                if (id !== this.generationId) return;
            }
            streamPlayer = streaming ? new StreamPlayer(Number(this.waveformPlayer.volumeSlider.value) / 100) : null;
            this.streamPlayer = streamPlayer;
            document.getElementById('livePlayback').hidden = !streaming;
            document.getElementById('liveVolume').value = this.waveformPlayer.volumeSlider.value;
            document.getElementById('pauseStream').textContent = 'Pause live playback';
            document.getElementById('pauseStream').disabled = false;
            let blob;
            if (['kokoro', 'kitten-v08', 'supertonic', 'musicgen'].includes(engine)) {
                const result = await this.neural.request('generate', neuralOptions, progress => {
                    if (id !== this.generationId) return;
                    if (progress.duration > 0) firstAudioAt ??= performance.now();
                    if (progress.device) this.updateGenerationMetrics(progress, firstAudioAt ? (firstAudioAt - requestedAt) / 1000 : undefined);
                    if (progress.chunk) { streamPlayer.enqueue(progress.chunk, progress.sampleRate, progress.gap); return; }
                    if (progress.message) this.showInlineProgress(progress.message);
                    if (Number.isFinite(progress.percent)) this.setButtonProgress(progress.percent);
                });
                if (id !== this.generationId) return;
                this.audioCues = result.cues || [];
                blob = result.blob;
                this.updateGenerationMetrics(result, firstAudioAt ? (firstAudioAt - requestedAt) / 1000 : undefined);
            } else if (engine === 'pocket') blob = await this.generatePocket(text, id);
            else if (engine === 'browser') await this.generateBrowser(text);
            else if (['piper', 'espeak', 'kitten'].includes(engine)) blob = await this.generateWithTTSLib(engine, text, id);
            else blob = await this.generateWithAPI(engine, text);
            if (id !== this.generationId) return;
            let previewAvailable = this.audioPlaybackSupported;
            let mixFailed = false;
            if (blob) {
                if (engine === 'musicgen') {
                    this.lastMusicBlob = blob;
                    document.getElementById('useGeneratedMusic').disabled = false;
                }
                if (music) {
                    this.showInlineProgress('Mixing music, intro and outro locally…');
                    try {
                        blob = await mixPodcast(blob, music, mixOptions);
                        if (id !== this.generationId) return;
                        this.audioCues = this.audioCues.map(cue => ({ ...cue, start: cue.start + mixOptions.intro, end: cue.end + mixOptions.intro }));
                    } catch (error) {
                        if (error.name === 'AbortError') throw error;
                        mixFailed = true;
                    }
                    if (id !== this.generationId) return;
                }
                this.audioBlob = blob;
                document.getElementById('downloadCaptions').hidden = !this.audioCues.length;
                this.downloadBtn.disabled = false;
                if (this.audioPlaybackSupported) {
                    this.audioSection.style.display = 'block';
                    try {
                        await this.waveformPlayer.loadAudio(blob);
                    } catch (_) {
                        if (id !== this.generationId) return;
                        previewAvailable = false;
                        this.audioSection.style.display = 'none';
                        this.waveformPlayer.playPauseBtn.disabled = true;
                    }
                    if (id !== this.generationId) return;
                }
                if (streamPlayer) {
                    this.showStatus('Recording ready to download. Live playback can be paused, resumed or stopped.', 'info');
                    this.waveformPlayer.playPauseBtn.disabled = true;
                    await streamPlayer.drain();
                    if (id !== this.generationId) return;
                    this.waveformPlayer.playPauseBtn.disabled = !previewAvailable;
                } else if (previewAvailable) this.waveformPlayer.play();
            }
            this.showStatus(mixFailed ? 'Speech ready to download without music. The music mix failed; try another WAV or MP3 music file.' : engine === 'browser' ? 'Speech finished.' : previewAvailable ? 'Audio ready.' : 'Audio ready to download. Preview is unavailable in this browser.', mixFailed ? 'warning' : 'success');
        } catch (error) {
            if (id === this.generationId && error.name !== 'AbortError') this.showStatus(`Failed to generate speech: ${error.message || error}`, 'error');
        } finally {
            if (streamPlayer) streamPlayer.stop();
            if (id === this.generationId) {
                this.streamPlayer = null;
                document.getElementById('livePlayback').hidden = true;
                this.isGenerating = false;
                this.stopBtn.style.display = this.audioBlob ? 'inline-block' : 'none';
                this.setButtonProgress(0);
                this.updateGenerateButtonState();
            }
        }
    }

    async generatePocket(text, id) {
        const requestedAt = performance.now();
        const file = document.getElementById('referenceAudio').files[0];
        const selected = this.voiceSelect.value;
        const languages = { en: 'english_2026-04', fr: 'french_24l', de: 'german', it: 'italian', pt: 'portuguese', es: 'spanish' };
        const language = languages[this.languageSelect.value.split('-')[0]];
        if (!language) throw new Error('Pocket supports English, French, German, Italian, Portuguese and Spanish. Choose one in Voice settings.');
        if (file && file.size > 20 * 1024 * 1024) throw new Error('Use a reference recording smaller than 20 MB.');
        if (file && typeof OfflineAudioContext !== 'function') throw new Error('This browser cannot process reference recordings. Choose a built-in Pocket voice or use another browser.');
        const { PocketTTS } = await import('./thirdparty/neural/pocket/index.js');
        if (id !== this.generationId) throw new DOMException('Stopped', 'AbortError');
        const key = `${language}:${Boolean(file)}`;
        if (!this.pocket || this.pocketKey !== key) {
            if (this.pocket) this.pocket.destroy();
            this.pocket = new PocketTTS({ language, voiceCloning: Boolean(file), quantized: true,
                modelBaseUrl: 'https://huggingface.co/vlapky/pocket-tts-onnx/resolve/c469236dbc5f68287fa2fbf175b66de3b80123af/onnx',
                ortBaseUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/',
                maxThreads: Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2))) });
            this.pocketKey = key;
        }
        const pocket = this.pocket;
        const check = () => { if (id !== this.generationId) throw new DOMException('Stopped', 'AbortError'); };
        // Decode and validate a new reference before downloading the cloning models.
        let reference;
        if (file && pocket.referenceFile !== file) {
            this.showInlineProgress('Checking the reference recording locally...');
            await referenceDuration(file, this.requestController.signal);
            check();
            // Decode directly at the model rate using the browser's resampler.
            const context = new OfflineAudioContext(1, 1, 24000);
            const decoded = await context.decodeAudioData(await file.arrayBuffer());
            check();
            if (decoded.duration < 3 || decoded.duration > 30) throw new Error('Use a clear reference between 3 and 30 seconds; the first 10 seconds will be used.');
            const mono = new Float32Array(Math.min(decoded.length, decoded.sampleRate * 10));
            for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
                const data = decoded.getChannelData(channel);
                for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
            }
            reference = { mono, sampleRate: decoded.sampleRate };
        }
        check();
        if (!pocket.ready) await pocket.load(progress => {
            if (id === this.generationId) this.showInlineProgress(progress.label ? `Loading ${progress.label}${progress.total ? `: ${Math.round(progress.loaded / progress.total * 100)}%` : ''}` : 'Preparing Pocket TTS…');
        });
        check();
        let voice;
        if (file) {
            if (reference) {
                this.showInlineProgress('Encoding your reference voice locally...');
                voice = await pocket.cloneVoice(reference.mono, { inputSampleRate: reference.sampleRate, name: 'studio-reference' });
                check();
                pocket.referenceFile = file;
                pocket.referenceVoice = voice;
            } else voice = pocket.referenceVoice;
        } else {
            voice = await pocket.loadVoice(pocket.predefinedVoices.includes(selected) ? selected : pocket.predefinedVoices[0]);
        }
        check();
        const chunks = [];
        let sampleCount = 0;
        const started = performance.now();
        let firstAudioSeconds;
        let lastMetricUpdate = 0;
        this.updateGenerationMetrics({ device: 'wasm' });
        await pocket.generate(text, { voice, onChunk: audio => {
            if (id !== this.generationId) return;
            chunks.push(audio);
            sampleCount += audio.length;
            const now = performance.now();
            firstAudioSeconds ??= (now - requestedAt) / 1000;
            if (now - lastMetricUpdate > 500) {
                this.updateGenerationMetrics({ device: 'wasm', duration: sampleCount / pocket.sampleRate, seconds: (now - started) / 1000 }, firstAudioSeconds);
                lastMetricUpdate = now;
            }
            if (this.streamPlayer) this.streamPlayer.enqueue(audio, pocket.sampleRate);
            this.showInlineProgress(`Generating locally: ${(sampleCount / pocket.sampleRate).toFixed(1)}s audio…`);
        }});
        check();
        this.updateGenerationMetrics({ device: 'wasm', duration: sampleCount / pocket.sampleRate, seconds: (performance.now() - started) / 1000 }, firstAudioSeconds);
        // Pocket chunks are codec frames, not sentence boundaries: preserve their exact joins.
        if (!sampleCount) throw new Error('No audio generated');
        return chunksToWav(chunks, pocket.sampleRate, 0, false);
    }

    clearReferenceVoice() {
        if (this.currentEngine === 'pocket' && this.isGenerating) this.stopGeneration();
        // Termination also removes the encoded reference and conditioned state from memory.
        if (this.pocket) { this.pocket.destroy(); this.pocket = null; }
    }

    async clearDownloads() {
        if (this.clearingDownloads) return;
        const engine = this.currentEngine;
        if (!['kokoro', 'kitten-v08', 'supertonic', 'pocket', 'musicgen'].includes(engine)) return;
        this.stopGeneration();
        if (engine === 'pocket') this.clearReferenceVoice();
        else this.neural.cancel();
        this.clearingDownloads = true;
        const button = document.getElementById('clearModelDownloads');
        button.disabled = true;
        this.updateGenerateButtonState();
        try {
            const count = await clearModelCache(engine);
            this.showStatus(count ? `Cleared ${count} cached files for ${engine}. Models will download on next use.` : `No saved model downloads found for ${engine}.`, 'success');
        } catch (error) { this.showStatus(error.message, 'error'); }
        finally {
            this.clearingDownloads = false;
            button.disabled = false;
            this.updateGenerateButtonState();
        }
    }

    async toggleStreamPause() {
        const player = this.streamPlayer;
        if (!player) return;
        const button = document.getElementById('pauseStream');
        button.disabled = true;
        try {
            await player.setPaused(!player.paused);
            if (player === this.streamPlayer) button.textContent = player.paused ? 'Resume live playback' : 'Pause live playback';
        } catch (error) {
            if (player === this.streamPlayer) this.showStatus(error.message, 'error');
        } finally {
            if (player === this.streamPlayer) button.disabled = false;
        }
    }

    async generateBrowser(text) {
        return new Promise((resolve, reject) => {
            const utterance = new SpeechSynthesisUtterance(text);
            
            utterance.lang = this.languageSelect.value;
            utterance.rate = parseFloat(this.speedSlider.value);
            utterance.pitch = parseFloat(this.pitchSlider.value);
            
            const selectedVoice = this.voiceSelect.value;
            if (selectedVoice) {
                const voices = window.speechSynthesis.getVoices();
                const voice = voices.find(v => v.name === selectedVoice);
                if (voice) utterance.voice = voice;
            }
            
            this.browserResolve = resolve;
            utterance.onend = () => {
                if (this.browserResolve === resolve) this.browserResolve = null;
                resolve();
            };
            utterance.onerror = error => {
                if (this.browserResolve === resolve) this.browserResolve = null;
                reject(new Error(error.error || 'Browser speech failed'));
            };
            
            window.speechSynthesis.speak(utterance);
        });
    }

    generateWithTTSLib(engine, text, id) {
        const settings = { voice: this.voiceSelect.value, speed: Number(this.speedSlider.value), pitch: Number(this.pitchSlider.value) };
        const pending = (this.legacyPending || Promise.resolve()).catch(() => {}).then(() => {
            if (id !== this.generationId) throw new DOMException('Stopped', 'AbortError');
            return this.synthesizeLegacy(engine, text, settings);
        });
        this.legacyPending = pending;
        return pending;
    }

    async synthesizeLegacy(engine, text, settings) {
        const T = window.TTS;
        if (!T) throw new Error('TTS library not loaded');
        const { voice, speed, pitch } = settings;
        if (engine === 'piper') {
            T.piperSettings.voice = voice;
            if (T.piperInstance && T.piperInstance.voiceId !== voice) {
                if (T.piperInstance.session) await T.piperInstance.session.release();
                T.piperLoaded = false;
                T.piperInstance = null;
            }
            if (!await T.initPiper()) throw new Error('Piper failed to initialize');
            return T.piperInstance.synthesize(text, 1 / speed);
        }
        if (engine === 'espeak') {
            if (!await T.initEspeak()) throw new Error('eSpeak failed to initialize');
            const buffer = await T.espeakInstance.speak(text, { voice, speed: Math.round(175 * speed), pitch: Math.round(50 * pitch), amplitude: 100, variant: 0 });
            return new Blob([buffer], { type: 'audio/wav' });
        }
        if (!await T.initKitten()) throw new Error('Kitten failed to initialize');
        return T.kittenInstance.generateSpeech(text, voice, speed);
    }

    async generateWithAPI(engine, text) {
        const key = this.apiKeyInput.value.trim();
        if (!key) throw new Error(`API key required for ${engine}`);
        const voice = this.voiceSelect.value;
        const speed = Number(this.speedSlider.value);
        if (engine === 'openai' && text.length > 4096) throw new Error('OpenAI accepts up to 4096 characters per request. Shorten the text.');
        if (engine === 'google' && new TextEncoder().encode(text).length > 5000) throw new Error('Google accepts up to 5000 UTF-8 bytes per request. Shorten the text.');
        let url, body, headers = { 'Content-Type': 'application/json' };
        if (engine === 'elevenlabs') {
            url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`;
            headers['xi-api-key'] = key;
            body = { text, model_id: document.getElementById('elevenlabsModel').value,
                voice_settings: { stability: Number(this.stabilitySlider.value), similarity_boost: Number(this.similaritySlider.value), speed: Math.max(0.7, Math.min(1.2, speed)) } };
            if (body.model_id === 'eleven_v3') {
                body.voice_settings.stability = Math.round(body.voice_settings.stability * 2) / 2;
                delete body.voice_settings.speed;
                delete body.voice_settings.similarity_boost;
            } else if (body.model_id === 'eleven_v4') {
                if (text.length > 2000) throw new Error('Use up to 2000 characters per Eleven v4 recording.');
                url = 'https://api.elevenlabs.io/v1/text-to-dialogue';
                body = { inputs: [{ text, voice_id: voice }], model_id: 'eleven_v4',
                    settings: { stability: Number(this.stabilitySlider.value), similarity: Number(this.similaritySlider.value) } };
            }
        } else if (engine === 'openai') {
            url = 'https://api.openai.com/v1/audio/speech';
            headers.Authorization = `Bearer ${key}`;
            body = { input: text, voice, model: document.getElementById('openaiModel').value, speed, response_format: 'wav' };
            const instructions = document.getElementById('speechInstructions').value.trim();
            if (body.model === 'gpt-4o-mini-tts' && instructions) body.instructions = instructions;
        } else {
            url = 'https://texttospeech.googleapis.com/v1/text:synthesize';
            headers['X-Goog-Api-Key'] = key;
            body = { input: { text }, voice: { languageCode: this.languageSelect.value, name: voice },
                audioConfig: { audioEncoding: 'LINEAR16', speakingRate: speed, pitch: (Number(this.pitchSlider.value) - 1) * 12 } };
        }
        if (engine === 'google' && /Chirp3-HD|Studio/.test(voice)) delete body.audioConfig.pitch;
        if (engine === 'google' && !voice) delete body.voice.name;
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: this.requestController.signal });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || error.detail?.message || `Provider returned HTTP ${response.status}`);
        }
        if (engine !== 'google') return response.blob();
        const result = await response.json();
        if (!result.audioContent) throw new Error('Google returned no audio');
        return new Blob([Uint8Array.from(atob(result.audioContent), char => char.charCodeAt(0))], { type: 'audio/wav' });
    }

    stopGeneration() {
        const wasGenerating = this.isGenerating;
        document.getElementById('livePlayback').hidden = true;
        if (this.streamPlayer) { this.streamPlayer.stop(); this.streamPlayer = null; }
        if (this.waveformPlayer && this.waveformPlayer.audioBuffer) this.waveformPlayer.playPauseBtn.disabled = false;
        ++this.generationId;
        if (this.requestController) this.requestController.abort();
        if (wasGenerating) {
            this.neural.cancel();
            if (this.pocket) { this.pocket.destroy(); this.pocket = null; }
        }
        this.isGenerating = false;
        if (this.browserResolve) { this.browserResolve(); this.browserResolve = null; }
        this.preparing = false;
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (this.waveformPlayer) this.waveformPlayer.stop();
        if (this.audioPlayer) this.audioPlayer.pause();
        this.stopBtn.style.display = 'none';
        this.hideInlineProgress();
        this.setButtonProgress(0);
        this.updateGenerateButtonState();
    }

    downloadAudio() {
        if (this.audioBlob) {
            const url = URL.createObjectURL(this.audioBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tts_${Date.now()}.${this.audioBlob.type.includes('mpeg') ? 'mp3' : 'wav'}`;
            a.click();
            URL.revokeObjectURL(url);
        } else if (this.audioPlayer.src) {
            // Try to download from audio player source
            const a = document.createElement('a');
            a.href = this.audioPlayer.src;
            a.download = `tts_${Date.now()}.mp3`;
            a.click();
        }
    }

    async refreshAPIVoices() {
        const engine = this.currentEngine;
        const key = this.apiKeyInput.value.trim();
        if (!key) { this.showStatus('Enter an API key to load your available voices.', 'info'); return; }
        if (!['elevenlabs', 'google'].includes(engine)) return;
        if (this.voiceListController) this.voiceListController.abort();
        const controller = this.voiceListController = new AbortController();
        try {
            const url = engine === 'google' ? 'https://texttospeech.googleapis.com/v1/voices' : 'https://api.elevenlabs.io/v1/voices';
            const headers = engine === 'google' ? { 'X-Goog-Api-Key': key } : { 'xi-api-key': key };
            const response = await fetch(url, { headers, signal: controller.signal });
            if (!response.ok) throw new Error(`Voice list returned HTTP ${response.status}`);
            const data = await response.json();
            if (controller.signal.aborted || engine !== this.currentEngine || key !== this.apiKeyInput.value.trim()) return;
            if (!Array.isArray(data.voices)) throw new Error('The provider returned an invalid voice list');
            this.accountVoices[engine] = { key, voices: engine === 'google'
                ? data.voices.map(voice => ({ id: voice.name, label: `${voice.name} (${voice.ssmlGender})`, languages: voice.languageCodes || [] }))
                : data.voices.map(voice => [voice.voice_id, voice.name]) };
            const voices = engine === 'google' ? this.accountVoices.google.voices.filter(voice => voice.languages.includes(this.languageSelect.value)).map(voice => [voice.id, voice.label]) : this.accountVoices.elevenlabs.voices;
            if (!voices.length) throw new Error('No voices available for this language');
            this.setVoices(voices);
            this.saveSettings();
            this.showStatus(`Loaded ${voices.length} available voices.`, 'success');
        } catch (error) {
            if (!controller.signal.aborted && engine === this.currentEngine && key === this.apiKeyInput.value.trim()) this.showStatus(error.message, 'error');
        }
    }

    saveAPIKey() {
        const engine = this.engineSelect.value;
        const key = this.apiKeyInput.value;
        this.sessionKeys[engine] = key;
        if (this.voiceListController) this.voiceListController.abort();
        const account = this.accountVoices[engine];
        if (account && account.key !== key.trim()) {
            delete this.accountVoices[engine];
            if (engine === 'google') this.populateGoogleVoices();
            if (engine === 'elevenlabs') this.populateElevenLabsVoices();
        }

        try {
            if (key) {
                localStorage.setItem(`tts_${engine}_key`, key);
                this.showStatus('API key saved in this browser', 'success');
            } else localStorage.removeItem(`tts_${engine}_key`);
        } catch (_) { this.showStatus('Browser storage is unavailable. This key will be used for this session.', 'info'); }
        
        this.updateGenerateButtonState();
    }

    saveSettings() {
        if (this.restoring) return;
        const voices = { ...this.settings.voices };
        if (this.voiceSelect.options.length) {
            voices[this.currentEngine] = this.voiceSelect.value;
            voices[`${this.currentEngine}:${this.languageSelect.value}`] = this.voiceSelect.value;
        }
        this.settings = { engine: this.currentEngine, voices, language: this.languageSelect.value,
            podcastVoices: this.podcastVoices,
            speed: this.speedSlider.value, pitch: this.pitchSlider.value, stability: this.stabilitySlider.value,
            similarity: this.similaritySlider.value, text: this.textInput.value };
        for (const id of ['computeSelect', 'kokoroQuality', 'kittenModel', 'supertonicSteps', 'sentencePause', 'streamSpeech', 'scriptMode', 'turnPause', 'gpuPreference', 'musicSeconds', 'chunkSize', 'musicVolume', 'musicIntro', 'musicOutro']) this.settings[id] = document.getElementById(id).value;
        try { localStorage.setItem('tts_settings', JSON.stringify(this.settings)); } catch (_) { /* Storage is optional. */ }
    }

    readStorage(key) {
        try { return localStorage.getItem(key); } catch (_) { return null; }
    }

    loadSettings() {
        try {
            const settings = JSON.parse(localStorage.getItem('tts_settings') || '{}');
            return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
        }
        catch (_) { return {}; }
    }

    restoreState() {
        this.restoring = true;
        const settings = this.settings;
        if (!settings.voices) settings.voices = settings.voice ? { [settings.engine || 'kokoro']: settings.voice } : {};
        this.engineSelect.value = settings.engine || 'kokoro';
        if (!this.engineSelect.value) this.engineSelect.value = 'kokoro';
        if (settings.language) this.languageSelect.value = settings.language;
        for (const [name, control, label] of [['speed', this.speedSlider, this.speedValue], ['pitch', this.pitchSlider, this.pitchValue], ['stability', this.stabilitySlider, this.stabilityValue], ['similarity', this.similaritySlider, this.similarityValue]]) {
            if (settings[name] != null) { control.value = settings[name]; label.textContent = settings[name] + (name === 'speed' ? 'x' : ''); }
        }
        for (const id of ['computeSelect', 'kokoroQuality', 'kittenModel', 'supertonicSteps', 'sentencePause', 'streamSpeech', 'scriptMode', 'turnPause', 'gpuPreference', 'musicSeconds', 'chunkSize', 'musicVolume', 'musicIntro', 'musicOutro']) {
            const control = document.getElementById(id);
            if (settings[id] && Array.from(control.options).some(option => option.value === settings[id])) control.value = settings[id];
        }
        this.textInput.value = settings.text || '';
        this.updateCharCount();
        this.restoring = false;
        this.onEngineChange();
    }

    showStatus(message, type = 'info') {
        clearTimeout(this.statusTimer);
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message ${type}`;
        this.statusMessage.style.display = 'block';
        if (type === 'success') this.statusTimer = setTimeout(() => { this.statusMessage.style.display = 'none'; }, 8000);
    }

    showInlineProgress(message) {
        this.showStatus(message, 'info');
    }

    hideInlineProgress() {
        this.statusMessage.style.display = 'none';
    }

    showProgress(message) {
        this.progressText.textContent = message;
        this.progressOverlay.style.display = 'flex';
    }

    hideProgress() {
        this.progressOverlay.style.display = 'none';
    }

    setProgress(percent) {
        this.progressFill.style.width = `${percent}%`;
    }


}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.ttsApp = new TTSApp();
});
