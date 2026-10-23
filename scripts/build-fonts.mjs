// Конвертирует однолинейные шрифты LibreCAD (.lff) из fonts-src/ в модули src/fonts/data/*.ts.
// Запуск: node scripts/build-fonts.mjs
// Дуги (bulge) превращаются в ломаные, координаты сдвигаются так, чтобы базовая линия была y = 0.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const FONTS = [
  { file: 'lc_opengost-ar.lff', id: 'gost-a', name: 'ГОСТ тип А (узкий)', out: 'gostA.ts' },
  { file: 'lc_opengost-br.lff', id: 'gost-b', name: 'ГОСТ тип Б (широкий)', out: 'gostB.ts' },
];

const ARC_STEP = Math.PI / 16; // ~11° на сегмент дуги

function arcPoints(p1, p2, bulge) {
  const theta = 4 * Math.atan(bulge);
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const c = Math.hypot(dx, dy);
  if (c < 1e-9 || Math.abs(bulge) < 1e-9) return [p2];
  const r = (c * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const s = (Math.abs(bulge) * c) / 2;
  const h = r - s;
  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;
  const lx = -dy / c;
  const ly = dx / c;
  const sign = bulge > 0 ? 1 : -1;
  const cx = mx + lx * h * sign;
  const cy = my + ly * h * sign;
  const a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
  const n = Math.max(2, Math.ceil(Math.abs(theta) / ARC_STEP));
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const a = a1 + (theta * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  pts[pts.length - 1] = [p2[0], p2[1]];
  return pts;
}

function parseLff(text) {
  const header = {};
  const glyphs = new Map(); // codepoint -> { lines: string[] }
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      const m = line.match(/^#\s*([A-Za-z]+):\s*(.*)$/);
      if (m) header[m[1]] = m[2].trim();
      continue;
    }
    const g = line.match(/^\[([0-9a-fA-F]+)\]/);
    if (g) {
      cur = { cp: parseInt(g[1], 16), lines: [] };
      glyphs.set(cur.cp, cur);
      continue;
    }
    if (!line || !cur) continue;
    cur.lines.push(line);
  }
  return { header, glyphs };
}

function resolveGlyph(glyphs, cp, depth = 0) {
  const g = glyphs.get(cp);
  if (!g || depth > 4) return [];
  const strokes = [];
  for (const line of g.lines) {
    if (line.startsWith('C')) {
      strokes.push(...resolveGlyph(glyphs, parseInt(line.slice(1), 16), depth + 1));
      continue;
    }
    const pts = [];
    for (const part of line.split(';')) {
      const fields = part.split(',');
      if (fields.length < 2) continue;
      const p = [parseFloat(fields[0]), parseFloat(fields[1])];
      const arc = fields.find((f) => f.startsWith('A'));
      if (arc && pts.length) pts.push(...arcPoints(pts[pts.length - 1], p, parseFloat(arc.slice(1))));
      else pts.push(p);
    }
    if (pts.length === 1) pts.push([pts[0][0] + 0.05, pts[0][1]]); // точка → крошечный штрих
    if (pts.length >= 2) strokes.push(pts);
  }
  return strokes;
}

const round = (v) => Math.round(v * 1000) / 1000;

mkdirSync(join(root, 'src/fonts/data'), { recursive: true });

for (const f of FONTS) {
  const { header, glyphs } = parseLff(readFileSync(join(root, 'fonts-src', f.file), 'utf8'));
  const resolved = new Map();
  for (const cp of glyphs.keys()) resolved.set(cp, resolveGlyph(glyphs, cp));
  const yRange = (cp) => {
    const ys = (resolved.get(cp) || []).flat().map((p) => p[1]);
    return [Math.min(...ys), Math.max(...ys)];
  };
  const [base, xTop] = yRange(0x43d); // «н»
  const [, capTop] = yRange(0x41d); // «Н»
  const [descMin] = yRange(0x443); // «у»
  const letterSpacing = parseFloat(header.LetterSpacing || '3');
  const wordSpacing = parseFloat(header.WordSpacing || '6');
  const out = {};
  for (const [cp, strokes] of resolved) {
    if (cp < 32) continue;
    const ch = String.fromCodePoint(cp);
    const xs = strokes.flat().map((p) => p[0]);
    const minX = xs.length ? Math.min(...xs) : 0;
    const maxX = xs.length ? Math.max(...xs) : 0;
    const shift = minX < 0 ? -minX : 0;
    out[ch] = {
      w: round(maxX + shift),
      s: strokes.map((st) => st.flatMap((p) => [round(p[0] + shift), round(p[1] - base)])),
    };
  }
  const font = {
    id: f.id,
    name: f.name,
    source: 'OpenGOST (LibreCAD ' + f.file + ')',
    license: 'SIL OFL 1.1',
    xHeight: round(xTop - base),
    capHeight: round(capTop - base),
    descender: round(base - descMin),
    letterSpacing,
    wordSpacing,
    glyphs: out,
  };
  const body =
    `// Сгенерировано scripts/build-fonts.mjs из fonts-src/${f.file}. Не править вручную.\n` +
    `// Шрифт: ${font.source}, лицензия ${font.license} (см. fonts-src/OFL-1.1.txt).\n` +
    `import type { FontData } from '../types.ts';\n\n` +
    `const font: FontData = ${JSON.stringify(font)};\n\nexport default font;\n`;
  writeFileSync(join(root, 'src/fonts/data', f.out), body);
  console.log(f.out, Object.keys(out).length, 'глифов, x-height', font.xHeight, 'cap', font.capHeight);
}
