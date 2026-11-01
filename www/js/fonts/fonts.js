import gostA from "./data/gostA.js";
import gostB from "./data/gostB.js";
import propis from "./data/propis.js";
import { synthesizeKazakh } from "./kazakh.js";
import { deformGlyph, dropOutliers } from "./variants.js";
function fromData(d) {
    const glyphs = new Map();
    for (const [ch, g] of Object.entries(d.glyphs))
        glyphs.set(ch, [g]);
    synthesizeKazakh(glyphs, d);
    return {
        id: d.id,
        name: d.name,
        builtin: true,
        xHeight: d.xHeight,
        capHeight: d.capHeight,
        descender: d.descender,
        letterSpacing: d.letterSpacing,
        wordSpacing: d.wordSpacing,
        glyphs,
    };
}
/** Дополняет шрифт недостающими глифами из базового, пересчитывая их под его высоту. */
function fillMissing(f, base) {
    const k = f.xHeight / base.xHeight;
    for (const [ch, vs] of base.glyphs) {
        if (f.glyphs.has(ch))
            continue;
        f.glyphs.set(ch, vs.map((g) => ({ w: g.w * k, s: g.s.map((st) => st.map((v) => v * k)) })));
    }
    return f;
}
const gostAFont = fromData(gostA);
const gostBFont = fromData(gostB);
// В прописи нарисованы только строчные а–я: заглавные, цифры и знаки берём из ГОСТ тип Б.
// У них нет точек входа и выхода, поэтому они пишутся раздельно — как печатные от руки.
const propisFont = fillMissing(fromData(propis), gostBFont);
export const BUILTIN_FONTS = [gostAFont, gostBFont, propisFont];
export const CUSTOM_X_HEIGHT = 100;
/**
 * Точки входа и выхода для буквы без них (шрифты из .ttf): вход — самый левый конец штриха внизу буквы,
 * выход — самый правый. Буква соединяется с соседями, как в прописи, и слово пишется почти без подъёмов ручки.
 * Если вход и выход у разных штрихов, хвостик выхода ставится последним (oi) и начинает связку к следующей букве.
 */
export function autoJoin(g, xHeight) {
    if (g.i || g.o || !g.s.length || g.w <= 0)
        return g;
    // выход — внизу справа (так рука уходит к следующей букве); вход — слева, на любой высоте до x-высоты:
    // связка поднимается к началу следующей буквы, как в прописи к «и», «м», «л»
    const lowY = (y) => y <= xHeight * 0.6 && y >= -xHeight * 0.15;
    const inY = (y) => y <= xHeight * 1.08 && y >= -xHeight * 0.15;
    let entry = null;
    let exit = null;
    g.s.forEach((st, si) => {
        if (st.length < 4)
            return;
        for (const end of [false, true]) {
            const x = end ? st[st.length - 2] : st[0];
            const y = end ? st[st.length - 1] : st[1];
            if (inY(y) && x <= g.w * 0.25 && (!entry || x < entry.x))
                entry = { si, end, x, y };
            if (lowY(y) && x >= g.w * 0.8 && (!exit || x > exit.x))
                exit = { si, end, x, y };
        }
    });
    const en = entry;
    const ex = exit;
    if (!en || !ex)
        return g;
    const rev = (st) => {
        const r = [];
        for (let i = st.length - 2; i >= 0; i -= 2)
            r.push(st[i], st[i + 1]);
        return r;
    };
    if (en.si === ex.si) {
        // один штрих: вход и выход на разных его концах
        if (en.end === ex.end)
            return g;
        const st = en.end ? rev(g.s[en.si]) : g.s[en.si];
        const rest = g.s.filter((_, i) => i !== en.si);
        return { ...g, s: [st, ...rest], i: [en.x, en.y], o: [ex.x, ex.y] };
    }
    const first = en.end ? rev(g.s[en.si]) : g.s[en.si];
    const last = ex.end ? g.s[ex.si] : rev(g.s[ex.si]);
    const rest = g.s.filter((_, i) => i !== en.si && i !== ex.si);
    return { ...g, s: [first, ...rest, last], i: [en.x, en.y], o: [ex.x, ex.y], oi: rest.length + 1 };
}
/**
 * Штрихи буквы, которые сходятся концами (скелет из .ttf рвётся на развилках), склеиваем в один:
 * чернила те же, а ручка поднимается реже. Из нескольких продолжений берём самое прямое.
 */
