import type { FontData, StrokeFont, CustomFontRecord, GlyphData } from './types.ts';
import gostA from './data/gostA.ts';
import gostB from './data/gostB.ts';
import { synthesizeKazakh } from './kazakh.ts';

function fromData(d: FontData): StrokeFont {
  const glyphs = new Map<string, GlyphData[]>();
  for (const [ch, g] of Object.entries(d.glyphs)) glyphs.set(ch, [g]);
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

export const BUILTIN_FONTS: StrokeFont[] = [fromData(gostA), fromData(gostB)];

export const CUSTOM_X_HEIGHT = 100;

/** Пользовательский шрифт. Недостающие символы берутся из базового (масштабируются под xHeight). */
export function fromCustom(rec: CustomFontRecord, all: StrokeFont[] = BUILTIN_FONTS): StrokeFont {
  const base = all.find((f) => f.id === rec.baseFontId) ?? BUILTIN_FONTS[0];
  const glyphs = new Map<string, GlyphData[]>();
  for (const [ch, vs] of Object.entries(rec.glyphs)) if (vs.length) glyphs.set(ch, vs);
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

export interface ResolvedGlyph {
  glyph: GlyphData;
  /** множитель перевода единиц исходного шрифта в единицы основного шрифта */
  k: number;
  variants: number;
  missing: boolean;
}

/** Найти глиф с учётом запасного шрифта. variant — номер варианта (берётся по модулю). */
export function resolveGlyph(font: StrokeFont, ch: string, variant = 0): ResolvedGlyph {
  let vs = font.glyphs.get(ch);
  if (vs?.length) return { glyph: vs[variant % vs.length], k: 1, variants: vs.length, missing: false };
  if (font.fallback) {
    const r = resolveGlyph(font.fallback, ch, variant);
    return { ...r, k: r.k * (font.xHeight / font.fallback.xHeight) };
  }
  // строчная/прописная замена, затем «?»
  const alt = ch.toLowerCase() !== ch ? ch.toLowerCase() : ch.toUpperCase();
  vs = font.glyphs.get(alt);
  if (vs?.length) return { glyph: vs[0], k: 1, variants: 1, missing: true };
  vs = font.glyphs.get('?');
  return { glyph: vs?.[0] ?? { w: font.xHeight * 0.6, s: [] }, k: 1, variants: 1, missing: true };
}
