import { cp } from 'node:fs/promises';
import { resolve } from 'node:path';

// The embeddable library and its assets also work without a bundler.
let outputDirectory;
export default {
    base: './',
    publicDir: false,
    build: { outDir: 'build' },
    worker: { format: 'es' },
    plugins: [{
        name: 'standalone-tts-assets',
        configResolved(config) { outputDirectory = resolve(config.root, config.build.outDir); },
        async closeBundle() {
            const root = import.meta.dirname;
            for (const path of ['tts.js', 'tts.html', 'waveform-player.js', 'model-cache-manager.js',
                'caption-bridge.html', 'manual-sender.html', 'overlay.html', 'thirdparty', 'dist', 'voice-samples',
                'model-assets.js', 'automation.md', 'llms.txt', 'robots.txt', 'sitemap.xml', 'tts-rocks.mjs', 'logo.png', 'logo_dark.png', 'CNAME']) {
                await cp(resolve(root, path), resolve(outputDirectory, path), { recursive: true });
            }
        }
    }]
};
