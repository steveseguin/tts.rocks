// Enhanced TTS application with multiple engines and Chrome AI integration
import { KokoroTTS, TextSplitterStream, detectWebGPU } from './dist/lib/kokoro-bundle.es.js';

class TTSApp {
    constructor() {
        this.currentEngine = 'browser'; // Start with browser by default
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
        this.settings = this.loadSettings();
        this.chromeAI = {
            summarizer: null,
            translator: null,
            detector: null,
            writer: null
        };
        this.waveformPlayer = null;
        
        this.initializeElements();
        this.attachEventListeners();
        this.initializeWaveformPlayer();
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
            this.waveformPlayer = new window.WaveformPlayer(this.waveformContainer);
        }
    }

    initializeBrowserTTS() {
        // Initialize browser TTS voices
        this.loadBrowserVoices();
        
        // Set up TTS.js integration if available
        if (window.TTS) {
            window.TTS.initAudioContext();
        }
    }

    async initializeKokoro() {
        if (this.kokoroTTS || this.isInitializing) {
            return; // Already initialized or initializing
        }
        
        this.isInitializing = true;
        this.showInlineProgress('Initializing Kokoro TTS...');
        
        try {
            const device = (await detectWebGPU()) ? "webgpu" : "wasm";
            console.log('Using device:', device);
            
            let modelData = await this.getCachedModel('kokoro-82M');
            
            if (!modelData) {
                console.log('Model not cached, downloading...');
                this.showInlineProgress('Downloading Kokoro model (82MB)...');
                modelData = await this.downloadAndCacheModel();
            } else {
                console.log('Using cached model');
                this.showInlineProgress('Loading cached model...');
            }
            
            // Use a simpler initialization approach
            this.kokoroTTS = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
                dtype: "q8", // Use quantized model for better compatibility
                device: "wasm", // Force WASM for now to avoid WebGPU issues
                model_file: modelData,
                load_fn: async () => modelData
            });
            
            console.log('Kokoro TTS initialized successfully');
            this.engineInitStatus.kokoro = true;
            this.hideInlineProgress();
            this.populateKokoroVoices();
            this.updateGenerateButtonState();
            
        } catch (error) {
            console.error('Failed to initialize Kokoro:', error);
            this.showStatus('Failed to initialize Kokoro TTS: ' + error.message, 'error');
            this.hideInlineProgress();
            this.isInitializing = false;
            this.updateGenerateButtonState();
        }
        
        this.isInitializing = false;
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
        
        this.updateGenerateButtonState();
        this.saveSettings();
    }

    updateGenerateButtonState() {
        const engine = this.currentEngine;
        
        // Check if engine is ready
        let isReady = true;
        let buttonText = 'Generate Speech';
        
        if (engine === 'kokoro') {
            if (this.isInitializing) {
                isReady = false;
                buttonText = 'Loading Model...';
            } else if (!this.kokoroTTS) {
                buttonText = 'Generate Speech (will download model)';
            }
        } else if (['elevenlabs', 'openai', 'google'].includes(engine)) {
            const savedKey = localStorage.getItem(`tts_${engine}_key`);
            if (!savedKey && !this.apiKeyInput.value) {
                buttonText = 'Generate Speech (API key required)';
            }
        }
        
        this.generateBtn.textContent = buttonText;
        this.generateBtn.disabled = this.isInitializing;
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
        this.voiceSelect.innerHTML = `
            <option value="21m00Tcm4TlvDq8ikWAM">Rachel</option>
            <option value="AZnzlk1XvdvUeBnXmlld">Domi</option>
            <option value="EXAVITQu4vr4xnSDxMaL">Bella</option>
            <option value="ErXwobaYiN019PkySvjV">Antoni</option>
            <option value="MF3mGyEYCl7XYWbV9V6O">Elli</option>
            <option value="TxGEqnHWrfWFTfGW9XjX">Josh</option>
            <option value="VR6AewLTigWG4xSOukaG">Arnold</option>
            <option value="pNInz6obpgDQGcFmaJgB">Adam</option>
            <option value="yoZ06aMxZJJ28mfd3POQ">Sam</option>
        `;
    }

    populateOpenAIVoices() {
        this.voiceSelect.innerHTML = `
            <option value="alloy">Alloy</option>
            <option value="echo">Echo</option>
            <option value="fable">Fable</option>
            <option value="onyx">Onyx</option>
            <option value="nova">Nova</option>
            <option value="shimmer">Shimmer</option>
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
                { value: 'en-US-Wavenet-A', text: 'WaveNet A (Female)' },
                { value: 'en-US-Wavenet-B', text: 'WaveNet B (Male)' }
            ],
            'es': [
                { value: 'es-ES-Standard-A', text: 'Standard A (Female)' },
                { value: 'es-ES-Standard-B', text: 'Standard B (Male)' }
            ]
        };
        
        const voices = voiceMap[langPrefix] || voiceMap['en'];
        this.voiceSelect.innerHTML = '';
        
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.value;
            option.textContent = voice.text;
            this.voiceSelect.appendChild(option);
        });
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
        if (this.isGenerating || this.isInitializing) return;
        
        const text = this.textInput.value.trim() || "This is a test of the text-to-speech system.";
        
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
                    if (!this.kokoroTTS) {
                        await this.initializeKokoro();
                    }
                    await this.generateKokoro(text);
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
            
            // Load audio into waveform player if available
            if (this.waveformPlayer && this.audioBlob) {
                await this.waveformPlayer.loadAudio(this.audioBlob);
            }
            
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
                
                this.audioPlayer.src = URL.createObjectURL(this.audioBlob);
                this.audioPlayer.style.display = 'block';
                await this.audioPlayer.play();
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
            window.TTS.piperVoice = this.voiceSelect.value;
            await window.TTS.initPiper();
        } else if (engine === 'espeak') {
            window.TTS.espeakSettings.voice = this.voiceSelect.value;
            await window.TTS.initEspeak();
        } else if (engine === 'kitten') {
            await window.TTS.initKitten();
        }
        
        // Generate speech
        window.TTS.speak(text, true);
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
            window.TTS.ElevenLabsTTS(text);
            
        } else if (engine === 'openai') {
            window.TTS.OpenAIAPIKey = apiKey;
            window.TTS.openAISettings.voice = this.voiceSelect.value;
            window.TTS.openAISettings.speed = parseFloat(this.speedSlider.value);
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
        // Don't auto-load Kokoro on page load
        if (this.settings.engine && this.settings.engine !== 'kokoro') {
            this.engineSelect.value = this.settings.engine;
            this.onEngineChange();
        } else {
            // Default to browser TTS
            this.engineSelect.value = 'browser';
            this.onEngineChange();
        }
        
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
        try {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction('models', 'readonly');
                const store = transaction.objectStore('models');
                const request = store.get(modelKey);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
            });
        } catch (error) {
            console.error('Error getting cached model:', error);
            return null;
        }
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
                this.showInlineProgress(`Downloading model: ${percent.toFixed(1)}%`);
            }
            
            const modelBlob = new Blob(chunks);
            const modelData = new Uint8Array(await modelBlob.arrayBuffer());
            
            console.log('Model downloaded, size:', modelData.length);
            
            // Cache the model
            await this.cacheModel('kokoro-82M', modelData);
            
            return modelData;
        } catch (error) {
            console.error('Error downloading model:', error);
            throw error;
        }
    }

    async cacheModel(modelKey, modelData) {
        try {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction('models', 'readwrite');
                const store = transaction.objectStore('models');
                const request = store.put(modelData, modelKey);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve();
            });
        } catch (error) {
            console.error('Error caching model:', error);
        }
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