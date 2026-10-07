// Parsers for the auxiliary binary assets shipped alongside each bundle:
//   - .npy  (the bos_before_voice tensor)
//   - voices.bin (compact built-in voice states, "PTVB1" format)

export function parseNpyFloat32(buffer) {
    const view = new DataView(buffer);
    const magic = new Uint8Array(buffer, 0, 6);
    const expected = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
    for (let i = 0; i < expected.length; i++) {
        if (magic[i] !== expected[i]) throw new Error("Invalid NPY file");
    }

    const major = view.getUint8(6);
    const headerLen = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
    const headerOffset = major === 1 ? 10 : 12;
    const headerText = new TextDecoder().decode(new Uint8Array(buffer, headerOffset, headerLen));
    const shapeMatch = headerText.match(/\(\s*([0-9,\s]+)\)/);
    if (!shapeMatch) throw new Error("Could not parse NPY shape");
    const shape = shapeMatch[1]
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => Number.parseInt(p, 10));
    const dataOffset = headerOffset + headerLen;
    return { data: new Float32Array(buffer.slice(dataOffset)), shape };
}

export function parseVoiceStatesBin(buffer) {
    const view = new DataView(buffer);
    let offset = 0;
    const magic = new TextDecoder().decode(new Uint8Array(buffer, offset, 5));
    offset += 5;
    if (magic !== "PTVB1") throw new Error("Invalid voices.bin header");

    const voices = {};
    const voiceCount = view.getUint32(offset, true);
    offset += 4;

    for (let v = 0; v < voiceCount; v++) {
        const nameLen = view.getUint16(offset, true);
        offset += 2;
        const name = new TextDecoder().decode(new Uint8Array(buffer, offset, nameLen));
        offset += nameLen;

        const tensorCount = view.getUint16(offset, true);
        offset += 2;
        const tensors = {};

        for (let t = 0; t < tensorCount; t++) {
            const keyLen = view.getUint16(offset, true);
            offset += 2;
            const key = new TextDecoder().decode(new Uint8Array(buffer, offset, keyLen));
            offset += keyLen;

            const dtypeCode = view.getUint8(offset);
            offset += 1;
            const rank = view.getUint8(offset);
            offset += 1;

            const shape = [];
            for (let d = 0; d < rank; d++) {
                shape.push(view.getUint32(offset, true));
                offset += 4;
            }

            const byteLength = view.getUint32(offset, true);
            offset += 4;

            let data;
            if (dtypeCode === 0) {
                data = new Float32Array(buffer.slice(offset, offset + byteLength));
            } else if (dtypeCode === 1) {
                data = new BigInt64Array(buffer.slice(offset, offset + byteLength));
            } else if (dtypeCode === 2) {
                data = new Uint8Array(buffer.slice(offset, offset + byteLength));
            } else {
                throw new Error(`Unsupported voices.bin dtype code: ${dtypeCode}`);
            }
            offset += byteLength;

            tensors[key] = {
                data,
                shape,
                dtype: dtypeCode === 0 ? "float32" : dtypeCode === 1 ? "int64" : "bool",
            };
        }

        voices[name] = tensors;
    }

    return voices;
}