export function mergeTouching(strokes, tol, minCos = -2) {
    const out = strokes.filter((s) => s.length >= 4).map((s) => s.slice());
    const rev = (st) => {
        const r = [];
        for (let i = st.length - 2; i >= 0; i -= 2)
            r.push(st[i], st[i + 1]);
        return r;
    };
    const dir = (st, atEnd) => {
        const n = st.length;
        const k = Math.min(n - 2, 6);
        const v = atEnd ? [st[n - 2] - st[n - 2 - k], st[n - 1] - st[n - 1 - k]] : [st[k] - st[0], st[k + 1] - st[1]];
        const l = Math.hypot(v[0], v[1]) || 1;
        return [v[0] / l, v[1] / l];
    };
    for (let guard = 0; guard < 50; guard++) {
        let best = null;
        for (let i = 0; i < out.length; i++)
            for (let j = 0; j < out.length; j++) {
                if (i === j)
                    continue;
                for (const ri of [false, true])
                    for (const rj of [false, true]) {
                        const a = ri ? rev(out[i]) : out[i];
                        const b = rj ? rev(out[j]) : out[j];
                        if (Math.hypot(a[a.length - 2] - b[0], a[a.length - 1] - b[1]) > tol)
                            continue;
                        const da = dir(a, true), db = dir(b, false);
                        const cos = da[0] * db[0] + da[1] * db[1];
                        if (cos < minCos)
                            continue;
                        if (!best || cos > best.cos)
                            best = { i, j, ri, rj, cos };
                    }
            }
        if (!best)
            break;
        const a = best.ri ? rev(out[best.i]) : out[best.i];
        const b = best.rj ? rev(out[best.j]) : out[best.j];
        out[best.i] = a.concat(b.slice(2));
        out.splice(best.j, 1);
    }
    return out;
}
/**
 * Соринки у базовой линии: точка или короткая чёрточка целиком в полосе вокруг строки (остаток направляющей
 * или рамки клетки на фото). В букве такого штриха не бывает: точки у «ё», «й» — сверху, хвосты «ц», «щ», «д» — длиннее.
 */
export function dropBaselineSpecks(g, xh) {
    if (g.s.length < 2)
        return g;
    const isSpeck = (st) => {
        let len = 0, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < st.length; i += 2) {
            minY = Math.min(minY, st[i + 1]);
            maxY = Math.max(maxY, st[i + 1]);
            if (i)
                len += Math.hypot(st[i] - st[i - 2], st[i + 1] - st[i - 1]);
        }
        return len < xh * 0.15 && minY >= -xh * 0.12 && maxY <= xh * 0.08;
    };
    const keep = g.s.map((st) => !isSpeck(st));
    if (keep.every(Boolean) || !keep.some(Boolean))
        return g;
    const out = { ...g, s: g.s.filter((_, i) => keep[i]) };
    if (g.oi !== undefined) {
        if (!keep[g.oi])
            delete out.oi;
        else
            out.oi = keep.slice(0, g.oi).filter(Boolean).length;
    }
    return out;
}
/** буквы, у которых отдельные короткие штрихи — часть буквы (точки, кратка) */
const HAS_MARKS = new Set([...'йЙёЁіІiјjJ!?:;%№ыЫ']);
/**
 * Обрывки печатных линий и соседних букв, попавшие в клетку: короткий штрих далеко от буквы или длинная ровная
 * горизонталь, торчащая за букву (кусок направляющей). У букв с точками короткие штрихи не трогаем.
 */
