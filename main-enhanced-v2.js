// Enhanced TTS application with multiple engines and Chrome AI integration
import { KokoroTTS, TextSplitterStream, detectWebGPU } from './dist/lib/kokoro-bundle.es.js';

class TTSApp {
    constructor() {
        this.currentEngine = 'kokoro'; // Start with kokoro by default
        this.kokoroTTS = null;
        this.audioBlob = null;
        this.isGenerating = false;
        this.isInitializing = false;
        this.engineInitStatus = {
            kokoro: false,
            piper: false,
            espeak: false,
            kitten: false
        };
        this.computeMode = null; // Track compute mode for display
        this.settings = this.loadSettings();
        this.chromeAI = {
            summarizer: null,
            translator: null,
            detector: null,
            writer: null
        };
        this.waveformPlayer = null;
        this.cacheManager = null;
        
        this.initializeElements();
        this.attachEventListeners();
        this.initializeWaveformPlayer();
        this.initializeCacheManager();
        this.initializeBrowserTTS();
        this.restoreState();
        this.initializeChromeAI();
        this.updateGenerateButtonState();
    }

    initializeElements() {
        // Text elements
        this.textInput = document.getElementById('textInput');
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
        // FORCE audio player to stay hidden - no exceptions
        if (this.audioPlayer) {
            this.audioPlayer.removeAttribute('controls');
            this.audioPlayer.style.display = 'none !important';
            this.audioPlayer.style.visibility = 'hidden';
            this.audioPlayer.style.position = 'absolute';
            this.audioPlayer.style.left = '-9999px';
            
            // Use MutationObserver to prevent any changes
            const observer = new MutationObserver(() => {
                this.audioPlayer.removeAttribute('controls');
                this.audioPlayer.style.display = 'none !important';
                this.audioPlayer.style.visibility = 'hidden';
            });
            observer.observe(this.audioPlayer, { 
                attributes: true, 
                attributeFilter: ['controls', 'style'] 
            });
        }
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
        // Text input
        this.textInput.addEventListener('input', () => this.updateCharCount());
        this.clearBtn.addEventListener('click', () => this.clearText());
        
        // Engine selection
        this.engineSelect.addEventListener('change', () => this.onEngineChange());
        this.voiceSelect.addEventListener('change', () => this.saveSettings());
        this.languageSelect.addEventListener('change', () => this.onLanguageChange());
        
        // API key
        this.apiKeyInput.addEventListener('input', () => this.saveAPIKey());
        
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
        
        // Chrome AI buttons
        this.summarizeBtn.addEventListener('click', () => this.summarizeText());
        this.detectLangBtn.addEventListener('click', () => this.detectLanguage());
        this.improveBtn.addEventListener('click', () => this.improveText());
        
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

    async initializeCacheManager() {
        if (window.ModelCacheManager) {
            this.cacheManager = new window.ModelCacheManager();
            // Clean up old models (older than 30 days)
            await this.cacheManager.cleanupOldModels();
            
            // Log cache info
            const cacheInfo = await this.cacheManager.getCacheInfo();
            console.log('Cache info:', cacheInfo);
        }
    }

    initializeBrowserTTS() {
        // Initialize browser TTS voices
        this.loadBrowserVoices();
        
        // Don't initialize audio context until user interaction
        // It will be initialized on first generate button click
    }

    async initializeKokoro() {
        if (this.kokoroTTS) {
            console.log('Kokoro already initialized');
            return; // Already initialized
        }
        
        if (this.isInitializing) {
            console.log('Kokoro initialization already in progress');
            return; // Already initializing
        }
        
        this.isInitializing = true;
        this.updateGenerateButtonState();
        this.showInlineProgress('Initializing Kokoro TTS...');
        
        // Add timeout for initialization
        const timeout = setTimeout(() => {
            if (this.isInitializing) {
                console.error('Kokoro initialization timed out');
                this.isInitializing = false;
                this.updateGenerateButtonState();
                this.showStatus('Kokoro initialization timed out. Please try again.', 'error');
            }
        }, 30000); // 30 second timeout
        
        try {
            const hasWebGPU = await detectWebGPU();
            const device = hasWebGPU ? "webgpu" : "wasm";
            this.computeMode = hasWebGPU ? "WebGPU (GPU Accelerated)" : "WASM (CPU)";
            console.log('Using device:', device, '- Compute mode:', this.computeMode);
            
            // Show compute mode in progress message
            this.showInlineProgress(`Initializing Kokoro TTS (${this.computeMode})...`);
            
            // Update UI to show compute mode if Kokoro is selected
            if (this.currentEngine === 'kokoro') {
                this.updateComputeModeDisplay();
            }
            
            let modelData = await this.getCachedModel('kokoro-82M');
            
            if (!modelData) {
                console.log('Model not cached, downloading...');
                this.showInlineProgress('Downloading Kokoro model (82MB)...');
                modelData = await this.downloadAndCacheModel();
            } else {
                console.log('Using cached model, size:', modelData ? modelData.length : 0);
                this.showInlineProgress('Loading cached model...');
            }
            
            // Ensure we have valid model data
            if (!modelData || modelData.length === 0) {
                console.error('Invalid model data, re-downloading...');
                // Clear cache first
                if (this.cacheManager) {
                    await this.cacheManager.deleteModel('kokoro-82M');
                }
                modelData = await this.downloadAndCacheModel();
            }
            
            const customLoadFn = async () => {
                console.log('Load function called, returning model data of size:', modelData.length);
                return modelData;
            };
            
            // Use the correct initialization parameters
            this.kokoroTTS = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
                dtype: device === "wasm" ? "q8" : "fp32",
                device: device,
                load_fn: customLoadFn
            });
            
            clearTimeout(timeout);
            console.log('Kokoro TTS initialized successfully with voices:', this.kokoroTTS.voices);
            this.engineInitStatus.kokoro = true;
            this.isInitializing = false;
            this.hideInlineProgress();
            this.populateKokoroVoices();
            this.updateGenerateButtonState();
            
        } catch (error) {
            clearTimeout(timeout);
            console.error('Failed to initialize Kokoro:', error);
            this.showStatus('Failed to initialize Kokoro TTS: ' + error.message, 'error');
            this.hideInlineProgress();
            this.isInitializing = false;
            this.kokoroTTS = null;
            this.updateGenerateButtonState();
            
            // Try to clear cache if initialization failed
            try {
                const db = await this.openDB();
                const transaction = db.transaction('models', 'readwrite');
                const store = transaction.objectStore('models');
                await store.delete('kokoro-82M');
                console.log('Cleared cached model due to initialization failure');
            } catch (e) {
                console.error('Error clearing cache:', e);
            }
        }
    }

    async initializeChromeAI() {
        // Check for Chrome AI APIs
        if ('ai' in self && 'summarizer' in self.ai) {
            try {
                const canSummarize = await self.ai.summarizer.capabilities();
                if (canSummarize.available !== 'no') {
                    this.summarizeBtn.style.display = 'inline-block';
                    if (canSummarize.available === 'readily') {
                        this.chromeAI.summarizer = await self.ai.summarizer.create();
                    }
                }
            } catch (e) {
                console.log('Summarizer API not available:', e);
            }
        }
        
        if ('ai' in self && 'languageDetector' in self.ai) {
            try {
                const canDetect = await self.ai.languageDetector.capabilities();
                if (canDetect.available !== 'no') {
                    this.detectLangBtn.style.display = 'inline-block';
                    if (canDetect.available === 'readily') {
                        this.chromeAI.detector = await self.ai.languageDetector.create();
                    }
                }
            } catch (e) {
                console.log('Language Detector API not available:', e);
            }
        }
        
        if ('ai' in self && 'writer' in self.ai) {
            try {
                const canWrite = await self.ai.writer.capabilities();
                if (canWrite.available !== 'no') {
                    this.improveBtn.style.display = 'inline-block';
                }
            } catch (e) {
                console.log('Writer API not available:', e);
            }
        }
    }

    async summarizeText() {
        const text = this.textInput.value.trim();
        if (!text) return;
        
        try {
            this.showStatus('Summarizing text with AI...', 'info');
            
            if (!this.chromeAI.summarizer) {
                this.chromeAI.summarizer = await self.ai.summarizer.create();
            }
            
            const summary = await this.chromeAI.summarizer.summarize(text);
            this.textInput.value = summary;
            this.updateCharCount();
            this.showStatus('Text summarized successfully', 'success');
            
        } catch (error) {
            console.error('Summarization failed:', error);
            this.showStatus('Failed to summarize text', 'error');
        }
    }

    async detectLanguage() {
        const text = this.textInput.value.trim();
        if (!text) return;
        
        try {
            this.showStatus('Detecting language...', 'info');
            
            if (!this.chromeAI.detector) {
                this.chromeAI.detector = await self.ai.languageDetector.create();
            }
            
            const results = await this.chromeAI.detector.detect(text);
            if (results && results.length > 0) {
                const topLanguage = results[0];
                const langCode = topLanguage.detectedLanguage;
                
                // Map to our language select options
                const langMap = {
                    'en': 'en-US',
                    'es': 'es-ES',
                    'fr': 'fr-FR',
                    'de': 'de-DE',
                    'it': 'it-IT',
                    'pt': 'pt-BR',
                    'ru': 'ru-RU',
                    'zh': 'zh-CN',
                    'ja': 'ja-JP',
                    'ko': 'ko-KR'
                };
                
                const mappedLang = langMap[langCode] || 'en-US';
                this.languageSelect.value = mappedLang;
                this.onLanguageChange();
                
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
        
        try {
            this.showStatus('Improving text with AI...', 'info');
            
            const writer = await self.ai.writer.create({
                tone: 'neutral',
                format: 'plain-text',
                length: 'as-is'
            });
            
            const improved = await writer.write(text);
            this.textInput.value = improved;
            this.updateCharCount();
            this.showStatus('Text improved successfully', 'success');
            
        } catch (error) {
            console.error('Text improvement failed:', error);
            this.showStatus('Failed to improve text', 'error');
        }
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
        this.voiceSelect.innerHTML = '<option value="">Select a voice...</option>';
        
        const currentLang = this.languageSelect.value;
        const filteredVoices = voices.filter(voice => 
            voice.lang.startsWith(currentLang.split('-')[0])
        );
        
        filteredVoices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = `${voice.name} (${voice.lang})`;
            this.voiceSelect.appendChild(option);
        });
        
        if (filteredVoices.length > 0) {
            this.voiceSelect.value = filteredVoices[0].name;
        }
    }

    populateKokoroVoices() {
        if (!this.kokoroTTS) return;
        
        this.voiceSelect.innerHTML = '<option value="">Select a voice...</option>';
        
        const voices = this.kokoroTTS.voices;
        for (const key in voices) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = `${voices[key].name} (${voices[key].gender})`;
            this.voiceSelect.appendChild(option);
        }
        
        this.voiceSelect.value = 'af_aoede';
    }

    async onEngineChange() {
        const engine = this.engineSelect.value;
        this.currentEngine = engine;
        
        // Show/hide API key section
        const needsApiKey = ['elevenlabs', 'openai', 'google'].includes(engine);
        this.apiKeySection.style.display = needsApiKey ? 'block' : 'none';
        
        // Show/hide ElevenLabs specific controls
        const isElevenLabs = engine === 'elevenlabs';
        document.getElementById('stabilityGroup').style.display = isElevenLabs ? 'block' : 'none';
        document.getElementById('similarityGroup').style.display = isElevenLabs ? 'block' : 'none';
        
        // Load API key if exists
        if (needsApiKey) {
            const savedKey = localStorage.getItem(`tts_${engine}_key`);
            this.apiKeyInput.value = savedKey || '';
        }
        
        // Update voice list based on engine
        switch (engine) {
            case 'kokoro':
                if (!this.kokoroTTS && !this.isInitializing) {
                    // Start initialization in background
                    this.initializeKokoro().then(() => {
                        this.populateKokoroVoices();
                    });
                } else if (this.kokoroTTS) {
                    this.populateKokoroVoices();
                }
                break;
                
            case 'browser':
                this.loadBrowserVoices();
                break;
                
            case 'piper':
                this.populatePiperVoices();
                break;
                
            case 'espeak':
                this.populateEspeakVoices();
                break;
                
            case 'kitten':
                this.populateKittenVoices();
                break;
                
            case 'elevenlabs':
                this.populateElevenLabsVoices();
                break;
                
            case 'openai':
                this.populateOpenAIVoices();
                break;
                
            case 'google':
                this.populateGoogleVoices();
                break;
        }
        
        // Update compute mode display for the new engine
        this.updateComputeModeDisplay();
        
        this.updateGenerateButtonState();
        this.saveSettings();
    }

    updateGenerateButtonState() {
        const engine = this.currentEngine;
        
        // Check if engine is ready
        let isReady = true;
        let buttonText = 'Generate Speech';
        let buttonHTML = '<span>Generate Speech</span>';
        
        if (engine === 'kokoro') {
            if (this.isInitializing) {
                isReady = false;
                this.generateBtn.classList.add('loading');
                buttonHTML = '<span>Loading Model...</span>';
            } else {
                this.generateBtn.classList.remove('loading');
                if (!this.kokoroTTS) {
                    buttonHTML = '<span>Generate Speech (will download model)</span>';
                } else {
                    buttonHTML = '<span>Generate Speech</span>';
                }
            }
        } else if (['elevenlabs', 'openai', 'google'].includes(engine)) {
            this.generateBtn.classList.remove('loading');
            const savedKey = localStorage.getItem(`tts_${engine}_key`);
            if (!savedKey && !this.apiKeyInput.value) {
                buttonHTML = '<span>Generate Speech (API key required)</span>';
            }
        } else {
            this.generateBtn.classList.remove('loading');
        }
        
        this.generateBtn.innerHTML = buttonHTML;
        this.generateBtn.disabled = this.isInitializing;
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
        this.voiceSelect.innerHTML = `
            <option value="default">Default Voice</option>
        `;
    }

    populateElevenLabsVoices() {
        // Create model selection dropdown
        let modelSelectHTML = '';
        const modelSelectEl = document.getElementById('elevenlabsModel');
        if (!modelSelectEl) {
            // Create model selector if it doesn't exist
            const voiceGroup = this.voiceSelect.parentElement;
            const modelDiv = document.createElement('div');
            const savedModel = localStorage.getItem('tts_elevenlabs_model') || 'eleven_turbo_v2_5';
            modelDiv.innerHTML = `
                <label for="elevenlabsModel" style="display: block; margin-top: 1rem; margin-bottom: 0.5rem;">Model:</label>
                <select id="elevenlabsModel" style="width: 100%; padding: 0.5rem; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border); border-radius: 8px;">
                    <option value="eleven_monolingual_v1" ${savedModel === 'eleven_monolingual_v1' ? 'selected' : ''}>Eleven Monolingual v1 (English)</option>
                    <option value="eleven_multilingual_v2" ${savedModel === 'eleven_multilingual_v2' ? 'selected' : ''}>Eleven Multilingual v2 (29 languages)</option>
                    <option value="eleven_turbo_v2" ${savedModel === 'eleven_turbo_v2' ? 'selected' : ''}>Eleven Turbo v2 (Fast)</option>
                    <option value="eleven_turbo_v2_5" ${savedModel === 'eleven_turbo_v2_5' ? 'selected' : ''}>Eleven Turbo v2.5 (Fastest)</option>
                </select>
            `;
            voiceGroup.appendChild(modelDiv);
            
            // Add change listener to save selection
            const newModelSelect = document.getElementById('elevenlabsModel');
            if (newModelSelect) {
                newModelSelect.addEventListener('change', (e) => {
                    localStorage.setItem('tts_elevenlabs_model', e.target.value);
                });
            }
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
        // Create model selection dropdown
        const modelSelectEl = document.getElementById('openaiModel');
        if (!modelSelectEl) {
            // Create model selector if it doesn't exist
            const voiceGroup = this.voiceSelect.parentElement;
            const modelDiv = document.createElement('div');
            const savedModel = localStorage.getItem('tts_openai_model') || 'tts-1-hd';
            modelDiv.innerHTML = `
                <label for="openaiModel" style="display: block; margin-top: 1rem; margin-bottom: 0.5rem;">Model:</label>
                <select id="openaiModel" style="width: 100%; padding: 0.5rem; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border); border-radius: 8px;">
                    <option value="tts-1" ${savedModel === 'tts-1' ? 'selected' : ''}>TTS-1 (Optimized for speed)</option>
                    <option value="tts-1-hd" ${savedModel === 'tts-1-hd' ? 'selected' : ''}>TTS-1-HD (Optimized for quality)</option>
                </select>
            `;
            voiceGroup.appendChild(modelDiv);
            
            // Add change listener to save selection
            const newModelSelect = document.getElementById('openaiModel');
            if (newModelSelect) {
                newModelSelect.addEventListener('change', (e) => {
                    localStorage.setItem('tts_openai_model', e.target.value);
                });
            }
        }
        
        this.voiceSelect.innerHTML = `
            <option value="alloy">Alloy (Neutral)</option>
            <option value="echo">Echo (Male)</option>
            <option value="fable">Fable (British Male)</option>
            <option value="onyx">Onyx (Deep Male)</option>
            <option value="nova">Nova (Female)</option>
            <option value="shimmer">Shimmer (Female)</option>
        `;
    }

    populateGoogleVoices() {
        const lang = this.languageSelect.value;
        const langPrefix = lang.split('-')[0];
        
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
        
        const voices = voiceMap[langPrefix] || voiceMap['en'];
        
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

    onLanguageChange() {
        // Update voices based on new language
        if (this.currentEngine === 'browser') {
            this.loadBrowserVoices();
        } else if (this.currentEngine === 'google') {
            this.populateGoogleVoices();
        }
        
        // Update TTS.js language
        if (window.TTS) {
            window.TTS.speechLang = this.languageSelect.value;
        }
        
        this.saveSettings();
    }
    
    updateComputeModeDisplay() {
        // Find or create compute mode display element
        let computeModeEl = document.getElementById('computeModeDisplay');
        if (!computeModeEl) {
            // Create it if it doesn't exist
            const voiceGroup = this.voiceSelect.parentElement;
            computeModeEl = document.createElement('div');
            computeModeEl.id = 'computeModeDisplay';
            computeModeEl.style.cssText = 'margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);';
            voiceGroup.appendChild(computeModeEl);
        }
        
        // Update display based on current engine
        if (this.currentEngine === 'kokoro' && this.computeMode) {
            computeModeEl.innerHTML = `<span style="color: var(--accent);">⚡</span> ${this.computeMode}`;
            computeModeEl.style.display = 'block';
        } else if (this.currentEngine === 'kitten') {
            computeModeEl.innerHTML = `<span style="color: var(--accent);">🔧</span> WASM (CPU-based)`;
            computeModeEl.style.display = 'block';
        } else if (this.currentEngine === 'piper') {
            computeModeEl.innerHTML = `<span style="color: var(--accent);">🔧</span> WASM (CPU-based)`;
            computeModeEl.style.display = 'block';
        } else if (this.currentEngine === 'espeak') {
            computeModeEl.innerHTML = `<span style="color: var(--accent);">🔧</span> WASM (CPU-based)`;
            computeModeEl.style.display = 'block';
        } else {
            computeModeEl.style.display = 'none';
        }
    }

    updateCharCount() {
        const count = this.textInput.value.length;
        this.charCount.textContent = count;
        
        if (count > 5000) {
            this.charCount.style.color = 'var(--error)';
        } else if (count > 4000) {
            this.charCount.style.color = 'var(--warning)';
        } else {
            this.charCount.style.color = 'var(--text-secondary)';
        }
        
        this.saveSettings();
    }

    clearText() {
        this.textInput.value = '';
        this.updateCharCount();
    }

    async generateSpeech() {
        if (this.isGenerating) return;
        
        // Initialize audio context on first user interaction
        if (window.TTS && !window.TTS.audioContext) {
            window.TTS.initAudioContext();
        }
        
        // Use placeholder text if nothing entered
        const text = this.textInput.value.trim() || 
                    this.textInput.placeholder || 
                    "Welcome to TTS.Rocks! This advanced text-to-speech system can convert any text into natural-sounding speech using multiple AI engines.";
        
        if (text.length > 5000) {
            this.showStatus('Text is too long. Please limit to 5000 characters.', 'error');
            return;
        }
        
        this.isGenerating = true;
        this.generateBtn.disabled = true;
        this.stopBtn.style.display = 'inline-block';
        this.downloadBtn.disabled = true;
        
        try {
            switch (this.currentEngine) {
                case 'kokoro':
                    if (!this.kokoroTTS && !this.isInitializing) {
                        await this.initializeKokoro();
                    }
                    if (this.kokoroTTS) {
                        await this.generateKokoro(text);
                    } else {
                        throw new Error('Kokoro TTS failed to initialize');
                    }
                    break;
                    
                case 'browser':
                    await this.generateBrowser(text);
                    break;
                    
                case 'piper':
                    await this.generateWithTTSLib('piper', text);
                    break;
                    
                case 'espeak':
                    await this.generateWithTTSLib('espeak', text);
                    break;
                    
                case 'kitten':
                    await this.generateWithTTSLib('kitten', text);
                    break;
                    
                case 'elevenlabs':
                    await this.generateWithAPI('elevenlabs', text);
                    break;
                    
                case 'openai':
                    await this.generateWithAPI('openai', text);
                    break;
                    
                case 'google':
                    await this.generateWithAPI('google', text);
                    break;
            }
            
            this.audioSection.style.display = 'block';
            this.downloadBtn.disabled = false;
            
            // Waveform player loading is handled in individual generate methods
            
        } catch (error) {
            console.error('Generation failed:', error);
            this.showStatus(`Failed to generate speech: ${error.message}`, 'error');
        } finally {
            this.isGenerating = false;
            this.generateBtn.disabled = false;
            this.stopBtn.style.display = 'none';
            this.updateGenerateButtonState();
        }
    }

    async generateKokoro(text) {
        if (!this.kokoroTTS) {
            throw new Error('Kokoro TTS not initialized');
        }
        
        try {
            const voice = this.voiceSelect.value || 'af_aoede';
            console.log('Generating with Kokoro voice:', voice);
            
            // Create a text splitter stream
            const streamer = new TextSplitterStream();
            streamer.push(text);
            streamer.close();
            
            // Use streaming for better compatibility
            const chunks = [];
            const stream = this.kokoroTTS.stream(streamer, {
                voice: voice,
                speed: parseFloat(this.speedSlider.value),
                streamAudio: false // Get complete audio chunks
            });
            
            // Collect all audio chunks
            for await (const { audio } of stream) {
                if (audio) {
                    console.log('Got audio chunk:', audio);
                    chunks.push(audio);
                }
            }
            
            if (chunks.length > 0) {
                // Use the first chunk's toBlob method if available
                if (chunks[0].toBlob) {
                    this.audioBlob = chunks[0].toBlob();
                } else if (chunks[0] instanceof Blob) {
                    this.audioBlob = chunks[0];
                } else if (chunks[0] instanceof ArrayBuffer || chunks[0].buffer) {
                    // Convert ArrayBuffer to Blob
                    const buffer = chunks[0].buffer || chunks[0];
                    this.audioBlob = new Blob([buffer], { type: 'audio/wav' });
                } else {
                    console.error('Unknown audio format:', chunks[0]);
                    throw new Error('Unknown audio format from Kokoro');
                }
                
                // DO NOT use the audio element AT ALL - use waveform player only
                
                // Make sure audio section is visible
                this.audioSection.style.display = 'block';
                
                // Load into waveform player ONLY - no fallback to audio element
                if (this.waveformPlayer && this.audioBlob) {
                    console.log('Loading audio into waveform player...');
                    await this.waveformPlayer.loadAudio(this.audioBlob);
                    console.log('Audio loaded, auto-playing...');
                    // Auto-play the waveform player
                    this.waveformPlayer.play();
                } else {
                    throw new Error('Waveform player not available');
                }
            } else {
                throw new Error('No audio generated');
            }
        } catch (error) {
            console.error('Kokoro generation error:', error);
            throw error;
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
            
            utterance.onend = () => resolve();
            utterance.onerror = (error) => reject(error);
            
            window.speechSynthesis.speak(utterance);
        });
    }

    async generateWithTTSLib(engine, text) {
        if (!window.TTS) {
            throw new Error('TTS library not loaded');
        }
        
        // Configure TTS.js
        window.TTS.TTSProvider = engine;
        window.TTS.rate = parseFloat(this.speedSlider.value);
        window.TTS.pitch = parseFloat(this.pitchSlider.value);
        
        if (engine === 'piper') {
            this.showInlineProgress('Initializing Piper TTS...');
            window.TTS.piperVoice = this.voiceSelect.value;
            await window.TTS.initPiper();
            this.showInlineProgress('Generating speech with Piper...');
        } else if (engine === 'espeak') {
            this.showInlineProgress('Initializing eSpeak TTS...');
            window.TTS.espeakSettings.voice = this.voiceSelect.value;
            await window.TTS.initEspeak();
            this.showInlineProgress('Generating speech with eSpeak...');
        } else if (engine === 'kitten') {
            this.showInlineProgress('Initializing Kitten TTS (this may take a moment)...');
            await window.TTS.initKitten();
            this.showInlineProgress('Generating speech with Kitten TTS...');
            
            // Give UI time to update before intensive generation
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        // Generate speech
        window.TTS.speak(text, true);
        
        // For Kitten TTS, we need to wait for audio and load it into waveform
        if (engine === 'kitten') {
            // Wait for audio to be generated
            let attempts = 0;
            const maxAttempts = 60; // 30 seconds max wait
            
            // Keep showing progress message
            const progressInterval = setInterval(() => {
                attempts++;
                const dots = '.'.repeat((attempts % 4) + 1);
                this.showInlineProgress(`Generating speech with Kitten TTS${dots}`);
            }, 500);
            
            // Wait a reasonable time for Kitten TTS to generate
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Clear progress
            clearInterval(progressInterval);
            this.hideInlineProgress();
            
            // Check if audio was generated
            if (window.TTS.audio && window.TTS.audio.src) {
                try {
                    // Fetch the audio blob from the audio element src
                    const response = await fetch(window.TTS.audio.src);
                    const blob = await response.blob();
                    
                    // Store blob for download
                    this.audioBlob = blob;
                    
                    // Load into waveform player
                    if (this.waveformPlayer) {
                        await this.waveformPlayer.loadAudio(blob);
                        // Don't auto-play - let user click play
                    }
                    
                    // Show audio section
                    this.audioSection.style.display = 'block';
                } catch (err) {
                    console.error('Error loading Kitten TTS audio into waveform:', err);
                    this.showStatus('Failed to load audio into player', 'error');
                }
            } else {
                this.showStatus('Kitten TTS generation failed', 'error');
            }
        } else if (engine === 'piper' || engine === 'espeak') {
            // Handle Piper and eSpeak audio similarly
            this.hideInlineProgress();
            
            // Wait a bit for audio to be generated
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            if (window.TTS.audio && window.TTS.audio.src) {
                try {
                    const response = await fetch(window.TTS.audio.src);
                    const blob = await response.blob();
                    this.audioBlob = blob;
                    
                    if (this.waveformPlayer) {
                        await this.waveformPlayer.loadAudio(blob);
                        this.waveformPlayer.play();
                    }
                    
                    this.audioSection.style.display = 'block';
                } catch (err) {
                    console.error(`Error loading ${engine} audio into waveform:`, err);
                }
            }
        } else {
            this.hideInlineProgress();
        }
    }

    async generateWithAPI(engine, text) {
        const apiKey = this.apiKeyInput.value;
        
        if (!apiKey) {
            throw new Error(`API key required for ${engine}`);
        }
        
        if (!window.TTS) {
            throw new Error('TTS library not loaded');
        }
        
        // Configure TTS.js with API settings
        window.TTS.TTSProvider = engine;
        
        if (engine === 'elevenlabs') {
            window.TTS.ElevenLabsKey = apiKey;
            window.TTS.elevenLabsSettings.voiceName = this.voiceSelect.value;
            window.TTS.elevenLabsSettings.speakingRate = parseFloat(this.speedSlider.value);
            window.TTS.elevenLabsSettings.stability = parseFloat(this.stabilitySlider.value);
            window.TTS.elevenLabsSettings.similarity = parseFloat(this.similaritySlider.value);
            
            // Use selected model if available
            const modelSelect = document.getElementById('elevenlabsModel');
            if (modelSelect) {
                window.TTS.elevenLabsSettings.model = modelSelect.value;
                // Save selection
                localStorage.setItem('tts_elevenlabs_model', modelSelect.value);
            }
            
            window.TTS.ElevenLabsTTS(text);
            
        } else if (engine === 'openai') {
            window.TTS.OpenAIAPIKey = apiKey;
            window.TTS.openAISettings.voice = this.voiceSelect.value;
            window.TTS.openAISettings.speed = parseFloat(this.speedSlider.value);
            
            // Use selected model if available
            const modelSelect = document.getElementById('openaiModel');
            if (modelSelect) {
                window.TTS.openAISettings.model = modelSelect.value;
                // Save selection
                localStorage.setItem('tts_openai_model', modelSelect.value);
            }
            
            window.TTS.openAITTS(text);
            
        } else if (engine === 'google') {
            window.TTS.GoogleAPIKey = apiKey;
            window.TTS.googleSettings.voiceName = this.voiceSelect.value;
            window.TTS.googleSettings.rate = parseFloat(this.speedSlider.value);
            window.TTS.googleSettings.pitch = parseFloat(this.pitchSlider.value) - 1;
            window.TTS.googleSettings.lang = this.languageSelect.value;
            window.TTS.googleTTS(text);
        }
    }

    stopGeneration() {
        this.isGenerating = false;
        
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        
        if (this.audioPlayer) {
            this.audioPlayer.pause();
            this.audioPlayer.currentTime = 0;
        }
        
        this.generateBtn.disabled = false;
        this.stopBtn.style.display = 'none';
    }

    downloadAudio() {
        if (this.audioBlob) {
            const url = URL.createObjectURL(this.audioBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tts_${Date.now()}.wav`;
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

    saveAPIKey() {
        const engine = this.engineSelect.value;
        const key = this.apiKeyInput.value;
        
        if (key) {
            localStorage.setItem(`tts_${engine}_key`, key);
            this.showStatus('API key saved', 'success');
        } else {
            localStorage.removeItem(`tts_${engine}_key`);
        }
        
        this.updateGenerateButtonState();
    }

    saveSettings() {
        const settings = {
            engine: this.engineSelect.value,
            voice: this.voiceSelect.value,
            language: this.languageSelect.value,
            speed: this.speedSlider.value,
            pitch: this.pitchSlider.value,
            stability: this.stabilitySlider.value,
            similarity: this.similaritySlider.value,
            text: this.textInput.value
        };
        
        localStorage.setItem('tts_settings', JSON.stringify(settings));
    }

    loadSettings() {
        const saved = localStorage.getItem('tts_settings');
        return saved ? JSON.parse(saved) : {};
    }

    restoreState() {
        // Restore saved engine or default to kokoro
        if (this.settings.engine) {
            this.engineSelect.value = this.settings.engine;
        } else {
            this.engineSelect.value = 'kokoro';
        }
        this.onEngineChange();
        
        if (this.settings.voice) {
            setTimeout(() => {
                this.voiceSelect.value = this.settings.voice;
            }, 500);
        }
        
        if (this.settings.language) {
            this.languageSelect.value = this.settings.language;
        }
        
        if (this.settings.speed) {
            this.speedSlider.value = this.settings.speed;
            this.speedValue.textContent = this.settings.speed + 'x';
        }
        
        if (this.settings.pitch) {
            this.pitchSlider.value = this.settings.pitch;
            this.pitchValue.textContent = this.settings.pitch;
        }
        
        if (this.settings.stability) {
            this.stabilitySlider.value = this.settings.stability;
            this.stabilityValue.textContent = this.settings.stability;
        }
        
        if (this.settings.similarity) {
            this.similaritySlider.value = this.settings.similarity;
            this.similarityValue.textContent = this.settings.similarity;
        }
        
        if (this.settings.text) {
            this.textInput.value = this.settings.text;
            this.updateCharCount();
        }
    }

    showStatus(message, type = 'info') {
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message ${type}`;
        this.statusMessage.style.display = 'block';
        
        setTimeout(() => {
            this.statusMessage.style.display = 'none';
        }, 5000);
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

    async getCachedModel(modelKey) {
        if (!this.cacheManager) {
            console.warn('Cache manager not initialized');
            return null;
        }
        return await this.cacheManager.getModel(modelKey);
    }

    async downloadAndCacheModel() {
        try {
            const modelUrl = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx';
            const response = await fetch(modelUrl);
            
            if (!response.ok) {
                throw new Error(`Failed to download model: ${response.status}`);
            }
            
            const total = +response.headers.get('Content-Length');
            let loaded = 0;
            
            const reader = response.body.getReader();
            const chunks = [];
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                chunks.push(value);
                loaded += value.length;
                
                const percent = (loaded / total) * 100;
                this.setButtonProgress(percent);
                this.generateBtn.innerHTML = `<span>Downloading: ${percent.toFixed(0)}%</span>`;
                this.showInlineProgress(`Downloading model: ${percent.toFixed(1)}%`);
            }
            
            const modelBlob = new Blob(chunks);
            const modelData = new Uint8Array(await modelBlob.arrayBuffer());
            
            console.log('Model downloaded, size:', modelData.length);
            
            // Cache the model
            await this.cacheModel('kokoro-82M', modelData);
            
            this.setButtonProgress(100);
            return modelData;
        } catch (error) {
            console.error('Error downloading model:', error);
            this.setButtonProgress(0);
            throw error;
        }
    }

    async cacheModel(modelKey, modelData) {
        if (!this.cacheManager) {
            console.warn('Cache manager not initialized');
            return;
        }
        const metadata = {
            engine: 'kokoro',
            version: '82M-v1.0',
            downloadDate: Date.now()
        };
        await this.cacheManager.saveModel(modelKey, modelData, metadata);
    }

    async openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('ttsRocksDB', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('models')) {
                    db.createObjectStore('models');
                }
            };
        });
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new TTSApp();
});