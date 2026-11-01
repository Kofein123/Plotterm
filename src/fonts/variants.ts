// Варианты букв из одного начертания: у шрифта (.ttf) каждая «а» одинаковая, а рука так не пишет.
// Каждый вариант — та же буква, чуть иначе: своя ширина, наклон и плавный «изгиб» всей формы
// (сумма двух длинных волн, ~5 % x-высоты), так что буква узнаётся, но копии не совпадают.
import type { GlyphData } from './types.ts';
import { rng } from '../core/rng.ts';

/** шаг передискретизации, ед. шрифта: волна изгибает длинные прямые только если на них есть точки */
const STEP = 8;

function resample(s: number[]): number[] {
  const out = [s[0], s[1]];
  for (let i = 2; i < s.length; i += 2) {
    const x0 = s[i - 2], y0 = s[i - 1], x1 = s[i], y1 = s[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / STEP));
    for (let k = 1; k <= n; k++) out.push(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
  }
  return out;
}

/**
 * Новый вариант буквы. `xHeight` — x-высота шрифта (масштаб изгиба), `seed` — номер варианта:
 * одно зерно — тот же результат, чтобы варианты не менялись при каждой загрузке.
 */
export function deformGlyph(g: GlyphData, xHeight: number, seed: number, strength = 1): GlyphData {
  const r = rng(seed);
  const amp = xHeight * 0.05 * strength;
  const sx = 1 + r.sym() * 0.06 * strength;
  const sy = 1 + r.sym() * 0.035 * strength;
  const shear = r.sym() * 0.05 * strength;
  const waves = [0, 1].map(() => ({
    kx: (Math.PI * 2) / (xHeight * r.range(0.9, 1.8)),
    ky: (Math.PI * 2) / (xHeight * r.range(0.9, 1.8)),
    px: r.next() * Math.PI * 2,
    py: r.next() * Math.PI * 2,
    ax: amp * r.range(0.4, 1),
    ay: amp * r.range(0.4, 1),
  }));
  const map = (x: number, y: number): [number, number] => {
    let dx = 0, dy = 0;
    for (const w of waves) {
      dx += w.ax * Math.sin(y * w.ky + w.px);
      dy += w.ay * Math.sin(x * w.kx + w.py);
    }
    return [(x + dx) * sx + y * shear, (y + dy) * sy];
  };
  const s = g.s.map((st) => {
    const src = st.length >= 4 ? resample(st) : st;
    const out: number[] = new Array(src.length);
    for (let i = 0; i < src.length; i += 2) {
      const [x, y] = map(src[i], src[i + 1]);
      out[i] = Math.round(x * 10) / 10;
      out[i + 1] = Math.round(y * 10) / 10;
    }
    return out;
  });
  let minX = Infinity, maxX = -Infinity;
  for (const st of s) for (let i = 0; i < st.length; i += 2) { minX = Math.min(minX, st[i]); maxX = Math.max(maxX, st[i]); }
  // ширину держим как у исходной, с той же поправкой, что и форму: буква не съезжает влево-вправо
  const shift = Number.isFinite(minX) ? -Math.min(0, minX) : 0;
  if (shift) for (const st of s) for (let i = 0; i < st.length; i += 2) st[i] += shift;
  const out: GlyphData = { w: Math.round(Math.max(g.w * sx, Number.isFinite(maxX) ? maxX + shift : 0) * 10) / 10, s };
  if (g.i) { const [x, y] = map(g.i[0], g.i[1]); out.i = [x + shift, y]; }
  if (g.o) { const [x, y] = map(g.o[0], g.o[1]); out.o = [x + shift, y]; }
  return out;
}

/** Довести число вариантов каждой буквы до `count`: недостающие — изгибы первого (своего) начертания. */
export function addVariants(glyphs: Record<string, GlyphData[]>, xHeight: number, count: number): { glyphs: Record<string, GlyphData[]>; added: number } {
  const res: Record<string, GlyphData[]> = {};
  let added = 0;
  for (const [ch, vs] of Object.entries(glyphs)) {
    const list = [...vs];
    const base = vs.length;
    for (let k = base; k < count && base > 0; k++) {
      // точки, тире и пробелы искажать незачем
      if (!/[\p{L}\p{N}]/u.test(ch)) break;
      list.push(deformGlyph(vs[k % base], xHeight, ch.codePointAt(0)! * 131 + k * 7919));
      added++;
    }
    res[ch] = list;
  }
  return { glyphs: res, added };
}
