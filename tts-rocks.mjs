#!/usr/bin/env node
import { readFile, writeFile, mkdir, access, copyFile, constants } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const help = `Generate narration through TTS.Rocks (Node.js 22+, Playwright, Chromium).

One-time setup in the folder containing this helper:
  npm install --no-save playwright
  npx playwright install chromium

Usage:
  node tts-rocks.mjs --input narration.txt --output narration.wav
  node tts-rocks.mjs --request request.json --output narration.wav
  node tts-rocks.mjs --batch sections.json --output-dir audio
  node tts-rocks.mjs --voices --engine kokoro
  node tts-rocks.mjs --local --input narration.txt --output narration.wav

From a cloned or extracted repository: npm run setup:cli
Then use --local to serve that copy automatically, or npm start for browser use.

Options:
  --engine kokoro|kitten-v08|supertonic|chatterbox   Default: kokoro
  --reference PATH                     Local recording for Chatterbox cloning
  --exaggeration NUMBER                Chatterbox expression, 0 to 1.5
  --voice ID                           See --voices
  --speed NUMBER                       0.5 to 2
  --language CODE                      Default: en-US
  --device wasm|auto|webgpu             Default: wasm (CPU)
  --quality q8|auto|fp32|fp16           Kokoro quality; default q8
  --model nano|micro|mini               Kitten size; default nano
  --site URL                           Default: https://tts.rocks/
  --local                              Serve this repository for this job
  --port NUMBER                        Local port; default 8844 (with --local)
  --profile PATH                       Dedicated persistent browser cache
  --timeout SECONDS                    Per recording; default 900
  --force                              Replace existing output files
  --help                               Show this help

Each recording saves WAV, VTT chunk/turn captions and JSON metadata.
Batch JSON: [{"id":"intro","text":"Welcome.","voice":"af_aoede"}, ...]
Request JSON accepts the options documented at https://tts.rocks/automation.md.
Models download into the browser cache; no Python or native TTS installation.
Do not run two helpers with the same browser profile simultaneously.
Progress goes to stderr; stdout is JSON. Failure exits nonzero.
`;

