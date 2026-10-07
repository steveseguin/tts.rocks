// Minimal pure-JS SentencePiece Unigram tokenizer with byte fallback.
//
// Pocket TTS ships a `tokenizer.model` that is a Unigram model
// (trainer.model_type = 1), byte_fallback = true, and an "identity"
// normalizer (no precompiled charsmap, add_dummy_prefix = true,
// remove_extra_whitespaces = false). That means we only need to:
//   - escape every space as U+2581 (▁) and prepend one dummy ▁,
//   - run Viterbi over the vocabulary scores,
//   - fall back to <0xXX> byte pieces for anything not in the vocab.
//
// This replaces the ~4 MB WASM SentencePiece build with a few KB of JS.

const SPACE = "▁"; // ▁ meta-space
const UNK_PENALTY = 10.0;
const BYTE_RE = /^<0x([0-9A-Fa-f]{2})>$/;

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
const utf8Encoder = new TextEncoder();

function readVarint(bytes, pos) {
    let shift = 0;
    let result = 0;
    let i = pos;
    for (;;) {
        const b = bytes[i++];
        result += (b & 0x7f) * Math.pow(2, shift);
        if ((b & 0x80) === 0) break;
        shift += 7;
    }
    return [result, i];
}

// Parse the SentencePiece ModelProto `pieces` (field 1). Each piece is a
// sub-message holding the piece string (field 1) and a float score (field 2).
function parseModelProto(bytes) {
    const pieces = [];
    let i = 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    while (i < bytes.length) {
        let tag;
        [tag, i] = readVarint(bytes, i);
        const field = tag >>> 3;
        const wire = tag & 7;

        if (wire === 2) {
            let len;
            [len, i] = readVarint(bytes, i);
            const end = i + len;
            if (field === 1) {
                let j = i;
                let piece = null;
                let score = 0;
                while (j < end) {
                    let ptag;
                    [ptag, j] = readVarint(bytes, j);
                    const pf = ptag >>> 3;
                    const pw = ptag & 7;
                    if (pw === 2) {
                        let plen;
                        [plen, j] = readVarint(bytes, j);
                        if (pf === 1) piece = bytes.subarray(j, j + plen);
                        j += plen;
                    } else if (pw === 5) {
                        if (pf === 2) score = view.getFloat32(j, true);
                        j += 4;
                    } else if (pw === 1) {
                        j += 8;
                    } else if (pw === 0) {
                        [, j] = readVarint(bytes, j);
                    }
                }
                pieces.push({ piece, score });
            }
            i = end;
        } else if (wire === 0) {
            [, i] = readVarint(bytes, i);
        } else if (wire === 5) {
            i += 4;
        } else if (wire === 1) {
            i += 8;
        }
    }
    return pieces;
}

export class SentencePieceTokenizer {
    constructor() {
        this.pieceToId = new Map();
        this.idToPiece = [];
        this.scores = [];
        this.byteTokenId = new Int32Array(256).fill(-1);
        this.minScore = 0;
        this.maxPieceChars = 1;
    }

    static async fromUrl(url, fetchImpl = fetch) {
        const res = await fetchImpl(url);
        if (!res.ok) throw new Error(`Failed to fetch tokenizer: ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        return SentencePieceTokenizer.fromBytes(buf);
    }

    static fromBytes(bytes) {
        const tok = new SentencePieceTokenizer();
        tok.load(bytes);
        return tok;
    }

    load(modelBytes) {
        const pieces = parseModelProto(modelBytes);
        for (let id = 0; id < pieces.length; id++) {
            const { piece, score } = pieces[id];
            const text = utf8Decoder.decode(piece);
            this.idToPiece.push(text);
            this.scores.push(score);
            this.pieceToId.set(text, id);
            if (score < this.minScore) this.minScore = score;
            const m = BYTE_RE.exec(text);
            if (m) this.byteTokenId[parseInt(m[1], 16)] = id;
            const codepoints = Array.from(text).length;
            if (codepoints > this.maxPieceChars) this.maxPieceChars = codepoints;
        }
    }

    // Identity normalizer + add_dummy_prefix, whitespace escaped as ▁.
    _normalize(text) {
        return SPACE + text.replace(/ /g, SPACE);
    }

    encodeIds(text) {
        if (!text) return [];
        const chars = Array.from(this._normalize(text)); // Unicode code points
        const n = chars.length;
        const unkScore = this.minScore - UNK_PENALTY;

        const best = new Float64Array(n + 1).fill(-Infinity);
        const backId = new Int32Array(n + 1).fill(-1); // piece id, or -1 = byte fallback
        const backStart = new Int32Array(n + 1).fill(-1);
        best[0] = 0;

        for (let i = 0; i < n; i++) {
            if (best[i] === -Infinity) continue;
            const maxLen = Math.min(this.maxPieceChars, n - i);
            let acc = "";
            for (let len = 1; len <= maxLen; len++) {
                acc += chars[i + len - 1];
                const id = this.pieceToId.get(acc);
                if (id === undefined) continue;
                const score = best[i] + this.scores[id];
                if (score > best[i + len]) {
                    best[i + len] = score;
                    backId[i + len] = id;
                    backStart[i + len] = i;
                }
            }
            // Single-char unknown step keeps the lattice connected.
            const uScore = best[i] + unkScore;
            if (uScore > best[i + 1]) {
                best[i + 1] = uScore;
                backId[i + 1] = -1;
                backStart[i + 1] = i;
            }
        }

        const segments = [];
        let pos = n;
        while (pos > 0) {
            const start = backStart[pos];
            segments.push({ id: backId[pos], start, end: pos });
            pos = start;
        }
        segments.reverse();

        const ids = [];
        for (const seg of segments) {
            if (seg.id >= 0) {
                ids.push(seg.id);
            } else {
                const chunk = chars.slice(seg.start, seg.end).join("");
                for (const b of utf8Encoder.encode(chunk)) {
                    const bid = this.byteTokenId[b];
                    if (bid >= 0) ids.push(bid);
                }
            }
        }
        return ids;
    }

    decodeIds(ids) {
        // Concatenate raw bytes so multibyte byte-fallback chars decode together.
        const out = [];
        for (const id of ids) {
            const piece = this.idToPiece[id];
            if (piece === undefined) continue;
            const m = BYTE_RE.exec(piece);
            if (m) {
                out.push(parseInt(m[1], 16));
            } else {
                for (const x of utf8Encoder.encode(piece)) out.push(x);
            }
        }
        let text = utf8Decoder.decode(new Uint8Array(out));
        text = text.split(SPACE).join(" ");
        if (text.startsWith(" ")) text = text.slice(1); // drop dummy prefix
        return text;
    }
}
