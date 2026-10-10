import { clearModelCache } from './model-assets.js';

const el = id => document.getElementById(id);
export class TextAssistant {
    constructor(app) {
        this.app = app;
        this.busy = false;
        this.current = { state: 'idle', message: '' };
        this.dialog = el('localTextDialog');
        this.api = Object.freeze({ generate: options => this.generate(options), status: () => ({ ...this.current }), cancel: () => this.cancel() });
        el('localTextBtn').addEventListener('click', () => this.open());
        el('localTextClose').addEventListener('click', () => { this.cancel(); this.dialog.close(); });
        this.dialog.addEventListener('cancel', () => this.cancel());
        el('localTextRun').addEventListener('click', () => this.preview());
        el('localTextApply').addEventListener('click', () => this.apply());
        el('localTextClear').addEventListener('click', async () => {
            if (this.busy) return;
            this.busy = true; this.refresh();
            try { await clearModelCache('text'); this.update('idle', 'Local AI download cleared.'); }
            catch (error) { this.update('error', error.message); }
            finally { this.busy = false; this.refresh(); }
        });
    }

    refresh() {
        this.app.updateGenerateButtonState();
        this.app.documents.refresh();
        for (const id of ['localTextRun', 'localTextAction', 'localTextClear']) el(id).disabled = this.busy;
        el('localTextApply').disabled = this.busy || !this.draftReady;
    }

    update(state, message) {
        this.current = { state, message };
        el('localTextStatus').textContent = message;
        el('localTextStatus').dataset.state = state;
    }

    open() {
        if (this.busy || this.app.documents.busy()) return;
        const input = this.app.textInput;
        this.source = input.value;
        const selected = input.selectionEnd > input.selectionStart;
        this.start = selected ? input.selectionStart : 0;
        this.end = selected ? input.selectionEnd : input.value.length;
        this.draftReady = false;
        el('localTextDraft').value = '';
        el('localTextResult').hidden = true;
        el('localTextScope').textContent = selected ? `Selected text · ${this.end - this.start} characters` : `Whole text · ${this.source.length} characters`;
        this.update('idle', ''); this.refresh(); this.dialog.showModal();
    }

    async preview() {
        this.draftReady = false;
        el('localTextResult').hidden = true;
        this.refresh();
        try {
            const result = await this.generate({ text: this.source.slice(this.start, this.end), action: el('localTextAction').value });
            el('localTextDraft').value = result.text;
            el('localTextResult').hidden = false;
            this.draftReady = true;
            this.refresh();
        } catch (error) { this.update(error.name === 'AbortError' ? 'cancelled' : 'error', error.message); }
    }

    apply() {
        if (!this.draftReady || this.busy) return;
        const app = this.app;
        if (app.documents.busy()) { this.update('error', 'Wait for the current operation to finish.'); return; }
        if (app.textInput.value !== this.source) { this.update('error', 'Your text changed. Close this window and create a new draft.'); return; }
        const draft = el('localTextDraft').value;
        if (!draft.trim()) { this.update('error', 'The draft is empty.'); return; }
        const value = this.source.slice(0, this.start) + draft + this.source.slice(this.end);
        if (value.length > app.textLimit()) { this.update('error', `The result exceeds the ${app.textLimit().toLocaleString()} character limit. Shorten the draft first.`); return; }
        app.textInput.value = value;
        app.textInput.dispatchEvent(new Event('input', { bubbles: true }));
        this.dialog.close();
    }

    async generate(options) {
        const { text, action = 'improve' } = options || {};
        if (typeof text !== 'string' || !text.trim() || text.length > 3000) throw new Error('Select 1–3,000 characters to use Local AI.');
        if (!['improve', 'summarize'].includes(action)) throw new Error('Use action "improve" or "summarize".');
        if (this.busy || this.app.documents.busy()) throw new Error('Wait for the current recording or model operation to finish.');
        this.busy = true;
        this.update('loading', 'Preparing Local AI…'); this.refresh();
        try {
            return await new Promise((resolve, reject) => {
                this.reject = reject;
                this.worker = new Worker(new URL('./text-worker.js', import.meta.url), { type: 'module' });
                this.worker.onmessage = ({ data }) => {
                    if (data.type === 'progress') this.update('working', data.message);
                    else if (data.type === 'result') { this.update('complete', 'Draft ready.'); resolve(data.result); }
                    else if (data.type === 'error') reject(new Error(data.message));
                };
                this.worker.onerror = event => { event.preventDefault(); reject(new Error(event.message || 'Local AI could not start. Reload the page and try again.')); };
                this.worker.postMessage({ text, action });
            });
        } catch (error) {
            this.update(error.name === 'AbortError' ? 'cancelled' : 'error', error.message);
            throw error;
        } finally {
            // Release GPU memory before the next speech recording; downloaded files stay cached.
            this.worker?.terminate(); this.worker = null; this.reject = null;
            this.busy = false; this.refresh();
        }
    }

    cancel() {
        const cancelling = Boolean(this.reject);
        if (cancelling) { this.worker?.terminate(); this.reject(new DOMException('Local AI stopped.', 'AbortError')); }
        return { cancelling };
    }
}
