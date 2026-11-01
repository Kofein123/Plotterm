// Эталонные страницы для оценки почерка: SVG + PNG + таблица метрик.
//   npm run sample                          — все тексты из samples/texts × шрифты gost-b и propis, тетрадь в клетку
//   npm run sample -- --font propis --text samples/texts/lecture-1.md --paper a4 --live 5 --seed 3 --all
// Результат — в samples/out/ (report.md, report.json, *.svg, *.png). PNG делается, если установлен playwright.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';
import { BUILTIN_FONTS } from '../src/fonts/fonts.ts';
import { layoutText } from '../src/core/layout.ts';
import { measureQuality, JOIN_KINK, type QualityReport } from '../src/core/quality.ts';
import type { PageLayout, PaperSettings, TypographySettings } from '../src/core/types.ts';

const PAPERS: Record<string, PaperSettings> = {
  // тетрадь 170×205 в клетку 5 мм, строка через клетку, поле справа
  grid: { template: 'grid', width: 170, height: 205, marginTop: 10, marginBottom: 8, marginLeft: 8, marginRight: 25, blankLineStep: 9, cell: 5, gridLineCells: 2, rulePitch: 8, side: 'right', rotate180: false, startLine: 1 },
  ruled: { template: 'ruled', width: 170, height: 205, marginTop: 10, marginBottom: 8, marginLeft: 8, marginRight: 25, blankLineStep: 9, cell: 5, gridLineCells: 2, rulePitch: 8, side: 'right', rotate180: false, startLine: 1 },
  a4: { template: 'a4', width: 210, height: 297, marginTop: 15, marginBottom: 15, marginLeft: 20, marginRight: 15, blankLineStep: 9, cell: 5, gridLineCells: 2, rulePitch: 8, side: 'right', rotate180: false, startLine: 1 },
};

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const fonts = opt('font', 'gost-b,propis').split(',');
const paperId = opt('paper', 'grid');
const paper = PAPERS[paperId];
if (!paper) throw new Error(`нет бумаги «${paperId}», есть: ${Object.keys(PAPERS).join(', ')}`);
const texts = args.includes('--text') ? [opt('text', '')] : readdirSync('samples/texts').sort().map((f) => join('samples/texts', f));
const allPages = args.includes('--all');
const outDir = opt('out', 'samples/out');
mkdirSync(outDir, { recursive: true });

const typoBase: TypographySettings = {
  fontId: '', xHeight: 3.2, slant: 12, letterSpacing: 1, wordSpacing: 1, align: 'justify', hyphenate: true,
  indent: 10, liveliness: Number(opt('live', '3')), seed: Number(opt('seed', '7')), cursive: true,
};

function pageSvg(pg: PageLayout): string {
  const { width: W, height: H } = paper;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 6}" height="${H * 6}"><rect width="100%" height="100%" fill="#fff"/>`;
  if (paper.template === 'grid') {
    for (let x = 0; x <= W; x += paper.cell) svg += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#cfe0ee" stroke-width="0.12"/>`;
    for (let y = 0; y <= H; y += paper.cell) svg += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#cfe0ee" stroke-width="0.12"/>`;
  } else if (paper.template === 'ruled') {
    for (let y = 0; y <= H; y += paper.rulePitch) svg += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#cfe0ee" stroke-width="0.15"/>`;
  }
  const fieldX = pg.mirrored ? paper.marginRight : W - paper.marginRight;
  svg += `<line x1="${fieldX}" y1="0" x2="${fieldX}" y2="${H}" stroke="#f3a0a0" stroke-width="0.2"/>`;
  for (const s of pg.strokes) {
    const d: string[] = [];
    for (let i = 0; i < s.pts.length; i += 2) d.push(`${s.pts[i].toFixed(2)},${s.pts[i + 1].toFixed(2)}`);
    svg += `<polyline points="${d.join(' ')}" fill="none" stroke="#1a3a8a" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return svg + '</svg>';
}

interface Row { name: string; font: string; pages: number; q: QualityReport; files: string[] }
const rows: Row[] = [];
for (const file of texts) {
  const text = readFileSync(file, 'utf8');
  for (const fontId of fonts) {
    const font = BUILTIN_FONTS.find((f) => f.id === fontId);
    if (!font) throw new Error(`нет шрифта «${fontId}», есть: ${BUILTIN_FONTS.map((f) => f.id).join(', ')}`);
    const typo = { ...typoBase, fontId };
    const res = layoutText({ text, font, typo, paper, trace: true });
    const q = measureQuality(res, paper, typo.xHeight);
    const name = `${basename(file).replace(/\.[^.]+$/, '')}-${fontId}`;
    const files: string[] = [];
    (allPages ? res.pages : res.pages.slice(0, 1)).forEach((pg, i) => {
      const f = join(outDir, `${name}${allPages ? '-p' + (i + 1) : ''}.svg`);
      writeFileSync(f, pageSvg(pg));
      files.push(f);
    });
    rows.push({ name, font: fontId, pages: res.pages.length, q, files });
  }
}

// PNG — через установленный playwright (Chromium); без него остаются SVG
let png = false;
try {
  // require, а не import: так находится и глобально установленный playwright (NODE_PATH)
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const r of rows)
    for (const f of r.files) {
      await page.setContent(`<body style="margin:0">${readFileSync(f, 'utf8')}</body>`);
      await page.locator('svg').screenshot({ path: f.replace(/\.svg$/, '.png') });
    }
  await browser.close();
  png = true;
} catch {
  console.log('PNG пропущены: нет playwright (npm i -D playwright && npx playwright install chromium)');
}

const pct = (x: number) => (x * 100).toFixed(0) + ' %';
const md = [
  `# Эталонные страницы`,
  ``,
  `Бумага: ${paperId}, x-высота ${typoBase.xHeight} мм, наклон ${typoBase.slant}°, живость ${typoBase.liveliness}, зерно ${typoBase.seed}.`,
  ``,
  `| Страница | Стр. | Разнообразие букв, % x-высоты | Разнообразие формы | Стыков | Излом ср./макс. | Стыков > ${JOIN_KINK}° | За полями | Нет в шрифте |`,
  `|---|---|---|---|---|---|---|---|---|`,
  ...rows.map((r) => `| ${r.name} | ${r.pages} | ${(r.q.variety * 100).toFixed(1)} | ${r.q.shapeVariety.toFixed(3)} | ${r.q.joins.count} | ${r.q.joins.mean.toFixed(0)}° / ${r.q.joins.max.toFixed(0)}° | ${pct(r.q.joins.kinked)} | ${r.q.outside} | ${r.q.missing.join('') || '—'} |`),
  ``,
  `«Разнообразие формы» — расстояние Прокруста между соседними экземплярами буквы (0 — та же форма, только повёрнута/увеличена).`,
  ``,
].join('\n');
writeFileSync(join(outDir, 'report.md'), md);
writeFileSync(join(outDir, 'report.json'), JSON.stringify(rows.map(({ files, ...r }) => r), null, 2));
console.log(md);
console.log(png ? `PNG и SVG: ${outDir}/` : `SVG: ${outDir}/`);
