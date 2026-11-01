import type { FontData, StrokeFont, CustomFontRecord, GlyphData } from './types.ts';
import gostA from './data/gostA.ts';
import gostB from './data/gostB.ts';
import propis from './data/propis.ts';
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

/** Дополняет шрифт недостающими глифами из базового, пересчитывая их под его высоту. */
function fillMissing(f: StrokeFont, base: StrokeFont): StrokeFont {
  const k = f.xHeight / base.xHeight;
  for (const [ch, vs] of base.glyphs) {
    if (f.glyphs.has(ch)) continue;
    f.glyphs.set(
      ch,
      vs.map((g) => ({ w: g.w * k, s: g.s.map((st) => st.map((v) => v * k)) })),
    );
  }
  return f;
}

const gostAFont: StrokeFont = fromData(gostA);
const gostBFont: StrokeFont = fromData(gostB);
// В прописи нарисованы только строчные а–я: заглавные, цифры и знаки берём из ГОСТ тип Б.
// У них нет точек входа и выхода, поэтому они пишутся раздельно — как печатные от руки.
const propisFont: StrokeFont = fillMissing(fromData(propis), gostBFont);

export const BUILTIN_FONTS: StrokeFont[] = [gostAFont, gostBFont, propisFont];

export const CUSTOM_X_HEIGHT = 100;

/**
 * Точки входа и выхода для буквы без них (шрифты из .ttf): вход — самый левый конец штриха внизу буквы,
 * выход — самый правый. Буква соединяется с соседями, как в прописи, и слово пишется почти без подъёмов ручки.
 * Если вход и выход у разных штрихов, хвостик выхода ставится последним (oi) и начинает связку к следующей букве.
 */
export function autoJoin(g: GlyphData, xHeight: number): GlyphData {
  if (g.i || g.o || !g.s.length || g.w <= 0) return g;
  // выход — внизу справа (так рука уходит к следующей букве); вход — слева, на любой высоте до x-высоты:
  // связка поднимается к началу следующей буквы, как в прописи к «и», «м», «л»
  const lowY = (y: number) => y <= xHeight * 0.6 && y >= -xHeight * 0.15;
  const inY = (y: number) => y <= xHeight * 1.08 && y >= -xHeight * 0.15;
  let entry: { si: number; end: boolean; x: number; y: number } | null = null;
  let exit: { si: number; end: boolean; x: number; y: number } | null = null;
  g.s.forEach((st, si) => {
    if (st.length < 4) return;
    for (const end of [false, true]) {
      const x = end ? st[st.length - 2] : st[0];
      const y = end ? st[st.length - 1] : st[1];
      if (inY(y) && x <= g.w * 0.25 && (!entry || x < entry.x)) entry = { si, end, x, y };
      if (lowY(y) && x >= g.w * 0.8 && (!exit || x > exit.x)) exit = { si, end, x, y };
    }
  });
  const en = entry as { si: number; end: boolean; x: number; y: number } | null;
  const ex = exit as { si: number; end: boolean; x: number; y: number } | null;
  if (!en || !ex) return g;
  const rev = (st: number[]) => {
    const r: number[] = [];
    for (let i = st.length - 2; i >= 0; i -= 2) r.push(st[i], st[i + 1]);
    return r;
  };
  if (en.si === ex.si) {
    // один штрих: вход и выход на разных его концах
    if (en.end === ex.end) return g;
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
export function mergeTouching(strokes: number[][], tol: number): number[][] {
  const out = strokes.filter((s) => s.length >= 4).map((s) => s.slice());
  const rev = (st: number[]) => {
    const r: number[] = [];
    for (let i = st.length - 2; i >= 0; i -= 2) r.push(st[i], st[i + 1]);
    return r;
  };
  const dir = (st: number[], atEnd: boolean): [number, number] => {
    const n = st.length;
    const k = Math.min(n - 2, 6);
    const v: [number, number] = atEnd ? [st[n - 2] - st[n - 2 - k], st[n - 1] - st[n - 1 - k]] : [st[k] - st[0], st[k + 1] - st[1]];
    const l = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / l, v[1] / l];
  };
  for (let guard = 0; guard < 50; guard++) {
    let best: { i: number; j: number; ri: boolean; rj: boolean; cos: number } | null = null;
    for (let i = 0; i < out.length; i++)
      for (let j = 0; j < out.length; j++) {
        if (i === j) continue;
        for (const ri of [false, true])
          for (const rj of [false, true]) {
            const a = ri ? rev(out[i]) : out[i];
            const b = rj ? rev(out[j]) : out[j];
            if (Math.hypot(a[a.length - 2] - b[0], a[a.length - 1] - b[1]) > tol) continue;
            const da = dir(a, true), db = dir(b, false);
            const cos = da[0] * db[0] + da[1] * db[1];
            if (!best || cos > best.cos) best = { i, j, ri, rj, cos };
          }
      }
    if (!best) break;
    const a = best.ri ? rev(out[best.i]) : out[best.i];
    const b = best.rj ? rev(out[best.j]) : out[best.j];
    out[best.i] = a.concat(b.slice(2));
    out.splice(best.j, 1);
  }
  return out;
}

function prepareGlyph(g: GlyphData, ch: string): GlyphData {
  // у снятых с шаблона букв уже есть точки входа/выхода и порядок штрихов — их не трогаем
  if (g.i || g.o) return g;
  const s = g.s.length > 1 ? mergeTouching(g.s, CUSTOM_X_HEIGHT * 0.1) : g.s;
  const m = s === g.s ? g : { ...g, s };
  return /\p{Ll}/u.test(ch) ? autoJoin(m, CUSTOM_X_HEIGHT) : m;
}

/** Пользовательский шрифт. Недостающие символы берутся из базового (масштабируются под xHeight). */
export function fromCustom(rec: CustomFontRecord, all: StrokeFont[] = BUILTIN_FONTS): StrokeFont {
  const base = all.find((f) => f.id === rec.baseFontId) ?? BUILTIN_FONTS[0];
  const glyphs = new Map<string, GlyphData[]>();
  for (const [ch, vs] of Object.entries(rec.glyphs)) if (vs.length) glyphs.set(ch, vs.map((g) => prepareGlyph(g, ch)));
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

export interface ResolvedGlyph {
  glyph: GlyphData;
  /** множитель перевода единиц исходного шрифта в единицы основного шрифта */
  k: number;
  variants: number;
  missing: boolean;
}

/** Найти глиф с учётом запасного шрифта. variant — номер варианта (берётся по модулю). */
// Знаки, которых часто нет в рукописных шрифтах, а в конспектах они есть (стрелки, ≈, ≤ …).
// Единицы: x-высота = 100, y вверх от базовой линии.
const SYMBOLS: Record<string, GlyphData> = {
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

export function resolveGlyph(font: StrokeFont, ch: string, variant = 0): ResolvedGlyph {
  let vs = font.glyphs.get(ch);
  if (vs?.length) return { glyph: vs[variant % vs.length], k: 1, variants: vs.length, missing: false };
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
  if (vs?.length) return { glyph: vs[0], k: 1, variants: 1, missing: true };
  vs = font.glyphs.get('?');
  return { glyph: vs?.[0] ?? { w: font.xHeight * 0.6, s: [] }, k: 1, variants: 1, missing: true };
}
