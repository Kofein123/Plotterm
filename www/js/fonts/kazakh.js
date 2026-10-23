function bbox(g) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of g.s)
        for (let i = 0; i < s.length; i += 2) {
            minX = Math.min(minX, s[i]);
            maxX = Math.max(maxX, s[i]);
            minY = Math.min(minY, s[i + 1]);
            maxY = Math.max(maxY, s[i + 1]);
        }
    return { minX, minY, maxX, maxY };
}
function mapPts(g, f) {
    return {
        w: g.w,
        s: g.s.map((s) => {
            const out = [];
            for (let i = 0; i < s.length; i += 2)
                out.push(...f(s[i], s[i + 1]));
            return out;
        }),
    };
}
function addStrokes(g, ...strokes) {
    return { w: g.w, s: [...g.s, ...strokes] };
}
/** Повернуть на 180° внутри рамки глифа (для ә из е). */
function rotate180(g, height) {
    const b = bbox(g);
    return mapPts(g, (x, y) => [b.maxX + b.minX - x, height - y]);
}
function scaleTo(g, k) {
    const r = mapPts(g, (x, y) => [x * k, y * k]);
    r.w = g.w * k;
    return r;
}
export function synthesizeKazakh(glyphs, m) {
    const get = (c) => glyphs.get(c)?.[0];
    const put = (c, g) => {
        if (g && !glyphs.has(c))
            glyphs.set(c, [g]);
    };
    const tail = (g, top) => {
        // хвостик-«крюк» справа внизу (қ, ң)
        const b = bbox(g);
        const d = Math.min(m.descender * 0.8, top * 0.28);
        return addStrokes(g, [b.maxX, 0, b.maxX + d * 0.25, 0, b.maxX + d * 0.25, -d]);
    };
    const bar = (g, y, x0, x1) => addStrokes(g, [x0, y, x1, y]);
    // ә, Ә — перевёрнутая е
    const e = get('е');
    if (e) {
        put('ә', rotate180(e, m.xHeight));
        put('Ә', scaleTo(rotate180(e, m.xHeight), m.capHeight / m.xHeight));
    }
    // ғ, Ғ — г с перекладиной
    for (const [src, dst, h] of [['г', 'ғ', m.xHeight], ['Г', 'Ғ', m.capHeight]]) {
        const g = get(src);
        if (g) {
            const b = bbox(g);
            put(dst, bar(g, h * 0.45, b.minX - h * 0.12, b.minX + h * 0.3));
        }
    }
    // қ Қ ң Ң — хвост
    for (const [src, dst, h] of [['к', 'қ', m.xHeight], ['К', 'Қ', m.capHeight], ['н', 'ң', m.xHeight], ['Н', 'Ң', m.capHeight]]) {
        const g = get(src);
        if (g)
            put(dst, tail(g, h));
    }
    // ө Ө — о с перекладиной
    for (const [src, dst, h] of [['о', 'ө', m.xHeight], ['О', 'Ө', m.capHeight]]) {
        const g = get(src);
        if (g) {
            const b = bbox(g);
            put(dst, bar(g, h * 0.5, b.minX, b.maxX));
        }
    }
    // ү Ү — прямая у: галочка и ствол; ұ Ұ — то же с перекладиной
    const makeStraightU = (h, w, desc) => ({
        w,
        s: [[0, h, w / 2, h * 0.4, w, h], [w / 2, h * 0.4, w / 2, desc]],
    });
    const uw = get('у') ? bbox(get('у')).maxX : m.xHeight * 0.6;
    const UW = get('У') ? bbox(get('У')).maxX : m.capHeight * 0.6;
    const u = makeStraightU(m.xHeight, uw, -m.descender * 0.9);
    const U = makeStraightU(m.capHeight, UW, 0);
    put('ү', u);
    put('Ү', U);
    put('ұ', bar(u, -m.descender * 0.25, uw * 0.15, uw * 0.85));
    put('Ұ', bar(U, m.capHeight * 0.3, UW * 0.15, UW * 0.85));
    // һ Һ — как латинская h
    put('һ', get('h'));
    const H = get('h');
    if (H)
        put('Һ', scaleTo(H, m.capHeight / Math.max(bbox(H).maxY, 1e-6)));
    // і І — как латинские
    put('і', get('i'));
    put('І', get('I'));
    // ё без точек в шрифте? — е с точками
    if (!glyphs.has('ё') && e) {
        const b = bbox(e);
        const y = m.xHeight * 1.25;
        put('ё', addStrokes(e, [b.minX + b.maxX * 0.25, y, b.minX + b.maxX * 0.25 + 0.05, y], [b.maxX * 0.75, y, b.maxX * 0.75 + 0.05, y]));
    }
    // √
    if (!glyphs.has('√')) {
        const h = m.capHeight * 1.05;
        put('√', { w: m.xHeight * 0.9, s: [[0, m.xHeight * 0.45, m.xHeight * 0.18, m.xHeight * 0.55, m.xHeight * 0.4, 0, m.xHeight * 0.9, h, m.xHeight * 2.2, h]] });
    }
}
