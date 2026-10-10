# TTS.Rocks

Turn text into speech in your browser. Choose local AI voices, clone a reference voice locally, or use a cloud provider with your own API key.

**[Open TTS.Rocks](https://tts.rocks/)**

1. Enter text and choose an engine.
2. Open **Voice** to choose a voice and language. Adjust speed and playback timing under **Advanced**.
3. Click **Generate Speech**. Local models download on first use and are cached when browser storage is available.
4. Play, pause, seek, or download the recording.

## Read a document

Choose a PDF, TXT, Markdown, Word (DOCX) or ODT file under **Read a document**. Review the extracted text, select voices, then click **Generate Episode**. Use **Single voice** for narration or **Two narrators (alternate paragraphs)** to share the reading. An existing **A:/B: script** can also use two voices. The document is read as written; edit or summarize it first if you want a shorter discussion.

Files are read locally. Document mode supports up to 100,000 characters and 25 MB per file with Kokoro, Kitten 0.8, Supertonic or Chatterbox; Chatterbox uses one voice. Choose **Use text as document** for longer pasted scripts. For scanned PDFs, run OCR first; for older `.doc` files, export as DOCX or text. Review PDF reading order and any pages reported as missing text.

Download the complete WAV, captions (VTT), or individual sections. **Stop** keeps completed sections in the current tab; **Generate Episode** resumes if the text and voice settings are unchanged. Keep the tab open until downloads are saved. Add music to the exported episode in your audio or video editor.

## Choose an engine

| Engine | Runs in | Best fit |
| --- | --- | --- |
| Kokoro | Browser CPU or WebGPU | 28 US/British English voices plus eight blends; compact Q8 or full-quality FP32 |
| Chatterbox | Browser CPU or WebGPU | Expressive English speech and reference-voice cloning; roughly 1.5 GB download |
| Kitten 0.8 | Browser CPU | Eight English voices; Nano (25 MB), Micro (41 MB), or Mini (80 MB) |
| Supertonic 3 | Browser CPU or WebGPU | Ten voices, 31 languages, adjustable generation steps |
| Pocket TTS | Browser CPU | Built-in voices and local reference-voice cloning; six language bundles |
| MusicGen Small | Browser CPU | Short instrumental clips; non-commercial model, roughly 660 MB download |
| Piper | Browser CPU | Bundled US and British English voice models |
| eSpeak | Browser CPU | Lightweight multilingual synthesized speech |
| Kitten 0.1 | Browser CPU | Original Kitten model and voices |
| Browser Native | Browser/operating system | Immediate speech; no model download or audio export |
| ElevenLabs | Provider API | Flash v2.5, expressive v3/v4, and account voices |
| OpenAI | Provider API | GPT-4o mini TTS with voice directions, TTS-1 and TTS-1 HD |
| Google Cloud | Provider API | Standard, WaveNet, Neural2, Studio and available account voices |

Kokoro's automatic mode uses FP32 on WebGPU and Q8 on CPU. Smaller models reduce downloads but are not necessarily faster on every GPU. Choose **CPU** if GPU initialization fails. Supertonic defaults to CPU in automatic mode. Sizes exclude runtime and voice files.

Kokoro blends combine the two named voices equally: for example, **Heart + Bella blend**. The original voices remain available. Kokoro model and voice assets use Apache-2.0; Chatterbox model and default reference use MIT.

Choose **Chatterbox** for expression controls or to match a reference voice. It needs a desktop with room for the larger model; preparation and CPU generation can take several minutes. Try **WebGPU** for faster generation. Choose Subtle, Natural, Expressive or Dramatic under **Expression**, and adjust playback speed in the player.

Choose **Start playback > As audio arrives** beside Generate to hear the first chunk while the rest is generated. This is selected for new users; saved playback preferences are preserved. Slower devices may pause between chunks. Choose complete-recording playback for uninterrupted listening. The download contains every generated chunk.

The display beside Generate reports the actual CPU or GPU after the model loads and updates generation speed as chunks finish. **2x real time** means ten seconds of audio generated in five seconds. This rate excludes model loading and added pauses; the first-chunk time includes loading. Playback has a short silent lead-in to give the audio output time to start; exported audio and caption timestamps are unchanged.

During early playback, use the live pause/resume and volume controls. Generation continues while playback is paused. To remove a local engine's cached downloads, select it and use **Advanced > Clear downloads for this engine**; it downloads again on next use.

Choose **Mobile / low latency** for Kitten Nano and early playback, or **Quality narration** for Kokoro. **Advanced > Download / prepare model** loads supported models before recording. Keep the tab open to reuse the loaded model. **Check this device** reports WebGPU and FP16 availability; Advanced also offers lower-power and performance GPU preferences. The browser decides which hardware is available.

## Generate narration with an AI assistant

Open **Use with an AI assistant** to copy Markdown instructions, your current voice settings, or JavaScript and CLI examples into your coding agent. Agents can navigate the labelled controls or call `window.ttsRocks` inside the page.

The [CLI helper](tts-rocks.mjs) uses the website through Playwright to save WAV audio, VTT captions and JSON timing metadata, including named batches for video narration. Kokoro, Kitten 0.8, Supertonic and Chatterbox support direct calls. Models stay in the browser cache; no separate TTS engine installation is needed. See the [automation guide](automation.md) for setup and examples.

## Clone a voice locally

Select **Chatterbox** for English expression controls, or **Pocket TTS** for a smaller model with English, French, German, Italian, Portuguese and Spanish bundles. Upload a clear recording of your voice or one you have permission to use. A 5-10 second sample works well; the first 10 seconds are used. Leave the reference empty to use a built-in voice.

The reference is encoded in a browser worker and is not uploaded. The selected recording lasts only for the current page session. Pocket English needs approximately 125 MB of model downloads, plus approximately 21 MB for the cloning encoder. Other language bundles can be larger. Chatterbox downloads approximately 1.5 GB, including its cloning encoder. Use a desktop browser if your device runs out of memory.

The same reference is reused for subsequent recordings. **Clear reference** removes the selected file and releases its encoded voice from memory.

## Make a two-speaker podcast

Choose **Two-speaker podcast** under Text Input and use Kokoro, Kitten 0.8 or Supertonic. Select Speaker A in the main Voice selector and Speaker B in the podcast controls. Write each turn with a label:

```text
A: Welcome to our show. What are we talking about today?
B: How to make a podcast entirely in the browser.
A: Let's get started.
```

Set the pause between speakers, generate, then download the complete WAV and speaker captions (`.vtt`). Captions follow speaker turns rather than individual words. Labels are not spoken.

Expand **Music bed and intro / outro** to add a local track or the last MusicGen clip generated in this page. The music loops with fades and becomes quieter under speech. Music beds use complete-recording playback, and captions include the intro offset. Files remain local and must be selected again after reloading the page.

## Create an instrumental clip

Choose **MusicGen**, describe the instruments, mood and rhythm, and select a 3–15 second clip. Generation runs locally on CPU and can take minutes; use a desktop with room for the model. Download the WAV or select it as a podcast music bed.

MusicGen uses **CC BY-NC 4.0 (non-commercial)** model weights. Review the [model license](https://huggingface.co/Xenova/musicgen-small) before choosing it for a project. For lyric-based songs and larger local music models, see [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5), which runs in a separate native installation.

## Cloud voices and translation

For ElevenLabs, OpenAI or Google Cloud, enter your own API key. Requests go directly from your browser to that provider. Keys are saved in this browser's local storage; do not use a shared browser profile for private keys. Provider charges and account limits apply.

**Load my available voices** retrieves current ElevenLabs or Google voices, including voices available to your account. For GPT-4o mini TTS, add a direction such as "warm, calm narration" in the Voice tab. Older OpenAI models use their own supported voice list.

Voice choices are remembered per engine and language. Loaded account voice lists stay available while switching engines in the same page session.

GPT-4o mini TTS offers warm, calm, upbeat and newsreader direction presets. Edit the direction to suit your script. Local speech engines use their own voice and speed controls.

Eleven v4 accepts up to 2000 characters per recording here. Use the player's speed control for Eleven v3/v4; their synthesis speed controls are unavailable. Choose Flash v2.5 or another existing model for Caption.Ninja links.

On compatible desktop Chrome installations, the text toolbar offers local summarization, language detection, rewriting and translation. Choose the target language in **Voice**, then use **Translate to selected language**. Browser language models may need an initial download. Review edited text before generating speech.

## Run your own copy

No build is required. Serve this folder over HTTPS or localhost:

```sh
git clone https://github.com/steveseguin/tts.rocks.git
cd tts.rocks
python -m http.server 8000
```

Open `http://localhost:8000`. Use a current browser with WebAssembly and Web Workers. WebGPU requires a compatible browser, graphics driver and secure context. Models are fetched from Hugging Face, and the neural WASM runtime from jsDelivr. Local synthesis keeps your text and reference audio on your device.

If your browser cannot preview audio, download the recording and play it in another app. Reference cloning requires a browser that can decode audio locally.

For the optional Vite workflow, use Node.js 22.12 or newer:

```sh
npm install
npm run dev
npm run build
npm run preview
```

The build writes a static site to `build/`, including the standalone TTS library and its assets. Serve the whole output folder.

## Caption.Ninja and embedding

Expand **Use with Caption.Ninja** to create speech-input, manual-input and output links for one room. Kokoro, Piper, eSpeak, legacy Kitten, browser speech and cloud engines can be passed to existing overlays. Kitten 0.8, Supertonic and Pocket are studio options. Generated cloud-provider links include API keys: share them only with trusted recipients.

For a simple browser-speech integration:

```html
<script src="https://tts.rocks/tts.js"></script>
<button onclick="TTS.TTSProvider = 'system'; TTS.speak('Hello from TTS.Rocks', true)">
  Speak
</button>
```

The `tts.js` library and the studio UI are separate entry points. Embed the complete studio with an iframe when you need its model controls, cloning and waveform player.

## More voice model projects

These projects offer native runtimes, hosted demos or community browser ports. Use their linked setup instructions; they are not additional engines in the TTS.Rocks selector.

- [Chatterbox](https://github.com/resemble-ai/chatterbox): Nano, Turbo and multilingual models, cloning and expressive speech. [Community ONNX exports](https://huggingface.co/onnx-community/chatterbox-ONNX) offer a separate browser integration path.
- [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS): multilingual cloning, custom voices and voice design, with native model runtimes.
- [NeuTTS](https://github.com/neuphonic/neutts): Air and Nano cloning models, plus 2E expression controls. Choose the appropriate language, codec and model license.
- [KittenTTS 2](https://github.com/KittenML/KittenTTS): a separate speech-language model with cloning and expression controls. Its native runtime differs from the lightweight Kitten 0.8 ONNX models used here.

## Licenses and support

TTS.Rocks application code is MIT-licensed. Third-party code, model weights and voice assets retain their own licenses. Supertonic 3 weights use BigScience Open RAIL-M; Pocket model/voice assets have separate attribution requirements. See [neural component notices](thirdparty/neural/NOTICE) and each bundled library's license before redistributing assets.

[Report an issue](https://github.com/steveseguin/tts.rocks/issues). Created by [Steve Seguin](https://github.com/steveseguin).
