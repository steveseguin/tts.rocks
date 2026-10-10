#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const publicFiles = new Set([
    'index.html', 'tts.html', 'caption-bridge.html', 'manual-sender.html', 'overlay.html',
    'tts.js', 'main-enhanced-v2.js', 'automation.js', 'audio-mix.js', 'audio-utils.js', 'studio-library.js',
    'chatterbox-worker.js', 'dialogue.js', 'document-import.js', 'document-studio.js',
    'model-assets.js', 'model-cache-manager.js', 'neural-client.js', 'neural-worker.js',
    'reference-audio.js', 'stream-player.js', 'text-assistant.js', 'text-worker.js',
    'waveform-player.js', 'logo.png', 'logo_dark.png', 'automation.md', 'llms.txt',
    'tts-rocks.mjs', 'local-server.mjs', 'robots.txt', 'sitemap.xml'
]);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
    '.css': 'text/css', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.xml': 'application/xml' };

export async function startLocalServer(port = 8844) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1 to 65535.');
    try { await access(resolve(root, 'index.html')); await access(resolve(root, 'thirdparty/neural/runtime.js')); }
    catch (_) { throw new Error('Local mode needs the complete repository. Clone or extract the source ZIP, then run the helper from that copy.'); }
    const base = await realpath(root);
    const server = createServer(async (req, res) => {
        if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
            res.writeHead(403).end(); return;
        }
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
        try {
            const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1) || 'index.html';
            const parts = path.split('/');
            if (parts.some(part => !part || part.startsWith('.') || /[\\:\x00-\x1f]/.test(part)) ||
                !(publicFiles.has(path) || ['thirdparty', 'dist', 'voice-samples'].includes(parts[0]))) {
                res.writeHead(404).end(); return;
            }
            const file = await realpath(resolve(base, ...parts));
            const fromRoot = relative(base, file);
            if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith('..' + sep)) { res.writeHead(404).end(); return; }
            const info = await stat(file);
            if (!info.isFile()) { res.writeHead(404).end(); return; }
            res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream',
                'Content-Length': info.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
            if (req.method === 'HEAD') { res.end(); return; }
            const stream = createReadStream(file);
            stream.on('error', () => res.destroy());
            res.on('close', () => stream.destroy());
            stream.pipe(res);
        } catch (error) { res.writeHead(error instanceof URIError ? 400 : 404).end(); }
    });
    await new Promise((accept, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', accept);
    }).catch(error => {
        if (error.code === 'EADDRINUSE') throw new Error(`Local port ${port} is busy. Use --port with another port, or --site http://127.0.0.1:${port}/ if you already started your own copy.`);
        throw error;
    });
    return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((accept, reject) => {
        server.close(error => error ? reject(error) : accept());
        server.closeAllConnections();
    }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const args = process.argv.slice(2);
        if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('Usage: node local-server.mjs [--port 8844]');
        const server = await startLocalServer(args.length ? Number(args[1]) : 8844);
        console.log(`TTS.Rocks: ${server.url} (Ctrl+C to stop)`);
        for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
