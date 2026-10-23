// Импорт текста (.txt, .md, .docx), рисунков (SVG) и готового G-кода.
import { readZipEntry } from "./zip.js";
export async function readTextFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.docx'))
        return docxToText(await file.arrayBuffer());
    let text = await file.text();
    if (name.endsWith('.md') || name.endsWith('.markdown'))
        text = markdownToText(text);
    return text;
}
/** Markdown → наша разметка: заголовки остаются «# », жирный/курсив убираются, списки — с тире. */
export function markdownToText(md) {
    return md
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((l) => {
        let s = l;
        const h = s.match(/^#{1,6}\s+(.*)$/);
        if (h)
            return '# ' + h[1].trim();
        s = s.replace(/^\s*[-*+]\s+/, '— ');
        s = s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1$2');
        s = s.replace(/`([^`]+)`/g, '$1');
        s = s.replace(/!\[[^\]]*]\([^)]*\)/g, '').replace(/\[([^\]]+)]\([^)]*\)/g, '$1');
        return s;
    })
        .join('\n');
}
export async function docxToText(buf) {
    const xmlBytes = await readZipEntry(buf, 'word/document.xml');
    if (!xmlBytes)
        throw new Error('в файле нет word/document.xml');
    const xml = new TextDecoder().decode(xmlBytes);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const paras = doc.getElementsByTagNameNS(W, 'p');
    const out = [];
    for (const p of Array.from(paras)) {
        let text = '';
        const walk = (n) => {
            for (const c of Array.from(n.children)) {
                if (c.namespaceURI === W && c.localName === 't')
                    text += c.textContent ?? '';
                else if (c.namespaceURI === W && c.localName === 'tab')
                    text += '    ';
                else if (c.namespaceURI === W && (c.localName === 'br' || c.localName === 'cr'))
                    text += '\n';
                else if (!(c.namespaceURI === W && c.localName === 'pPr'))
                    walk(c);
            }
        };
        walk(p);
        const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') ?? '';
        if (/heading|заголовок|title/i.test(style) && text.trim())
            text = '# ' + text.trim();
        out.push(text);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
/** SVG → ломаные. Использует браузерный движок SVG (трансформации, кривые, дуги). */
export function svgToStrokes(svgText, opts) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const src = doc.documentElement;
    if (src.nodeName.toLowerCase() !== 'svg')
        throw new Error('это не SVG');
    const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.setAttribute('style', 'position:absolute;left:-10000px;top:0;width:10px;height:10px;visibility:hidden');
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    host.appendChild(g);
    for (const c of Array.from(src.childNodes))
        g.appendChild(document.importNode(c, true));
    document.body.appendChild(host);
    const raw = [];
    try {
        const shapes = g.querySelectorAll('path, line, polyline, polygon, rect, circle, ellipse');
        // грубая оценка масштаба, чтобы выбрать шаг выборки
        const bb = g.getBBox();
        const unitStep = Math.max(bb.width, bb.height) / 1500 || 0.2;
        for (const el of Array.from(shapes)) {
            if (el.closest('defs, clipPath, mask, symbol'))
                continue;
            const len = el.getTotalLength();
            if (!(len > 0))
                continue;
            const m = el.getCTM();
            const toHost = (p) => (m ? p.matrixTransform(m) : p);
            const n = Math.max(2, Math.min(20000, Math.ceil(len / unitStep)));
            let cur = [];
            let prev = null;
            for (let i = 0; i <= n; i++) {
                const p = toHost(el.getPointAtLength((len * i) / n));
                // разрыв (новый подпуть «M») — точки скачут дальше шага
                if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > unitStep * 6 && el.tagName === 'path') {
                    if (cur.length >= 4)
                        raw.push(cur);
                    cur = [];
                }
                cur.push(p.x, p.y);
                prev = p;
            }
            if (cur.length >= 4)
                raw.push(cur);
        }
    }
    finally {
        host.remove();
    }
    if (!raw.length)
        return [];
    // масштаб в мм и размещение
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of raw)
        for (let i = 0; i < s.length; i += 2) {
            minX = Math.min(minX, s[i]);
            maxX = Math.max(maxX, s[i]);
            minY = Math.min(minY, s[i + 1]);
            maxY = Math.max(maxY, s[i + 1]);
        }
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    let k = opts.width > 0 ? opts.width / w : Math.min(opts.maxWidth / w, opts.maxHeight / h);
    if (h * k > opts.maxHeight)
        k = opts.maxHeight / h;
    return raw.map((s) => ({
        pts: s.map((v, i) => (i % 2 === 0 ? opts.left + (v - minX) * k : opts.top + (v - minY) * k)),
        line: 0,
    }));
}
/** Разбор чужого G-кода для предпросмотра: ломаные там, где Z ≤ порога (ручка опущена). */
export function parseGcodePaths(lines, penDown) {
    let x = 0, y = 0, z = 10, abs = true;
    const strokes = [];
    const lineStroke = new Int32Array(lines.length).fill(-1);
    let cur = null;
    lines.forEach((raw, idx) => {
        const l = raw.replace(/;.*$/, '').replace(/\(.*?\)/g, '').toUpperCase();
        if (/G90(?!\.)/.test(l))
            abs = true;
        if (/G91(?!\.)/.test(l))
            abs = false;
        const get = (a) => {
            const m = l.match(new RegExp(a + '\\s*(-?\\d*\\.?\\d+)'));
            return m ? Number(m[1]) : null;
        };
        const nx = get('X'), ny = get('Y'), nz = get('Z');
        if (nx === null && ny === null && nz === null) {
            if (cur)
                lineStroke[idx] = strokes.length - 1;
            return;
        }
        const tx = nx === null ? x : abs ? nx : x + nx;
        const ty = ny === null ? y : abs ? ny : y + ny;
        const tz = nz === null ? z : abs ? nz : z + nz;
        const down = penDown(tz);
        if (down) {
            if (!cur) {
                cur = { pts: [x, y], startLine: idx };
                strokes.push(cur);
            }
            cur.pts.push(tx, ty);
        }
        else
            cur = null;
        lineStroke[idx] = strokes.length - 1;
        x = tx;
        y = ty;
        z = tz;
    });
    return { strokes, lineStroke };
}
