import gostA from "./data/gostA.js";
import gostB from "./data/gostB.js";
import propis from "./data/propis.js";
import { synthesizeKazakh } from "./kazakh.js";
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
/** Пользовательский шрифт. Недостающие символы берутся из базового (масштабируются под xHeight). */
export function fromCustom(rec, all = BUILTIN_FONTS) {
    const base = all.find((f) => f.id === rec.baseFontId) ?? BUILTIN_FONTS[0];
    const glyphs = new Map();
    for (const [ch, vs] of Object.entries(rec.glyphs))
        if (vs.length)
            glyphs.set(ch, vs);
    // казахские буквы, ё и √ — достраиваем из своих же букв, чтобы стиль не смешивался
    const metrics = { xHeight: CUSTOM_X_HEIGHT, capHeight: CUSTOM_X_HEIGHT * (base.capHeight / base.xHeight), descender: CUSTOM_X_HEIGHT * (base.descender / base.xHeight) };
    synthesizeKazakh(glyphs, metrics);
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
        fallback: base,
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
