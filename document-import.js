export const DOCUMENT_LIMIT = 100000;
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ODT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';

export function checkedText(text) {
    text = text.replace(/\r\n?/g, '\n').trim();
    if (!text) throw new Error('No readable text found. For scanned pages, run OCR first and export a text file.');
    if (text.length > DOCUMENT_LIMIT) throw new Error('Use a document with at most 100,000 characters, or divide it into smaller files. Nothing was imported.');
    if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw new Error('This file contains binary data. Export it as UTF-8 text, PDF, DOCX or ODT.');
    return text;
}

export async function readDocument(file, signal, progress) {
    if (!(file instanceof File)) throw new Error('Select a document file.');
    if (file.size > 25 * 1024 * 1024) throw new Error('Choose a file smaller than 25 MB.');
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['txt', 'md', 'markdown', 'pdf', 'docx', 'odt'].includes(extension)) throw new Error('Choose PDF, TXT, Markdown, DOCX or ODT. Export older Word files as DOCX or text first.');
    const data = new Uint8Array(await file.arrayBuffer());
    signal.throwIfAborted();
    let text, warning = '';
    if (extension === 'pdf') {
        const url = new URL('./thirdparty/documents/pdf.min.js', document.baseURI);
        const pdfjs = await import(/* @vite-ignore */ url.href);
        signal.throwIfAborted();
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.js', url).href;
        const task = pdfjs.getDocument({ data, cMapUrl: new URL('./cmaps/', url).href, cMapPacked: true, isEvalSupported: false, useSystemFonts: false, disableFontFace: true });
        const abort = () => { void task.destroy(); };
        signal.addEventListener('abort', abort, { once: true });
        try {
            const pdf = await task.promise;
            if (pdf.numPages > 500) throw new Error('Use a PDF with at most 500 pages, or split it into smaller files.');
            const pages = [], empty = [];
            let length = 0;
            for (let number = 1; number <= pdf.numPages; number++) {
                signal.throwIfAborted();
                progress(`Reading PDF page ${number} of ${pdf.numPages}…`);
                const page = await pdf.getPage(number);
                const content = await page.getTextContent();
                const pageText = content.items.map(item => typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
                length += pageText.length + 2;
                if (length > DOCUMENT_LIMIT) throw new Error('Use a document with at most 100,000 characters, or split this PDF into smaller files. Nothing was imported.');
                if (!pageText) empty.push(number);
                pages.push(pageText);
                page.cleanup();
            }
            text = pages.join('\n\n');
            warning = empty.length ? `Pages without selectable text: ${empty.slice(0, 30).join(', ')}${empty.length > 30 ? '…' : ''}. Run OCR on those pages to include them.` : 'Review the reading order, headers and footers before generating.';
        } catch (error) {
            if (error.name === 'PasswordException') throw new Error('This PDF needs a password. Save an unlocked copy, then import it.');
            throw error;
        } finally {
            signal.removeEventListener('abort', abort);
            await task.destroy();
        }
    } else if (extension === 'docx' || extension === 'odt') {
        const { unzipSync, strFromU8 } = await import('./thirdparty/documents/fflate.js');
        signal.throwIfAborted();
        const path = extension === 'docx' ? 'word/document.xml' : 'content.xml';
        let entries, found = false;
        try {
            entries = unzipSync(data, { filter: entry => {
                if (entry.name !== path) return false;
                if (found) throw new Error('The document contains duplicate text entries.');
                found = true;
                if (entry.originalSize > 8 * 1024 * 1024) throw new Error('The document text is too large. Export a shorter text file.');
                return true;
            } });
        } catch (_) { throw new Error('Cannot open this document. Save an unencrypted DOCX or ODT copy, or export it as text.'); }
        if (!entries[path] || entries[path].length > 8 * 1024 * 1024) throw new Error('Document text is missing or too large. Export it as text.');
        const xmlText = strFromU8(entries[path]);
        if (/<!DOCTYPE|<!ENTITY/i.test(xmlText)) throw new Error('Export this document as plain text before importing it.');
        const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
        if (xml.getElementsByTagName('parsererror').length) throw new Error('The document is damaged. Save a new copy or export it as text.');
        const ns = extension === 'docx' ? WORD : ODT;
        const paragraphs = [...xml.getElementsByTagNameNS(ns, '*')].filter(node => ['p', ...(extension === 'odt' ? ['h'] : [])].includes(node.localName));
        function read(node) {
            if (node.nodeType === 3) return extension === 'odt' ? node.nodeValue : '';
            if (node.namespaceURI === WORD) {
                if (['del', 'instrText', 'drawing', 'pict'].includes(node.localName)) return '';
                if (node.localName === 't') return node.textContent;
                if (['br', 'cr', 'tab'].includes(node.localName)) return ' ';
            }
            if (node.namespaceURI === ODT && ['s', 'tab', 'line-break'].includes(node.localName)) return ' ';
            if (['annotation', 'note', 'tracked-changes'].includes(node.localName)) return '';
            return [...node.childNodes].map(read).join('');
        }
        text = paragraphs.filter(node => {
            for (let parent = node.parentElement; parent; parent = parent.parentElement) {
                if (['annotation', 'note', 'tracked-changes', 'del'].includes(parent.localName)) return false;
                if (parent.namespaceURI === ns && ['p', 'h'].includes(parent.localName)) return false;
            }
            return true;
        }).map(read).join('\n\n');
        warning = 'Imported body text and tables. Review lists and layout; images, comments, headers and footnotes are not narrated.';
    } else {
        const encoding = data[0] === 255 && data[1] === 254 ? 'utf-16le' : data[0] === 254 && data[1] === 255 ? 'utf-16be' : 'utf-8';
        try { text = new TextDecoder(encoding, { fatal: true }).decode(data); }
        catch (_) { throw new Error('Save this text file using UTF-8 encoding, then import it again.'); }
        if (['md', 'markdown'].includes(extension)) warning = 'Markdown is imported as written. Remove formatting or code you do not want spoken.';
    }
    signal.throwIfAborted();
    return { text: checkedText(text), warning };
}
