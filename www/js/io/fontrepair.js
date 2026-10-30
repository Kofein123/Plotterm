// Старые бесплатные шрифты (часть рукописных с ofont.ru) записаны с ошибками в служебных полях заголовка:
// неверные searchRange / entrySelector / rangeShift в каталоге таблиц и в cmap. Браузер (санитайзер OTS)
// такие файлы отвергает целиком, хотя сами буквы в порядке. Пересчитываем эти поля, выравниваем таблицы
// по 4 байта и упрощаем таблицу имён глифов post до версии 3 (имена глифов нам не нужны) — шрифт открывается.
const log2 = (n) => Math.floor(Math.log2(Math.max(1, n)));
/** Копия файла с исправленными полями; null — если это не TrueType/OpenType. */
export function repairSfnt(src) {
    if (src.byteLength < 12)
        return null;
    const sv = new DataView(src);
    const tag = sv.getUint32(0);
    if (tag !== 0x00010000 && tag !== 0x74727565 /* true */ && tag !== 0x4f54544f /* OTTO */)
        return null;
    const n = sv.getUint16(4);
    if (12 + n * 16 > src.byteLength)
        return null;
    // пересобираем файл: каждая таблица с адреса, кратного 4
    const tables = [];
    for (let i = 0; i < n; i++) {
        const rec = 12 + i * 16;
        const t = sv.getUint32(rec), off = sv.getUint32(rec + 8);
        let len = sv.getUint32(rec + 12);
        if (off > src.byteLength)
            return null;
        len = Math.min(len, src.byteLength - off);
        let data = new Uint8Array(src, off, len).slice();
        if (t === 0x706f7374 /* post */ && len >= 32) {
            data = data.slice(0, 32);
            new DataView(data.buffer).setUint32(0, 0x00030000);
        }
        tables.push({ tag: t, sum: sv.getUint32(rec + 4), data });
    }
    let size = 12 + n * 16;
    for (const t of tables)
        size += (t.data.length + 3) & ~3;
    const buf = new ArrayBuffer(size);
    const v = new DataView(buf);
    const bytes = new Uint8Array(buf);
    v.setUint32(0, tag);
    v.setUint16(4, n);
    let at = 12 + n * 16;
    tables.forEach((t, i) => {
        const rec = 12 + i * 16;
        v.setUint32(rec, t.tag);
        v.setUint32(rec + 4, t.sum);
        v.setUint32(rec + 8, at);
        v.setUint32(rec + 12, t.data.length);
        bytes.set(t.data, at);
        at += (t.data.length + 3) & ~3;
    });
    const e = log2(n);
    v.setUint16(6, (1 << e) * 16);
    v.setUint16(8, e);
    v.setUint16(10, n * 16 - (1 << e) * 16);
    for (let i = 0; i < n; i++) {
        const rec = 12 + i * 16;
        if (v.getUint32(rec) !== 0x636d6170 /* cmap */)
            continue;
        const off = v.getUint32(rec + 8), len = v.getUint32(rec + 12);
        if (off + 4 > buf.byteLength || off + len > buf.byteLength)
            return buf;
        const subs = v.getUint16(off + 2);
        for (let k = 0; k < subs; k++) {
            const st = off + v.getUint32(off + 4 + k * 8 + 4);
            if (st + 14 > buf.byteLength || v.getUint16(st) !== 4)
                continue;
            const segX2 = v.getUint16(st + 6);
            const se = log2(segX2 / 2);
            v.setUint16(st + 8, 2 * (1 << se));
            v.setUint16(st + 10, se);
            v.setUint16(st + 12, segX2 - 2 * (1 << se));
        }
    }
    return buf;
}
