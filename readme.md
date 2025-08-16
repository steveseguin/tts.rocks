# TTS.Rocks - Advanced Text-to-Speech Web Application

A comprehensive browser-based text-to-speech application featuring multiple AI-powered TTS engines, all running client-side with WebGPU acceleration where available.

🔗 **[Live Demo](https://tts.rocks/)**

## Features

- **Multiple TTS Engines**: Choose from 8 different text-to-speech engines
- **Fully Client-Side**: Most engines run entirely in your browser - no server required
- **WebGPU Acceleration**: Leverages GPU for faster processing when available
- **Visual Waveform Player**: Interactive audio visualization with playback controls
- **Model Caching**: Automatic caching for faster subsequent loads
- **Voice Customization**: Adjust speed, pitch, and other parameters
- **Download Support**: Save generated audio as WAV files

## Available TTS Engines

### 🚀 Local AI Models (Browser-Based)
1. **Kokoro TTS** - High-quality neural TTS with 100+ voices
   - WebGPU/WASM support
   - 82MB model size
   - Multiple languages and accents

2. **Kitten TTS** - Lightweight TTS engine
   - WASM-based (CPU)
   - Compact model size
   - Fast generation

3. **Piper TTS** - Versatile open-source TTS
   - WASM-based (CPU)
   - Multiple voice models
   - Good quality-to-size ratio

4. **eSpeak TTS** - Classic speech synthesizer
   - WASM-based (CPU)
   - Minimal resource usage
   - Supports many languages

### ☁️ API-Based Engines
5. **ElevenLabs** - Premium AI voices
   - Requires API key
   - Multiple models including Turbo v2.5
   - Ultra-realistic voices

6. **OpenAI TTS** - GPT-powered voices
   - Requires API key
   - TTS-1 and TTS-1-HD models
   - High-quality synthesis

7. **Google Cloud TTS** - Enterprise-grade TTS
   - Requires API key
   - WaveNet, Neural2, and Studio voices
   - 200+ voices across 50+ languages

8. **Browser Native** - System TTS
   - No download required
   - Uses OS speech synthesis
   - Platform-dependent voices

## Quick Start

### Using the Hosted Version
Simply visit [https://tts.rocks/](https://tts.rocks/) to start using the application immediately.

### Self-Hosting

1. Clone the repository:
```bash
git clone https://github.com/steveseguin/tts.rocks.git
cd tts.rocks
```

2. Serve the files using any web server:
```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve

# Or any other static file server
```

3. Open `http://localhost:8000` in your browser

## Integration Guide

### Embedding in Your Website

You can integrate the TTS functionality into your own website:

```html
<!DOCTYPE html>
<html>
<head>
    <title>TTS Integration Example</title>
</head>
<body>
    <!-- Include the TTS library -->
    <script src="https://tts.rocks/tts.js"></script>
    
    <!-- Your content -->
    <textarea id="text">Hello, world!</textarea>
    <button onclick="speak()">Speak</button>
    
    <script>
        // Initialize TTS
        window.TTS = window.TTS || {};
        
        // Configure settings
        TTS.TTSProvider = 'kokoro'; // or 'kitten', 'piper', etc.
        TTS.rate = 1.0;  // Speech rate
        TTS.pitch = 1.0; // Voice pitch
        
        async function speak() {
            const text = document.getElementById('text').value;
            
            // For Kokoro TTS (requires initialization)
            if (TTS.TTSProvider === 'kokoro') {
                if (!TTS.kokoroLoaded) {
                    await TTS.initKokoro();
                }
                await TTS.kokoroTTS(text);
            } 
            // For simpler engines
            else {
                TTS.speak(text, true);
            }
        }
    </script>
</body>
</html>
```

### Advanced Integration with Waveform Player

For a complete integration with visual waveform display:

```html
<!-- Include required files -->
<link rel="stylesheet" href="https://tts.rocks/styles.css">
<script src="https://tts.rocks/tts.js"></script>
<script src="https://tts.rocks/waveform-player.js"></script>
<script type="module" src="https://tts.rocks/main-enhanced-v2.js"></script>

<!-- The app will initialize automatically -->
<div id="app"></div>
```

## Project Structure

```
tts.rocks/
├── index.html              # Main application
├── main-enhanced-v2.js     # Application logic
├── tts.js                  # TTS engine implementations
├── waveform-player.js      # Audio visualization
├── model-cache-manager.js  # IndexedDB caching
├── styles.css              # UI styling
├── dist/                   # Kokoro TTS distribution
│   └── lib/               # Kokoro dependencies
└── thirdparty/            # Third-party libraries
    ├── piper/             # Piper TTS files
    ├── espeak/            # eSpeak files
    └── kitten/            # Kitten TTS files
```

## Browser Requirements

- **Recommended**: Chrome/Edge 113+, Firefox 115+, Safari 16+
- **WebGPU Support**: For optimal performance with Kokoro TTS
- **WebAssembly**: Required for all local TTS engines
- **IndexedDB**: For model caching

## License

**My Code**: MIT License - You're free to use, modify, and distribute my code for any purpose.

**Third-Party Libraries**: Each third-party library in the `thirdparty/` folder has its own license:
- Kokoro-JS: Apache 2.0 License
- Piper TTS: MIT License
- eSpeak: GPL v3 License
- Kitten TTS: Check individual license
- Other dependencies: See respective folders for license information

Please ensure you comply with the licenses of any third-party libraries you use.

## Development

### Local Development
```bash
# Install dependencies (if any)
npm install

# Start development server
npx vite

# Build for production
npm run build
```

### Contributing
Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests.

## API Keys

For API-based TTS engines, you'll need to obtain API keys:
- **ElevenLabs**: [Get API key](https://elevenlabs.io/)
- **OpenAI**: [Get API key](https://platform.openai.com/)
- **Google Cloud**: [Get API key](https://cloud.google.com/text-to-speech)

API keys are stored locally in your browser and never sent to our servers.

## Acknowledgments

This project integrates several excellent open-source TTS projects:
- [Kokoro-JS](https://github.com/ddkaao/kokoro-js) by ddkaao
- [Piper](https://github.com/rhasspy/piper) by Rhasspy
- [eSpeak-ng](https://github.com/espeak-ng/espeak-ng)
- And other contributors to the web TTS ecosystem

## Support

For issues, questions, or suggestions:
- Open an issue on [GitHub](https://github.com/steveseguin/tts.rocks/issues)
- Visit the live demo at [tts.rocks](https://tts.rocks/)

---

Made with ❤️ for the web audio community