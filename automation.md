# Generate narration with TTS.Rocks

Use [TTS.Rocks](https://tts.rocks/) to create and download narration for videos, tutorials and other projects. Open **Use with an AI assistant** to copy Markdown instructions, your selected settings, JavaScript, or CLI instructions into a coding agent. Enable **Include my script** when you also want to copy the text. Keys and uploaded recordings are excluded.

Choose whichever route your tools support: labelled browser controls, functions inside the browser page, or the command-line helper. Local engines download models into the browser cache on first use; no Python or native TTS installation is required. Keep the browser profile to reuse downloads. This is browser computation, not a hosted HTTP speech API: fetching HTML alone cannot generate audio.

## Use browser controls

1. Open the site in a browser and fill the textbox named **Text Input** (`#textInput`).
2. Open the **Engine** tab and choose **TTS Engine** (`#engineSelect`). Open **Voice** to choose **Voice** and **Language**. Open **Advanced** to set **Speed** and compute preferences.
3. Click **Generate Speech** (`#generateBtn`). Its accessible name remains stable during progress updates.
4. Wait for **Download Audio** (`#downloadBtn`) to become enabled, then click it and save the download before closing the browser. Read `#statusMessage` for errors; do not assume a timeout means success.

This route supports all studio engines. **Browser Native** speaks but cannot export audio. Cloud providers require your own key. Select reference audio separately for cloning; copied instructions do not transfer that file. The ordinary studio playback and download controls still work independently of automation recordings.

## Call functions inside the page

`window.ttsRocks` is the public browser API, version `1.1`. It supports **kokoro**, **kitten-v08**, **supertonic**, and **chatterbox**. Calls run inside the loaded TTS.Rocks page, such as through `page.evaluate()` in Playwright. They do not run directly in a Node shell. Generation uses the same worker as the studio and does not play audio or change your saved voice settings.

```js
await ttsRocks.ready();
ttsRocks.capabilities();
await ttsRocks.listVoices({ engine: 'kokoro' });
const result = await ttsRocks.generate({
  text: 'Welcome to this tutorial.',
  engine: 'kokoro',
  voice: 'af_aoede',
  speed: 1
});
ttsRocks.download(result.id, 'narration.wav');
ttsRocks.download(result.id, 'narration.vtt', 'vtt');
ttsRocks.download(result.id, 'narration.json', 'json');
```

| Function | Result |
| --- | --- |
| `ready()` | Promise resolving to API version and guide URL after studio initialization |
| `capabilities()` | Supported engines, options, defaults, output formats and limits |
| `listVoices({engine})` | Promise resolving to voice IDs and descriptive metadata; no model download |
| `generate(options)` | Promise resolving to recording metadata after the complete WAV is ready |
| `status()` | State, message, optional progress, error code or completed recording ID |
| `result(id)` | Metadata for the retained recording |
| `audio(id)` | WAV Blob for the retained recording; use in-page or transfer bytes to your tool |
| `download(id, filename, format)` | Starts a browser download; format is `wav` (default), `vtt` or `json` |
| `release(id)` | Releases the retained audio and metadata |
| `cancel()` | Stops an active API recording; its generation promise rejects |

Only the last successful automation recording is retained. Save it before generating another, releasing it, navigating away, or closing the page. A failed request leaves the previous recording accessible under its original ID. The studio Stop button also cancels automation. Simultaneous generation/model operations fail with `BUSY`; process sections sequentially.

Errors reject promises with an Error containing `code` and `message`. Codes include `INVALID_OPTIONS`, `INVALID_TEXT`, `INVALID_VOICE`, `UNSUPPORTED_ENGINE`, `VOICES_UNAVAILABLE`, `BUSY`, `CANCELLED`, `GENERATION_FAILED`, `RESULT_UNAVAILABLE` and `INVALID_FORMAT`. There is no silent fallback to a different voice. `status().state` is `idle`, `loading`, `generating`, `complete`, `cancelled` or `error`. Invalid requests that reach generation update the status; a rejected concurrent request does not replace the active request's status.

Listen to `window` events named `ttsrocks:status` or poll `status()` for progress. Completion is determined by the generation promise, not by a percentage. The panel displays the same state at `#agentStatus`, including a `data-state` attribute.

### Generation options

Unknown options and invalid values are rejected. Supply text or speaker turns, not both. Defaults are independent of saved studio settings; copied setup instructions carry your current settings explicitly.

| Option | Values / default |
| --- | --- |
| `text` | Nonempty text, up to 5000 characters |
| `engine` | `kokoro` (default), `kitten-v08`, `supertonic`, `chatterbox` |
| `voice` | ID from `listVoices`; defaults to `af_aoede`, `Bella`, `F1`, or `default`, respectively |
| `language` | `en-US` by default; Kokoro, Kitten and Chatterbox are English; Supertonic supports languages listed by `listVoices` |
| `speed` | Number from 0.5 to 2; default 1; Chatterbox requires 1 |
| `device` | `wasm` (CPU, default), `auto`, `webgpu`; Kitten always uses CPU |
| `quality` | Kokoro `q8` (default), `auto`, `fp32`, `fp16`; FP16 requires compatible WebGPU |
| `model` | Kitten `nano` (default), `micro`, `mini` |
| `steps` | Supertonic integer from 1 to 10; default 5 |
| `pauseMs` | Added gap between text chunks, 0 to 5000; default 0 |
| `chunkSize` | Integer from 60 to 240 characters; default 240; Chatterbox caps chunks at 180 |
| `powerPreference` | `default`, `low-power`, `high-performance` |
| `turns` | Kokoro, Kitten and Supertonic: up to 100 objects `{speaker: "A", text: "Hello.", voice: "af_aoede"}`; speaker is A or B; combined text limit is 5000 characters |
| `turnPauseMs` | Gap between speaker turns, 0 to 5000; default 300 |
| `exaggeration` | Chatterbox expression, 0 to 1.5; default 0.5 |
| `referenceAudio` | Chatterbox only: an in-page audio Blob or File, under 20 MB and 3–30 seconds; the first 10 seconds are used |

Kokoro's voice list includes eight presets with `blend` metadata identifying the two voices mixed equally. For example, use `voice: 'af_heart_bella'`. Model and voice assets are Apache-2.0.

Chatterbox uses an MIT model and default voice, with approximately 1.5 GB of downloads. Use a desktop; preparation and CPU synthesis can take several minutes. Choose `device: 'webgpu'` on compatible hardware. It supports single-voice narration, with chunk timing captions. A speech-token limit error means the recording is incomplete; reduce `chunkSize` and retry.

To clone a voice through Playwright, select a local file and pass the File inside the page:

```js
await page.locator('#referenceAudio').setInputFiles('my-voice.wav');
const result = await page.evaluate(() => ttsRocks.generate({
  engine: 'chatterbox', device: 'webgpu', voice: 'reference',
  text: 'Welcome to this tutorial.', exaggeration: 0.5,
  referenceAudio: document.getElementById('referenceAudio').files[0]
}));
```

Use your own voice or one you have permission to use. The recording is decoded locally and is never uploaded. `voice: 'reference'` requires the file; omit both voice and referenceAudio to use Chatterbox's default voice. Copied instructions exclude recordings, so select the file again in the agent's browser or pass `--reference` to the CLI.

Results contain `id`, `engine`, `voice` (default voice for the request), `language`, `duration` in seconds, `sampleRate`, `channels`, `format`, `bytes`, actual `device` and model `quality`, and `cues`. Cue starts and ends use generated audio sample positions, including added gaps. Narration cues follow generated text chunks; dialogue cues follow speaker turns. They are not word alignment or speech-recognition validation. Use a separate alignment tool when your video requires word-level highlighting.

### Save files with Playwright

```js
await page.goto('https://tts.rocks/');
await page.waitForFunction(() => window.ttsRocks);
await page.evaluate(() => ttsRocks.ready());
const result = await page.evaluate(() => ttsRocks.generate({
  text: 'Welcome to this tutorial.', voice: 'af_aoede'
}));
const pending = page.waitForEvent('download');
await page.evaluate(id => ttsRocks.download(id, 'narration.wav'), result.id);
const download = await pending;
await download.saveAs('deliverables/narration.wav');
```

Use a context with downloads enabled. Start waiting for the download before triggering it. Save the file before closing the context. Blob URLs belong to the page session and cannot be fetched by another machine. Browser tools without JavaScript evaluation can use the labelled controls instead.

## Use the CLI helper

Download [tts-rocks.mjs](./tts-rocks.mjs) into your working folder. With Node.js 22 or later, install browser automation once in that folder:

```sh
npm install --no-save playwright
npx playwright install chromium
node tts-rocks.mjs --input narration.txt --voice af_aoede --output narration.wav
```

For expressive narration with your reference voice:

```sh
node tts-rocks.mjs --input narration.txt --engine chatterbox --device webgpu --reference my-voice.wav --exaggeration 0.5 --output narration.wav
```

Omit `--reference` for the default Chatterbox voice. Use `--device wasm` for CPU and increase `--timeout` for long recordings or slower machines. Chatterbox GPU requests use Chromium's full headless browser. A batch shares the reference selected with `--reference`.

The helper opens the website in headless Chromium, caches models in `~/.cache/tts-rocks/browser`, and saves WAV audio, VTT captions and JSON metadata beside the requested output. Use `--profile PATH` for another dedicated profile; do not use your daily browser profile or run two helpers with the same profile at once. Models are still loaded into memory at browser startup. CPU is the default for compatibility; use `--device auto` to allow available GPU acceleration.

Use `--voices --engine kokoro` to list voice IDs. Use `--request request.json --output narration.wav` with a JSON generation-options object for controls beyond the basic flags. Use `--site https://your-host/` for a self-hosted copy. Run `--help` for all flags. Progress goes to stderr and successful results to stdout as JSON. Errors exit nonzero. Existing output files are protected unless you supply `--force`.

### Generate named sections

Save this as `sections.json`:

```json
[
  { "id": "intro", "text": "Welcome to this tutorial.", "voice": "af_aoede" },
  { "id": "step-01", "text": "First, open the settings panel.", "voice": "af_aoede" }
]
```

```sh
node tts-rocks.mjs --batch sections.json --output-dir audio
```

Each section produces its own WAV, VTT and JSON. `manifest.json` lists the outputs and durations; timestamps in each section start at zero. Each section can use any generation options. CLI flags override corresponding section settings. IDs must be unique portable filenames using letters, digits, hyphens or underscores; avoid `manifest` and Windows device names. Sections run sequentially in one browser, reusing the loaded model when settings match.

To revise one passage, put its generation options in a request file and generate that file alone. Generation stops on failure; already saved sections remain on disk. Review or move those files before restarting a batch, or deliberately use `--force`. Split long scripts at paragraph boundaries; each section must fit the 5000-character limit.

## Troubleshooting

- **Function missing:** wait for `window.ttsRocks` and `ready()` inside the page. Check that your self-hosted copy includes the automation files.
- **First use takes time:** model and runtime downloads precede synthesis. Read the status and allow the CLI's default 15 minutes per recording; adjust `--timeout SECONDS` for slower devices.
- **GPU unavailable:** choose `--device wasm` or `device: "wasm"`; use Kokoro `quality: "q8"` for CPU.
- **Clipboard denied:** the panel shows a selected text box so you can copy manually.
- **Browser launch fails:** install Chromium with `npx playwright install chromium`. On Linux, Playwright may also require browser system dependencies.
- **Need a cloud voice or cloning:** use the studio controls and provide the key/reference file there. The direct API does not accept secrets or uploaded audio.