export function dropStrays(g, xh, ch) {
    if (g.s.length < 2)
        return g;
    const info = g.s.map((st) => {
        let len = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < st.length; i += 2) {
            x0 = Math.min(x0, st[i]);
            x1 = Math.max(x1, st[i]);
            y0 = Math.min(y0, st[i + 1]);
            y1 = Math.max(y1, st[i + 1]);
            if (i)
                len += Math.hypot(st[i] - st[i - 2], st[i + 1] - st[i - 1]);
        }
        return { len, x0, x1, y0, y1 };
    });
    // расстояние от точек одного штриха до отрезков другого (у прямой палочки всего две точки — по вершинам нельзя)
    const seg = (px, py, b) => {
        if (b.length < 4)
            return Math.hypot(px - b[0], py - b[1]);
        let m = Infinity;
        for (let j = 2; j < b.length; j += 2) {
            const ax = b[j - 2], ay = b[j - 1], dx = b[j] - ax, dy = b[j + 1] - ay;
            const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
            m = Math.min(m, Math.hypot(px - ax - t * dx, py - ay - t * dy));
        }
        return m;
    };
    const dist = (a, b) => {
        let m = Infinity;
        for (let i = 0; i < a.length; i += 2)
            m = Math.min(m, seg(a[i], a[i + 1], b));
        for (let j = 0; j < b.length; j += 2)
            m = Math.min(m, seg(b[j], b[j + 1], a));
        return m;
    };
    const keep = g.s.map(() => true);
    // самый длинный штрих — основа буквы; к ней цепляем всё, что ближе 0,25 x-высоты (и так далее по цепочке)
    const main = info.reduce((b, c, i) => (c.len > info[b].len ? i : b), 0);
    const core = new Set([main]);
    for (let grow = true; grow;) {
        grow = false;
        g.s.forEach((st, i) => {
            if (core.has(i))
                return;
            if ([...core].some((j) => dist(st, g.s[j]) <= xh * 0.25)) {
                core.add(i);
                grow = true;
            }
        });
    }
    g.s.forEach((st, i) => {
        if (i === main)
            return;
        const f = info[i];
        const others = g.s.filter((_, j) => j !== i && keep[j]);
        if (!others.length)
            return;
        const ox0 = Math.min(...info.filter((_, j) => j !== i && keep[j]).map((o) => o.x0));
        const ox1 = Math.max(...info.filter((_, j) => j !== i && keep[j]).map((o) => o.x1));
        const flat = f.y1 - f.y0 < xh * 0.1 && f.x1 - f.x0 > f.len * 0.85;
        // выше 2,4 x-высоты не поднимается ни одна буква (кратка у Й — ниже): это подпись или линия соседней клетки
        if (f.y0 > xh * 2.4) {
            keep[i] = false;
            return;
        }
        // направляющая: ровная горизонталь на уровне печатной линии, далеко торчит за букву (перекладина Т — выше)
        const onGuide = Math.abs(f.y0) < xh * 0.15 || f.y0 > xh * 1.9 || f.y1 < -xh * 0.3;
        if (flat && onGuide && f.len > xh * 0.8 && (f.x0 < ox0 - xh * 0.5 || f.x1 > ox1 + xh * 0.5)) {
            keep[i] = false;
            return;
        }
        if (HAS_MARKS.has(ch))
            return;
        // до основы буквы, а не до соседнего обрывка: два кусочка пунктира рядом друг друга не спасают
        const d = core.has(i) ? 0 : Math.min(...[...core].map((j) => dist(st, g.s[j])));
        if ((f.len < xh * 0.45 && d > xh * 0.25) || (flat && f.len < xh * 0.8 && d > xh * 0.3))
            keep[i] = false;
        // подпись клетки (серая буква в углу) — над прописными или под хвостами, отдельно от буквы
        else if (f.len < xh * 1.2 && d > xh * 0.3 && (f.y0 > xh * 1.75 || f.y1 < -xh * 1.1))
            keep[i] = false;
    });
    if (keep.every(Boolean))
        return g;
    const out = { ...g, s: g.s.filter((_, i) => keep[i]) };
    if (g.oi !== undefined) {
        if (!keep[g.oi])
            delete out.oi;
        else
            out.oi = keep.slice(0, g.oi).filter(Boolean).length;
    }
    // ширина буквы считалась вместе с мусором — без него буква уже, иначе в слове останется дыра
    const ox0 = Math.min(...info.map((f) => f.x0)), ox1 = Math.max(...info.map((f) => f.x1));
    const k = info.filter((_, i) => keep[i]);
    const nx0 = Math.min(...k.map((f) => f.x0)), nx1 = Math.max(...k.map((f) => f.x1));
    const dx = nx0 - ox0;
    if (dx > 0.5 || ox1 - nx1 > 0.5) {
        const r = (v) => Math.round(v * 10) / 10;
        out.s = out.s.map((st) => st.map((v, j) => (j % 2 ? v : r(v - dx))));
        out.w = r(Math.max(1, g.w - dx - (ox1 - nx1)));
        if (out.i)
            out.i = [r(out.i[0] - dx), out.i[1]];
        if (out.o)
            out.o = [r(out.o[0] - dx), out.o[1]];
    }
    return out;
}
function prepareGlyph(g, ch) {
    if (/\p{L}/u.test(ch))
        g = dropBaselineSpecks(g, CUSTOM_X_HEIGHT);
    if (/[\p{L}\p{N}]/u.test(ch))
        g = dropStrays(g, CUSTOM_X_HEIGHT, ch);
    // у снятых с шаблона букв уже есть точки входа/выхода и порядок штрихов — их не трогаем
    if (g.i || g.o)
        return g;
    // сначала касающиеся концы, потом разрывы до 0,22 x-высоты, если линия идёт дальше в ту же сторону
    // (на фото направляющая «разрезает» штрих — так у «е» отрывался хвостик)
    const s = g.s.length > 1 ? mergeTouching(mergeTouching(g.s, CUSTOM_X_HEIGHT * 0.1), CUSTOM_X_HEIGHT * 0.22, 0.6) : g.s;
    const m = s === g.s ? g : { ...g, s };
    return /\p{Ll}/u.test(ch) ? autoJoin(m, CUSTOM_X_HEIGHT) : m;
}
/**
 * Запасной шрифт «от руки»: цифры и знаки ГОСТа рядом с живым почерком выглядят как напечатанные.
 * Каждый знак получает 4 варианта с плавным изгибом и своей шириной — ровнее не бывает и у руки.
 */