let context;
let localServer;
async function close() {
    try { if (context) await context.close(); }
    finally { if (localServer) await localServer.close(); }
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(signal, () => { void close().finally(() => process.exit(code)); });
}
try {
    const args = {};
    const booleans = ['help', 'voices', 'force', 'local'];
    const values = ['input', 'request', 'batch', 'output', 'output-dir', 'engine', 'voice', 'speed', 'language', 'device', 'quality', 'model', 'site', 'profile', 'timeout', 'reference', 'exaggeration', 'port'];
    for (let index = 2; index < process.argv.length; index++) {
        const arg = process.argv[index];
        if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}. Use --help.`);
        const key = arg.slice(2);
        if (Object.hasOwn(args, key)) throw new Error(`Repeated option: ${arg}`);
        if (booleans.includes(key)) args[key] = true;
        else if (values.includes(key)) {
            const value = process.argv[++index];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
            args[key] = value;
        } else throw new Error(`Unknown option: ${arg}. Use --help.`);
    }
    if (args.help) { console.log(help); process.exit(0); }
    if (args.local && args.site) throw new Error('Choose --local or --site, not both.');
    if (args.port && !args.local) throw new Error('--port requires --local.');
    const port = Number(args.port ?? 8844);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be 1 to 65535.');
    const timeout = Number(args.timeout ?? 900) * 1000;
    if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 86400000) throw new Error('--timeout must be 1 to 86400 seconds.');
    let site = new URL(args.site || 'https://tts.rocks/');
    if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password) throw new Error('--site must be an HTTP(S) website URL without credentials.');
    const overrides = {};
    for (const key of ['engine', 'voice', 'speed', 'language', 'device', 'quality', 'model', 'exaggeration']) if (args[key] !== undefined) overrides[key] = ['speed', 'exaggeration'].includes(key) ? Number(args[key]) : args[key];
    const sources = ['input', 'request', 'batch'].filter(key => args[key]);
    if (args.voices ? sources.length > 0 : sources.length !== 1) throw new Error('Choose exactly one of --input, --request or --batch; or use --voices by itself.');
    if (args.batch && (args.output || !args['output-dir'])) throw new Error('Use --output-dir with --batch (not --output).');
    if (!args.batch && !args.voices && (!args.output || args['output-dir'])) throw new Error('Use --output narration.wav with --input or --request.');
    let jobs = [];
    if (args.input) jobs = [{ options: { text: await readFile(resolve(args.input), 'utf8'), ...overrides }, output: resolve(args.output) }];
    if (args.request) jobs = [{ options: { ...JSON.parse(await readFile(resolve(args.request), 'utf8')), ...overrides }, output: resolve(args.output) }];
    if (args.batch) {
        const sections = JSON.parse(await readFile(resolve(args.batch), 'utf8'));
        if (!Array.isArray(sections) || !sections.length || sections.length > 1000) throw new Error('Batch must contain 1 to 1000 named sections.');
        const ids = new Set();
        jobs = sections.map(section => {
            if (!section || typeof section !== 'object') throw new Error('Each batch section must be an object.');
            const { id, ...options } = section;
            if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id) || ids.has(id.toLowerCase())) throw new Error('Section IDs must be unique portable filenames using letters, digits, hyphens or underscores.');
            ids.add(id.toLowerCase());
            return { id, options: { ...options, ...overrides }, output: resolve(args['output-dir'], id + '.wav') };
        });
    }
    if (args.reference) {
        if (!jobs.length || jobs.some(job => job.options.engine !== 'chatterbox')) throw new Error('--reference requires --engine chatterbox for every recording.');
        await access(resolve(args.reference));
    }
    const files = jobs.flatMap(job => {
        if (!job.output.toLowerCase().endsWith('.wav')) throw new Error('--output must end in .wav.');
        job.base = job.output.slice(0, -4);
        return [job.output, job.base + '.vtt', job.base + '.json'];
    });
    const manifestPath = args.batch ? resolve(args['output-dir'], 'manifest.json') : null;
    if (manifestPath) files.push(manifestPath);
    if (new Set(files.map(file => file.toLowerCase())).size !== files.length) throw new Error('Output filenames overlap. Choose different section IDs.');
    // Check every destination before spending time generating audio.
    if (!args.force) for (const file of files) {
        let exists = false;
        try { await access(file); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (exists) throw new Error(`Output already exists: ${file}. Use --force to replace it.`);
    }
    let playwright;
    try { playwright = createRequire(import.meta.url)('playwright'); }
    catch (_) {
        try { playwright = createRequire(join(process.cwd(), 'package.json'))('playwright'); }
        catch (_) { throw new Error('Install browser automation first: npm install --no-save playwright ; then npx playwright install chromium. No TTS package is needed.'); }
    }
    const needsGPU = jobs.some(job => ['kokoro', 'supertonic', 'chatterbox'].includes(job.options.engine || 'kokoro') && ['auto', 'webgpu'].includes(job.options.device));
    if (args.local) {
        let startLocalServer;
        try { ({ startLocalServer } = await import('./local-server.mjs')); }
        catch (error) {
            if (error.code === 'ERR_MODULE_NOT_FOUND') throw new Error('--local needs the complete repository. Clone or extract the source ZIP; see https://tts.rocks/automation.md.');
            throw error;
        }
        localServer = await startLocalServer(port);
        site = new URL(localServer.url);
        console.error(`Using local repository at ${site.href}`);
    }
    context = await playwright.chromium.launchPersistentContext(resolve(args.profile || join(homedir(), '.cache', 'tts-rocks', 'browser')), { headless: true, acceptDownloads: true, ...(needsGPU ? { channel: 'chromium' } : {}) });
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(60000);
    const response = await page.goto(site.href, { waitUntil: 'domcontentloaded' });
    if (!response?.ok()) throw new Error(`Website returned HTTP ${response?.status() ?? 'unknown'}`);
    await page.waitForFunction(() => window.ttsRocks);
    await page.evaluate(() => ttsRocks.ready());
    if (args.voices) console.log(JSON.stringify(await page.evaluate(engine => ttsRocks.listVoices({ engine }), args.engine || 'kokoro'), null, 2));
    else {
        let previous = '';
        await page.exposeFunction('reportTTSProgress', progress => {
            const message = progress.message;
            if (message !== previous) { console.error(message); previous = message; }
        });
        await page.evaluate(() => window.addEventListener('ttsrocks:status', event => { window.reportTTSProgress(event.detail).catch(() => {}); }));
        const results = [];
        async function download(id, target, format) {
            const pending = page.waitForEvent('download');
            await page.evaluate(({ id, name, format }) => ttsRocks.download(id, name, format), { id, name: basename(target), format });
            const item = await pending;
            const source = await item.path();
            if (!source) throw new Error(await item.failure() || 'Download did not produce a file.');
            await mkdir(dirname(target), { recursive: true });
            await copyFile(source, target, args.force ? 0 : constants.COPYFILE_EXCL);
        }
        if (args.reference) await page.locator('#referenceAudio').setInputFiles(resolve(args.reference));
        for (const job of jobs) {
            console.error(`Generating ${job.id || basename(job.output)}…`);
            const result = await page.evaluate(async ({ options, timeout, reference }) => {
                let timer;
                try {
                    if (reference) options.referenceAudio = document.getElementById('referenceAudio').files[0];
                    return await Promise.race([
                        ttsRocks.generate(options),
                        new Promise((_, reject) => { timer = setTimeout(() => { ttsRocks.cancel(); reject(new Error('Generation timed out. Increase --timeout or use a smaller section.')); }, timeout); })
                    ]);
                } finally { clearTimeout(timer); }
            }, { options: job.options, timeout, reference: Boolean(args.reference) });
            await download(result.id, job.output, 'wav');
            await download(result.id, job.base + '.vtt', 'vtt');
            await download(result.id, job.base + '.json', 'json');
            results.push({ ...result, section: job.id, audio: job.output, captions: job.base + '.vtt', metadata: job.base + '.json' });
            await page.evaluate(id => ttsRocks.release(id), result.id);
        }
        const manifest = { recordings: results, duration: results.reduce((sum, result) => sum + result.duration, 0) };
        if (manifestPath) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: args.force ? 'w' : 'wx' });
        console.log(JSON.stringify(manifest, null, 2));
    }
} catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
} finally {
    await close();
}
