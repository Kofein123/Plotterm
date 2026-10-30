var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
// Документ лекции (PDF, Word) → наша разметка + рисунки.
// Из PDF берём текст с координатами и размером шрифта, собираем строки и абзацы, находим заголовки,
// списки и таблицы; картинки вырезаем со страницы и переводим в линии для ручки.
import { readZipEntry } from "./zip.js";
import { vectorize } from "./vectorize.js";
const BULLET = /^[•●▪◦‣∙·\-–—*]\s*/u;
const CAPTION = /^\d+(?:[.,]\d+)*\s*[-‐–]?\s*(сурет|рис\.?|рисунок|figure|fig\.?|кесте|таблица|table)/iu;
const PRINT_MARK = /^\[\s*(басып\s+шығару|печать|распечатать|print)[^\]]*\]$/iu;
const HAND_MARK = /^\[\s*(қолмен|от\s+руки|вручную|нарисовать|by\s+hand)[^\]]*\]$/iu;
function median(a) {
    if (!a.length)
        return 0;
    const s = [...a].sort((p, q) => p - q);
    return s[s.length >> 1];
}
function toLines(items) {
    const its = items.filter((i) => i.str.trim() !== '').sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const it of its) {
        const row = rows[rows.length - 1];
        if (row && Math.abs(row[0].y - it.y) < Math.max(row[0].h, it.h) * 0.45)
            row.push(it);
        else
            rows.push([it]);
    }
    return rows.map((row) => {
        row.sort((a, b) => a.x - b.x);
        let text = '';
        let cells = 1;
        let end = -Infinity;
        const parts = [];
        let partStart = 0;
        for (const it of row) {
            const gap = it.x - end;
            const s = it.str;
            if (!text)
                parts.push({ text: '', x: it.x });
            if (text && gap > it.h * 1.4) {
                // широкий промежуток в строке — это колонки таблицы
                parts[parts.length - 1].text = text.slice(partStart);
                parts.push({ text: '', x: it.x });
                text = text.trimEnd() + ' — ';
                partStart = text.length;
                text += s.trimStart();
                cells++;
            }
            else if (text && gap > it.h * 0.12 && !/\s$/.test(text) && !/^\s/.test(s))
                text += ' ' + s;
            else
                text += s;
            end = Math.max(end, it.x + it.w);
        }
        if (parts.length)
            parts[parts.length - 1].text = text.slice(partStart);
        for (const p of parts)
            p.text = p.text.replace(/\s+/g, ' ').trim();
        const hs = row.filter((r) => r.str.trim()).map((r) => r.h);
        const boldChars = row.filter((r) => r.bold).reduce((a, r) => a + r.str.length, 0);
        const allChars = row.reduce((a, r) => a + r.str.length, 0);
        return {
            y: median(row.map((r) => r.y)),
            x0: row[0].x,
            x1: end,
            h: median(hs.length ? hs : [row[0].h]),
            bold: allChars > 0 && boldChars / allChars > 0.6,
            text: text.replace(/\s+/g, ' ').trim(),
            cells,
            parts,
        };
    }).filter((l) => l.text);
}
/**
 * Строки и рисунки → разметка. Абзац собирается из соседних строк; новый абзац — после пустого промежутка,
 * у пункта списка, у строки таблицы, при смене размера шрифта или после короткой (неполной) строки.
 */
