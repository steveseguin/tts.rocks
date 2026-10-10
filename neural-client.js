export class NeuralClient {
    constructor() {
        this.worker = null;
        this.pending = new Map();
        this.nextId = 0;
    }

    request(type, options, onProgress) {
        const preference = options.powerPreference || 'default';
        const workerKind = options.engine === 'chatterbox' ? `chatterbox:${options.device}` : 'neural';
        if (this.worker && (this.powerPreference !== preference || this.workerKind !== workerKind)) this.cancel();
        this.powerPreference = preference;
        this.workerKind = workerKind;
        if (!this.worker) {
            this.worker = options.engine === 'chatterbox'
                ? new Worker(new URL('./chatterbox-worker.js', import.meta.url), { type: 'module' })
                : new Worker(new URL('./neural-worker.js', import.meta.url), { type: 'module' });
            this.worker.onmessage = ({ data }) => {
                const request = this.pending.get(data.id);
                if (!request) return;
                if (data.type === 'progress') {
                    try {
                        if (request.onProgress) request.onProgress(data);
                    } catch (error) {
                        this.cancel(error);
                    }
                    return;
                }
                this.pending.delete(data.id);
                if (data.error) {
                    request.reject(new Error(data.error));
                    if (this.workerKind.startsWith('chatterbox:')) this.cancel();
                }
                else request.resolve(data.result);
            };
            this.worker.onerror = event => this.cancel(new Error(event.message || 'Speech worker failed to load'));
            this.worker.onmessageerror = () => this.cancel(new Error('Speech worker returned unreadable audio data'));
        }
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, onProgress });
            try {
                this.worker.postMessage({ id, type, options: { ...options, assetBase: new URL('./thirdparty/neural/', document.baseURI).href } });
            } catch (error) {
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    cancel(error = new DOMException('Generation stopped', 'AbortError')) {
        if (this.worker) this.worker.terminate();
        this.worker = null;
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
    }
}
