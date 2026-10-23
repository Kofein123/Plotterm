// Достраивает казахские буквы (ә ғ қ ң ө ұ ү һ і) и √ из уже имеющихся глифов шрифта,
// если их нет в самом шрифте.
import type { GlyphData } from './types.ts';

type Glyphs = Map<string, GlyphData[]>;

interface Metrics {
  xHeight: number;
  capHeight: number;
  descender: number;
}

function bbox(g: GlyphData) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of g.s)
    for (let i = 0; i < s.length; i += 2) {
      minX = Math.min(minX, s[i]); maxX = Math.max(maxX, s[i]);
      minY = Math.min(minY, s[i + 1]); maxY = Math.max(maxY, s[i + 1]);
    }
  return { minX, minY, maxX, maxY };
}

function mapPts(g: GlyphData, f: (x: number, y: number) => [number, number]): GlyphData {
  return {
    w: g.w,
    s: g.s.map((s) => {
      const out: number[] = [];
      for (let i = 0; i < s.length; i += 2) out.push(...f(s[i], s[i + 1]));
      return out;
    }),
  };
}

function addStrokes(g: GlyphData, ...strokes: number[][]): GlyphData {
  return { w: g.w, s: [...g.s, ...strokes] };
}

/** Повернуть на 180° внутри рамки глифа (для ә из е). */
function rotate180(g: GlyphData, height: number): GlyphData {
  const b = bbox(g);
  return mapPts(g, (x, y) => [b.maxX + b.minX - x, height - y]);
}

function scaleTo(g: GlyphData, k: number): GlyphData {
  const r = mapPts(g, (x, y) => [x * k, y * k]);
  r.w = g.w * k;
  return r;
}

export function synthesizeKazakh(glyphs: Glyphs, m: Metrics) {
  const get = (c: string) => glyphs.get(c)?.[0];
  const put = (c: string, g: GlyphData | undefined) => {
    if (g && !glyphs.has(c)) glyphs.set(c, [g]);
  };
  const tail = (g: GlyphData, top: number) => {
    // хвостик-«крюк» справа внизу (қ, ң)
    const b = bbox(g);
    const d = Math.min(m.descender * 0.8, top * 0.28);
    return addStrokes(g, [b.maxX, 0, b.maxX + d * 0.25, 0, b.maxX + d * 0.25, -d]);
  };
  const bar = (g: GlyphData, y: number, x0: number, x1: number) => addStrokes(g, [x0, y, x1, y]);

  // ә, Ә — перевёрнутая е
  const e = get('е');
  if (e) {
    put('ә', rotate180(e, m.xHeight));
    put('Ә', scaleTo(rotate180(e, m.xHeight), m.capHeight / m.xHeight));
  }
  // ғ, Ғ — г с перекладиной
  for (const [src, dst, h] of [['г', 'ғ', m.xHeight], ['Г', 'Ғ', m.capHeight]] as const) {
    const g = get(src);
    if (g) {
      const b = bbox(g);
      put(dst, bar(g, h * 0.45, b.minX - h * 0.12, b.minX + h * 0.3));
    }
  }
  // қ Қ ң Ң — хвост
  for (const [src, dst, h] of [['к', 'қ', m.xHeight], ['К', 'Қ', m.capHeight], ['н', 'ң', m.xHeight], ['Н', 'Ң', m.capHeight]] as const) {
    const g = get(src);
    if (g) put(dst, tail(g, h));
  }
  // ө Ө — о с перекладиной
  for (const [src, dst, h] of [['о', 'ө', m.xHeight], ['О', 'Ө', m.capHeight]] as const) {
    const g = get(src);
    if (g) {
      const b = bbox(g);
      put(dst, bar(g, h * 0.5, b.minX, b.maxX));
    }
  }
  // ү Ү — прямая у: галочка и ствол; ұ Ұ — то же с перекладиной
  const makeStraightU = (h: number, w: number, desc: number): GlyphData => ({
    w,
    s: [[0, h, w / 2, h * 0.4, w, h], [w / 2, h * 0.4, w / 2, desc]],
  });
  const uw = get('у') ? bbox(get('у')!).maxX : m.xHeight * 0.6;
  const UW = get('У') ? bbox(get('У')!).maxX : m.capHeight * 0.6;
  const u = makeStraightU(m.xHeight, uw, -m.descender * 0.9);
  const U = makeStraightU(m.capHeight, UW, 0);
  put('ү', u);
  put('Ү', U);
  put('ұ', bar(u, -m.descender * 0.25, uw * 0.15, uw * 0.85));
  put('Ұ', bar(U, m.capHeight * 0.3, UW * 0.15, UW * 0.85));
  // һ Һ — как латинская h
  put('һ', get('h'));
  const H = get('h');
  if (H) put('Һ', scaleTo(H, m.capHeight / Math.max(bbox(H).maxY, 1e-6)));
  // і І — как латинские
  put('і', get('i'));
  put('І', get('I'));
  // ё без точек в шрифте? — е с точками
  if (!glyphs.has('ё') && e) {
    const b = bbox(e);
    const y = m.xHeight * 1.25;
    const d = m.xHeight * 0.07; // точка — короткий штрих
    const w = b.maxX - b.minX;
    put('ё', addStrokes(e, [b.minX + w * 0.28 - d / 2, y, b.minX + w * 0.28 + d / 2, y], [b.minX + w * 0.72 - d / 2, y, b.minX + w * 0.72 + d / 2, y]));
  }
  if (!glyphs.has('Ё')) {
    const E = get('Е');
    if (E) {
      const b = bbox(E);
      const y = m.capHeight * 1.15;
      const d = m.xHeight * 0.07;
      const w = b.maxX - b.minX;
      put('Ё', addStrokes(E, [b.minX + w * 0.3 - d / 2, y, b.minX + w * 0.3 + d / 2, y], [b.minX + w * 0.7 - d / 2, y, b.minX + w * 0.7 + d / 2, y]));
    }
  }
  // √
  if (!glyphs.has('√')) {
    const h = m.capHeight * 1.05;
    put('√', { w: m.xHeight * 0.9, s: [[0, m.xHeight * 0.45, m.xHeight * 0.18, m.xHeight * 0.55, m.xHeight * 0.4, 0, m.xHeight * 0.9, h, m.xHeight * 2.2, h]] });
  }
}