export function structure(items, slots = [], tools = {}) {
    const lines = toLines(items);
    const body = median(lines.map((l) => l.h)) || 10;
    const left = median(lines.map((l) => l.x0));
    const right = Math.max(...lines.map((l) => l.x1), left + 100);
    const full = right - left;
    const blocks = [];
    let para = null;
    const flush = () => {
        if (para)
            blocks.push({ y: para.y, kind: 'text', text: para.text, heading: para.heading });
        para = null;
    };
    const slotQ = [...slots].sort((a, b) => a.y - b.y);
    const imgs = [];
    const marks = { ...tools };
    let lastImage = null;
    let captionOpen = null;
    let capEnd = 0;
    for (const l of lines) {
        while (slotQ.length && slotQ[0].y < l.y) {
            flush();
            const s = slotQ.shift();
            lastImage = { id: s.id, caption: '', y: s.y };
            imgs.push(lastImage);
            blocks.push({ y: s.y, kind: 'image', id: s.id, caption: '' });
            captionOpen = null;
        }
        const t = l.text;
        // подпись и пометка «распечатать / от руки» под рисунком
        if (lastImage && PRINT_MARK.test(t)) {
            marks[lastImage.id] ??= 'space';
            captionOpen = null;
            continue;
        }
        if (lastImage && HAND_MARK.test(t)) {
            marks[lastImage.id] ??= 'pencil';
            captionOpen = null;
            continue;
        }
        if (lastImage && !lastImage.caption && CAPTION.test(t)) {
            flush();
            lastImage.caption = t;
            captionOpen = lastImage;
            capEnd = l.x1;
            continue;
        }
        // подпись переносится на следующие строки: они тоже по центру, без отступа слева
        // (по центру, без отступа слева, или после длинной строки, дошедшей до правого края)
        if (captionOpen && l.cells === 1 && !BULLET.test(t) && (l.x0 > left + full * 0.03 || capEnd > right - full * 0.06)) {
            captionOpen.caption += ' ' + t;
            capEnd = l.x1;
            continue;
        }
        captionOpen = null;
        // таблица: строка с колонками; следующая близкая строка — перенос текста внутри ячеек
        const prevB = blocks[blocks.length - 1];
        if (!para && prevB?.kind === 'row' && l.y - prevB.last.y < l.h * 1.45 && !BULLET.test(t)) {
            for (const pt of l.parts) {
                let j = 0;
                for (let k = 1; k < prevB.xs.length; k++)
                    if (Math.abs(prevB.xs[k] - pt.x) < Math.abs(prevB.xs[j] - pt.x))
                        j = k;
                const c = prevB.cells[j];
                prevB.cells[j] = /[\p{L}]-$/u.test(c) && /^\p{Ll}/u.test(pt.text) ? c.slice(0, -1) + pt.text : (c ? c + ' ' : '') + pt.text;
            }
            prevB.last = l;
            continue;
        }
        if (l.cells > 1) {
            flush();
            blocks.push({ y: l.y, kind: 'row', cells: l.parts.map((p) => p.text), xs: l.parts.map((p) => p.x), last: l });
            continue;
        }
        const big = l.h > body * 1.18;
        const short = l.x1 - l.x0 < full * 0.7;
        const heading = big || (l.bold && short && t.length < 80 && !/[.:;,]$/.test(t));
        const bullet = BULLET.test(t) && !/^[-–—]\s*\d/.test(t);
        const row = l.cells > 1;
        let startNew = !para || heading || para.heading || bullet || row || para.last.cells > 1;
        if (para && !startNew) {
            const gap = l.y - para.last.y;
            if (gap > Math.max(para.last.h, l.h) * 1.75)
                startNew = true;
            else if (Math.abs(l.h - para.last.h) > body * 0.15)
                startNew = true;
            else if (para.last.x1 - left < full * 0.72)
                startNew = true; // предыдущая строка закончилась рано
        }
        if (startNew) {
            flush();
            const txt = bullet ? '— ' + t.replace(BULLET, '') : t;
            para = { y: l.y, text: txt, heading, last: l };
        }
        else {
            const p = para;
            // перенос «сло-\nво» склеиваем
            if (/[\p{L}]-$/u.test(p.text) && /^\p{Ll}/u.test(t))
                p.text = p.text.slice(0, -1) + t;
            else
                p.text += ' ' + t;
            p.last = l;
        }
    }
    flush();
    for (const s of slotQ)
        blocks.push({ y: s.y, kind: 'image', id: s.id, caption: '' });
    // одиночная «строка таблицы» или ряд формул через пробелы — это просто текст
    blocks.forEach((b, i) => {
        if (b.kind !== 'row')
            return;
        const formulas = b.cells.every((c) => c.includes('='));
        const alone = blocks[i - 1]?.kind !== 'row' && blocks[i + 1]?.kind !== 'row';
        if (formulas || alone)
            blocks[i] = { y: b.y, kind: 'text', text: b.cells.join(formulas ? '     ' : ' — '), heading: formulas };
    });
    const out = [];
    for (const b of blocks) {
        if (b.kind === 'image') {
            const cap = imgs.find((i) => i.id === b.id)?.caption ?? '';
            const tool = marks[b.id];
            const opt = tool === 'pencil' ? ' карандаш' : tool === 'space' ? ' место' : '';
            out.push(`![${cap.replace(/[\[\]]/g, '')}](img:${b.id}${opt})`);
            continue;
        }
        if (b.kind === 'row') {
            out.push('| ' + b.cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ') + ' |');
            continue;
        }
        if (b.heading) {
            if (out.length && out[out.length - 1] !== '')
                out.push('');
            out.push('# ' + b.text);
        }
        else
            out.push(b.text);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
// --- PDF через pdf.js (загружается при первом импорте) ---
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
let pdfjsP = null;
function loadPdfjs() {
    if (!pdfjsP) {
        const url = PDFJS;
        pdfjsP = import(__rewriteRelativeImportExtension(/* webpackIgnore: true */ url)).then((m) => {
            m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
            return m;
        });
        pdfjsP.catch(() => (pdfjsP = null));
    }
    return pdfjsP;
}
const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
/** Прямоугольники картинок страницы в координатах PDF (y вверх). */
export function imageBoxes(ops, OPS) {
    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const out = [];
    const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat].filter((v) => v !== undefined));
    for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        if (fn === OPS.save)
            stack.push(ctm);
        else if (fn === OPS.restore)
            ctm = stack.pop() ?? ctm;
        else if (fn === OPS.transform)
            ctm = mul(ctm, ops.argsArray[i]);
        else if (fn === OPS.paintFormXObjectBegin && ops.argsArray[i]?.[0]) {
            stack.push(ctm);
            ctm = mul(ctm, ops.argsArray[i][0]);
        }
        else if (fn === OPS.paintFormXObjectEnd)
            ctm = stack.pop() ?? ctm;
        else if (paint.has(fn)) {
            const xs = [ctm[4], ctm[0] + ctm[4], ctm[2] + ctm[4], ctm[0] + ctm[2] + ctm[4]];
            const ys = [ctm[5], ctm[1] + ctm[5], ctm[3] + ctm[5], ctm[1] + ctm[3] + ctm[5]];
            const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
            // значки и линии-разделители не берём
            if (box[2] - box[0] > 25 && box[3] - box[1] > 25)
                out.push(box);
        }
    }
    return out;
}
function canvasGray(cv, x, y, w, h) {
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const rgba = ctx.getImageData(x, y, w, h).data;
    const data = new Uint8Array(w * h);
    for (let i = 0; i < data.length; i++)
        data[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
    return { w, h, data };
}
export async function pdfToDocument(buf, onProgress) {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const items = [];
    const slots = [];
    const images = [];
    let yOff = 0;
    for (let p = 1; p <= doc.numPages; p++) {
        onProgress?.(`Страница ${p} из ${doc.numPages}…`);
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        // список операций загружает шрифты страницы — после него видно, какой из них жирный
        const ops = await page.getOperatorList();
        const tc = await page.getTextContent();
        for (const it of tc.items) {
            if (typeof it.str !== 'string')
                continue;
            const [, , c, d, e, f] = it.transform;
            const h = Math.hypot(c, d) || it.height || 10;
            const [vx, vy] = vp.convertToViewportPoint(e, f);
            let bold = false;
            try {
                const font = page.commonObjs.get(it.fontName);
                bold = /bold|black|heavy|semibold|demi/i.test(font?.name ?? '') || !!font?.bold;
            }
            catch {
                bold = /bold/i.test(tc.styles?.[it.fontName]?.fontFamily ?? '');
            }
            items.push({ str: it.str, x: vx, y: yOff + vy, w: it.width ?? it.str.length * h * 0.5, h, bold });
        }
        const boxes = imageBoxes(ops, pdfjs.OPS);
        if (boxes.length) {
            const scale = 3;
            const vps = page.getViewport({ scale });
            const cv = document.createElement('canvas');
            cv.width = Math.ceil(vps.width);
            cv.height = Math.ceil(vps.height);
            await page.render({ canvasContext: cv.getContext('2d'), viewport: vps }).promise;
            for (const b of boxes) {
                const [x0, y0] = vps.convertToViewportPoint(b[0], b[3]);
                const [x1, y1] = vps.convertToViewportPoint(b[2], b[1]);
                const X = Math.max(0, Math.floor(Math.min(x0, x1))), Y = Math.max(0, Math.floor(Math.min(y0, y1)));
                const W = Math.min(cv.width - X, Math.ceil(Math.abs(x1 - x0))), H = Math.min(cv.height - Y, Math.ceil(Math.abs(y1 - y0)));
                if (W < 20 || H < 20)
                    continue;
                const id = `p${p}i${images.length + 1}`;
                const d = vectorize(canvasGray(cv, X, Y, W, H));
                images.push({ id, name: `Рисунок ${images.length + 1} (стр. ${p})`, ...d });
                const [, top] = vp.convertToViewportPoint(b[0], b[3]);
                slots.push({ id, y: yOff + top });
            }
        }
        yOff += vp.height + 40;
        page.cleanup();
    }
    await doc.destroy();
    return { text: structure(items, slots), images };
}
// --- Word ---
async function blobGray(bytes, mime) {
    try {
        const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
        const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bmp, 0, 0, w, h);
        bmp.close();
        return canvasGray(cv, 0, 0, w, h);
    }
    catch {
        return null;
    }
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
export async function docxToDocument(buf) {
    const xmlBytes = await readZipEntry(buf, 'word/document.xml');
    if (!xmlBytes)
        throw new Error('в файле нет word/document.xml');
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(xmlBytes), 'application/xml');
    const relBytes = await readZipEntry(buf, 'word/_rels/document.xml.rels');
    const rels = {};
    if (relBytes) {
        const rd = new DOMParser().parseFromString(new TextDecoder().decode(relBytes), 'application/xml');
        for (const r of Array.from(rd.getElementsByTagName('Relationship')))
            rels[r.getAttribute('Id') ?? ''] = r.getAttribute('Target') ?? '';
    }
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const body = doc.getElementsByTagNameNS(W, 'body')[0];
    const out = [];
    const images = [];
    const pending = [];
    const paraText = (p) => {
        let text = '';
        const walk = (n) => {
            for (const c of Array.from(n.children)) {
                if (c.namespaceURI === W && c.localName === 't')
                    text += c.textContent ?? '';
                else if (c.namespaceURI === W && c.localName === 'tab')
                    text += '    ';
                else if (c.namespaceURI === W && (c.localName === 'br' || c.localName === 'cr'))
                    text += ' ';
                else if (c.localName === 'blip') {
                    const target = rels[c.getAttributeNS(R, 'embed') ?? ''];
                    if (target) {
                        const id = `w${pending.length + 1}`;
                        pending.push({ id, target });
                        text += `\u0001${id}\u0001`;
                    }
                }
                else if (!(c.namespaceURI === W && c.localName === 'pPr'))
                    walk(c);
            }
        };
        walk(p);
        return text;
    };
    const emitPara = (p) => {
        let text = paraText(p);
        const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') ?? '';
        const list = p.getElementsByTagNameNS(W, 'numPr').length > 0;
        // картинки внутри абзаца — отдельными строками
        const parts = text.split('\u0001');
        for (let i = 0; i < parts.length; i++) {
            if (i % 2 === 1) {
                out.push(`![](img:${parts[i]})`);
                continue;
            }
            let t = parts[i].replace(/\s+/g, ' ').trim();
            if (!t) {
                if (parts.length === 1)
                    out.push('');
                continue;
            }
            if (/heading|заголовок|title/i.test(style)) {
                if (out.length && out[out.length - 1] !== '')
                    out.push('');
                t = '# ' + t;
            }
            else if (list)
                t = '— ' + t;
            out.push(t);
        }
        text = '';
    };
    for (const el of Array.from(body?.children ?? [])) {
        if (el.namespaceURI === W && el.localName === 'p')
            emitPara(el);
        else if (el.namespaceURI === W && el.localName === 'tbl') {
            // таблица: строка — ячейки через тире
            for (const tr of Array.from(el.getElementsByTagNameNS(W, 'tr'))) {
                const cells = Array.from(tr.getElementsByTagNameNS(W, 'tc')).map((tc) => Array.from(tc.getElementsByTagNameNS(W, 'p')).map((p) => paraText(p).replace(/\u0001[^\u0001]*\u0001/g, '').trim()).filter(Boolean).join(' '));
                if (cells.some(Boolean))
                    out.push('| ' + cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ') + ' |');
            }
        }
    }
    for (const { id, target } of pending) {
        const path = target.startsWith('/') ? target.slice(1) : 'word/' + target.replace(/^\.\//, '');
        const bytes = await readZipEntry(buf, path);
        const ext = path.split('.').pop()?.toLowerCase() ?? '';
        const g = bytes && MIME[ext] ? await blobGray(bytes, MIME[ext]) : null;
        if (g)
            images.push({ id, name: `Рисунок ${images.length + 1}`, ...vectorize(g) });
    }
    // подписи «Рисунок 1 — …» сразу под картинкой переносим в подпись
    const text = out.join('\n').replace(/!\[\]\(img:(\w+)\)\n(?:\n)?(\d+(?:[.,]\d+)*\s*[-‐–]?\s*(?:сурет|рис\.?|рисунок|figure)[^\n]*)/giu, (_m, id, cap) => `![${cap.replace(/[\[\]]/g, '')}](img:${id})`);
    return { text: text.replace(/\n{3,}/g, '\n\n').trim() + '\n', images };
}
/** Есть ли в документе разметка рисунков, которых нет среди загруженных (например, файл открыли на другом компьютере). */
export function missingImages(text, have) {
    const out = [];
    for (const m of text.matchAll(/\]\(img:([\w-]+)/g))
        if (!have[m[1]])
            out.push(m[1]);
    return out;
}