const handCache = new Map();
export function handFallback(base) {
    const hit = handCache.get(base.id);
    if (hit)
        return hit;
    const glyphs = new Map();
    for (const [ch, vs] of base.glyphs) {
        if (!vs.length)
            continue;
        const seed = [...ch].reduce((a, c) => a * 31 + c.codePointAt(0), 7);
        glyphs.set(ch, [0, 1, 2, 3].map((k) => deformGlyph(vs[0], base.xHeight, seed * 5 + k, 1.8)));
    }
    // точка и запятая в чертёжном шрифте — крошечные: в «2,5» запятая пропадает. От руки они крупнее
    const X = base.xHeight;
    const dot = (cx, cy, r = 0.06) => [cx - r * X, cy, cx, cy + r * X, cx + r * X, cy, cx, cy - r * X, cx - r * X * 0.8, cy].map((v) => Math.round(v * 10) / 10);
    const comma = (cx) => [cx + 0.04 * X, 0.08 * X, cx + 0.02 * X, -0.06 * X, cx - 0.08 * X, -0.32 * X].map((v) => Math.round(v * 10) / 10);
    const P = {
        ',': { w: 0.32 * X, s: [comma(0.16 * X)] },
        '.': { w: 0.3 * X, s: [dot(0.13 * X, 0.05 * X)] },
        '·': { w: 0.32 * X, s: [dot(0.16 * X, 0.48 * X)] },
        ':': { w: 0.3 * X, s: [dot(0.13 * X, 0.05 * X), dot(0.13 * X, 0.72 * X)] },
        ';': { w: 0.32 * X, s: [dot(0.16 * X, 0.72 * X), comma(0.16 * X)] },
    };
    for (const [ch, g] of Object.entries(P))
        glyphs.set(ch, [g]);
    const f = { ...base, id: base.id + '-hand', glyphs };
    handCache.set(base.id, f);
    return f;
}
/** Латинские буквы, которые пишутся как русские: K₁, T₁, A, B… в формулах — своим почерком. */
const LOOKALIKE = {
    // прописные Т, Н, Р у руки часто с росчерками и в формуле не читаются — их берём из запасного шрифта
    A: 'А', B: 'В', C: 'С', E: 'Е', K: 'К', M: 'М', O: 'О', X: 'Х',
    a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у',
};
/** Пользовательский шрифт. Недостающие символы берутся из базового (масштабируются под xHeight). */
export function fromCustom(rec, all = BUILTIN_FONTS) {
    const base = all.find((f) => f.id === rec.baseFontId) ?? BUILTIN_FONTS[0];
    const glyphs = new Map();
    for (const [ch, vs] of Object.entries(rec.glyphs))
        if (vs.length)
            glyphs.set(ch, dropOutliers(vs.map((g) => prepareGlyph(g, ch))));
    // казахские буквы, ё и √ — достраиваем из своих же букв, чтобы стиль не смешивался
    const metrics = { xHeight: CUSTOM_X_HEIGHT, capHeight: CUSTOM_X_HEIGHT * (base.capHeight / base.xHeight), descender: CUSTOM_X_HEIGHT * (base.descender / base.xHeight) };
    synthesizeKazakh(glyphs, metrics);
    for (const [lat, cyr] of Object.entries(LOOKALIKE))
        if (!glyphs.has(lat) && glyphs.has(cyr))
            glyphs.set(lat, glyphs.get(cyr));
    return {
        id: rec.id,
        name: rec.name,
        builtin: false,
        xHeight: CUSTOM_X_HEIGHT,
        capHeight: CUSTOM_X_HEIGHT * (base.capHeight / base.xHeight),
        descender: CUSTOM_X_HEIGHT * (base.descender / base.xHeight),
        letterSpacing: rec.letterSpacing,
        wordSpacing: rec.wordSpacing,
        glyphs,
        fallback: handFallback(base),
    };
}
/** Найти глиф с учётом запасного шрифта. variant — номер варианта (берётся по модулю). */
// Знаки, которых часто нет в рукописных шрифтах, а в конспектах они есть (стрелки, ≈, ≤ …).
// Единицы: x-высота = 100, y вверх от базовой линии.
const SYMBOLS = {
    '→': { w: 120, s: [[5, 50, 110, 50], [80, 72, 112, 50, 80, 28]] },
    '←': { w: 120, s: [[115, 50, 10, 50], [40, 72, 8, 50, 40, 28]] },
    '↔': { w: 140, s: [[8, 50, 132, 50], [38, 72, 6, 50, 38, 28], [102, 72, 134, 50, 102, 28]] },
    '↑': { w: 70, s: [[35, -5, 35, 120], [12, 92, 35, 122, 58, 92]] },
    '↓': { w: 70, s: [[35, 120, 35, -5], [12, 25, 35, -7, 58, 25]] },
    '⇒': { w: 130, s: [[5, 64, 100, 64], [5, 36, 100, 36], [86, 84, 122, 50, 86, 16]] },
    '≈': { w: 100, s: [[8, 60, 25, 72, 50, 62, 75, 52, 92, 64], [8, 30, 25, 42, 50, 32, 75, 22, 92, 34]] },
    '≠': { w: 100, s: [[10, 64, 90, 64], [10, 36, 90, 36], [70, 92, 30, 8]] },
    '≤': { w: 100, s: [[88, 96, 12, 66, 88, 36], [12, 14, 88, 14]] },
    '≥': { w: 100, s: [[12, 96, 88, 66, 12, 36], [12, 14, 88, 14]] },
    '±': { w: 100, s: [[50, 95, 50, 35], [15, 65, 85, 65], [15, 12, 85, 12]] },
    '×': { w: 90, s: [[15, 80, 75, 20], [15, 20, 75, 80]] },
    '∞': { w: 140, s: [[70, 50, 50, 75, 22, 72, 10, 50, 22, 28, 50, 25, 70, 50, 90, 75, 118, 72, 130, 50, 118, 28, 90, 25, 70, 50]] },
    '°': { w: 60, s: [[30, 150, 18, 140, 18, 124, 30, 114, 42, 124, 42, 140, 30, 150]] },
    '·': { w: 50, s: [[20, 50, 25, 56, 30, 50, 25, 44, 20, 50]] },
    '•': { w: 60, s: [[22, 50, 30, 58, 38, 50, 30, 42, 22, 50]] },
    '…': { w: 120, s: [[18, 2, 20, 4], [58, 2, 60, 4], [98, 2, 100, 4]] },
};
export function resolveGlyph(font, ch, variant = 0) {
    let vs = font.glyphs.get(ch);
    if (vs?.length)
        return { glyph: vs[variant % vs.length], k: 1, variants: vs.length, missing: false };
    if (font.fallback) {
        const r = resolveGlyph(font.fallback, ch, variant);
        return { ...r, k: r.k * (font.xHeight / font.fallback.xHeight) };
    }
    const sym = SYMBOLS[ch];
    if (sym) {
        const k = font.xHeight / 100;
        return { glyph: { w: sym.w * k, s: sym.s.map((st) => st.map((v) => v * k)) }, k: 1, variants: 1, missing: false };
    }
    // строчная/прописная замена, затем «?»
    const alt = ch.toLowerCase() !== ch ? ch.toLowerCase() : ch.toUpperCase();
    vs = font.glyphs.get(alt);
    if (vs?.length)
        return { glyph: vs[0], k: 1, variants: 1, missing: true };
    vs = font.glyphs.get('?');
    return { glyph: vs?.[0] ?? { w: font.xHeight * 0.6, s: [] }, k: 1, variants: 1, missing: true };
}
