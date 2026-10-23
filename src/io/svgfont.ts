// Импорт однолинейного SVG-шрифта (форматы Hershey Text / EMS для Inkscape) в «свой» шрифт Plotterm.
import type { CustomFontRecord, GlyphData } from '../fonts/types.ts';
import { CUSTOM_X_HEIGHT } from '../fonts/fonts.ts';

export function importSvgFont(text: string, fallbackName: string): CustomFontRecord {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const font = doc.querySelector('font');
  const face = doc.querySelector('font-face');
  if (!font || !face) throw new Error('в файле нет SVG-шрифта (<font>)');
  const upm = parseFloat(face.getAttribute('units-per-em') ?? '1000');
  const xh = parseFloat(face.getAttribute('x-height') ?? '') || upm * 0.5;
  const k = CUSTOM_X_HEIGHT / xh;
  const defAdv = parseFloat(font.getAttribute('horiz-adv-x') ?? String(upm * 0.6));
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.setAttribute('style', 'position:absolute;left:-10000px;visibility:hidden');
  document.body.appendChild(host);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  host.appendChild(path);
  const glyphs: Record<string, GlyphData[]> = {};
  let spaceAdv = defAdv * 0.5;
  try {
    for (const g of Array.from(doc.querySelectorAll('glyph'))) {
      const u = g.getAttribute('unicode');
      if (!u || [...u].length !== 1) continue;
      const adv = parseFloat(g.getAttribute('horiz-adv-x') ?? String(defAdv));
      if (u === ' ') { spaceAdv = adv; continue; }
      const d = g.getAttribute('d');
      if (!d) continue;
      path.setAttribute('d', d);
      const len = path.getTotalLength();
      if (!(len > 0)) continue;
      const step = Math.max(len / 400, xh / 60);
      const n = Math.ceil(len / step);
      const strokes: number[][] = [];
      let cur: number[] = [];
      let prev: DOMPoint | null = null;
      for (let i = 0; i <= n; i++) {
        const p = path.getPointAtLength((len * i) / n);
        if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > step * 3) {
          if (cur.length >= 4) strokes.push(cur);
          cur = [];
        }
        cur.push(Math.round(p.x * k * 10) / 10, Math.round(p.y * k * 10) / 10);
        prev = p;
      }
      if (cur.length >= 4) strokes.push(cur);
      if (!strokes.length) continue;
      const xs = strokes.flat().filter((_, i) => i % 2 === 0);
      const minX = Math.min(...xs);
      glyphs[u] = [{ w: Math.max(...xs) - minX, s: strokes.map((s) => s.map((v, i) => (i % 2 === 0 ? v - minX : v))) }];
    }
  } finally {
    host.remove();
  }
  if (!Object.keys(glyphs).length) throw new Error('в шрифте нет глифов');
  const name = face.getAttribute('font-family') ?? fallbackName;
  return {
    id: 'custom-' + Date.now().toString(36),
    name,
    baseFontId: 'gost-a',
    glyphs,
    letterSpacing: Math.round(defAdv * k * 0.12),
    wordSpacing: Math.round(spaceAdv * k),
    updatedAt: Date.now(),
  };
}
