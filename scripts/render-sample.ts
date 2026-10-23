// Рисует пример вёрстки в SVG для визуальной проверки: node scripts/render-sample.ts out.svg [шрифт 0|1] [живость]
import { writeFileSync } from 'node:fs';
import { BUILTIN_FONTS } from '../src/fonts/fonts.ts';
import { layoutText } from '../src/core/layout.ts';
import type { PaperSettings, TypographySettings } from '../src/core/types.ts';

const paper: PaperSettings = { template: 'grid', width: 170, height: 205, marginTop: 10, marginBottom: 8, marginLeft: 8, marginRight: 25, blankLineStep: 9, cell: 5, gridLineCells: 2, rulePitch: 8, side: 'right', rotate180: false, startLine: 1 };
const fontIdx = Number(process.argv[3] ?? 0);
const live = Number(process.argv[4] ?? 3);
const typo: TypographySettings = { fontId: 'gost-a', xHeight: 3.2, slant: 12, letterSpacing: 1, wordSpacing: 1, align: 'justify', hyphenate: true, indent: 10, liveliness: live, seed: 7 };
const text = `# Законы Ньютона
Первый закон: существуют такие системы отсчёта, относительно которых тело сохраняет состояние покоя или равномерного прямолинейного движения, если на него не действуют другие тела.
Второй закон: F = ma, ускорение a_1 = F/m, энергия E = mc^2, __подчёркнутый текст__.
Қазақ тілі: әліппе, ғылым, қала, өнер, ұлт, үй, һ, іс. Ёжик, ЪЫЬЭЮЯ, 0123456789 «№» — ?!`;
const res = layoutText({ text, font: BUILTIN_FONTS[fontIdx], typo, paper });
const pg = res.pages[0];
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${paper.width} ${paper.height}" width="${paper.width * 5}" height="${paper.height * 5}"><rect width="100%" height="100%" fill="#fff"/>`;
for (let x = 0; x <= paper.width; x += 5) svg += `<line x1="${x}" y1="0" x2="${x}" y2="${paper.height}" stroke="#cde" stroke-width="0.1"/>`;
for (let y = 0; y <= paper.height; y += 5) svg += `<line x1="0" y1="${y}" x2="${paper.width}" y2="${y}" stroke="#cde" stroke-width="0.1"/>`;
for (const s of pg.strokes) {
  const d = [];
  for (let i = 0; i < s.pts.length; i += 2) d.push(`${s.pts[i].toFixed(2)},${s.pts[i + 1].toFixed(2)}`);
  svg += `<polyline points="${d.join(' ')}" fill="none" stroke="#1a3a8a" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round"/>`;
}
svg += '</svg>';
writeFileSync(process.argv[2] ?? 'sample.svg', svg);
console.log('pages', res.pages.length, 'strokes', pg.strokes.length, 'missing', res.missingChars.join(''), 'lines', pg.usedLines, '/', pg.totalLines);
