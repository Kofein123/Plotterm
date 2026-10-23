// Минимальное чтение ZIP (нужно для .docx) средствами браузера: DecompressionStream('deflate-raw').
export async function readZipEntry(buf, name) {
    const dv = new DataView(buf);
    const bytes = new Uint8Array(buf);
    // конец центрального каталога
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (dv.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        throw new Error('это не ZIP/DOCX файл');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
        if (dv.getUint32(p, true) !== 0x02014b50)
            break;
        const method = dv.getUint16(p + 10, true);
        const csize = dv.getUint32(p + 20, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extraLen = dv.getUint16(p + 30, true);
        const commentLen = dv.getUint16(p + 32, true);
        const local = dv.getUint32(p + 42, true);
        const entryName = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        if (entryName === name) {
            const lNameLen = dv.getUint16(local + 26, true);
            const lExtraLen = dv.getUint16(local + 28, true);
            const start = local + 30 + lNameLen + lExtraLen;
            const data = bytes.subarray(start, start + csize);
            if (method === 0)
                return data.slice();
            if (method === 8)
                return inflateRaw(data);
            throw new Error('неподдерживаемое сжатие ZIP: ' + method);
        }
        p += 46 + nameLen + extraLen + commentLen;
    }
    return null;
}
async function inflateRaw(data) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
