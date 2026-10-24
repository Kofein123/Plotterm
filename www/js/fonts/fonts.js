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
const propisFont = fromData(propis);
export const BUILTIN_FONTS = [fromData(gostA), fromData(gostB), propisFont];
// В прописи пока только строчные а–я: заглавные, цифры и знаки берём из ГОСТ тип Б.
propisFont.fallback = BUILTIN_FONTS[1];
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
export function resolveGlyph(font, ch, variant = 0) {
    let vs = font.glyphs.get(ch);
    if (vs?.length)
        return { glyph: vs[variant % vs.length], k: 1, variants: vs.length, missing: false };
    if (font.fallback) {
        const r = resolveGlyph(font.fallback, ch, variant);
        return { ...r, k: r.k * (font.xHeight / font.fallback.xHeight) };
    }
    // строчная/прописная замена, затем «?»
    const alt = ch.toLowerCase() !== ch ? ch.toLowerCase() : ch.toUpperCase();
    vs = font.glyphs.get(alt);
    if (vs?.length)
        return { glyph: vs[0], k: 1, variants: 1, missing: true };
    vs = font.glyphs.get('?');
    return { glyph: vs?.[0] ?? { w: font.xHeight * 0.6, s: [] }, k: 1, variants: 1, missing: true };
}
