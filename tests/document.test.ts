// Лекция из файла: разметка рисунков и таблиц, вёрстка, разбор PDF-строк, перевод картинки в линии.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_FONTS, resolveGlyph } from '../src/fonts/fonts.ts';
import { layoutText } from '../src/core/layout.ts';
import { parseMarkup } from '../src/core/markup.ts';
import { structure, imageBoxes, type TextItem } from '../src/io/document.ts';
import { vectorize } from '../src/io/vectorize.ts';
import type { PaperSettings, TypographySettings } from '../src/core/types.ts';

const paper: PaperSettings = { template: 'a4', width: 210, height: 297, marginTop: 15, marginBottom: 15, marginLeft: 20, marginRight: 15, blankLineStep: 9, cell: 5, gridLineCells: 2, rulePitch: 8, side: 'right', rotate180: false, startLine: 1 };
const typo: TypographySettings = { fontId: 'gost-a', xHeight: 3, slant: 10, letterSpacing: 1, wordSpacing: 1, align: 'left', hyphenate: true, indent: 10, liveliness: 2, seed: 1 };

const font = BUILTIN_FONTS[0];

test('разметка: рисунок с шириной и инструментом, подпись отдельной строкой', () => {
  const p = parseMarkup('![Рис. 1](img:a1 50% карандаш)\n![](img:b2 место)\n![](img:c3)');
  assert.deepEqual(p[0], { kind: 'image', id: 'a1', caption: 'Рис. 1', width: 0.5, tool: 'pencil' });
  assert.equal(p[1].kind, 'text');
  assert.deepEqual(p[2], { kind: 'image', id: 'b2', caption: '', width: 0.7, tool: 'space' });
  assert.deepEqual(p[3], { kind: 'image', id: 'c3', caption: '', width: 0.7, tool: 'pen' });
});

test('разметка: строки таблицы, разделитель Markdown пропускается', () => {
  const p = parseMarkup('| а | б |\n|---|---|\n| 1 | 2 |');
  assert.equal(p.length, 2);
  assert.equal(p[0].kind, 'row');
  if (p[0].kind === 'row') assert.equal(p[0].cells.length, 2);
});

test('вёрстка: рисунок занимает строки, карандашные штрихи помечены, «место» пустое', () => {
  const images = { r: { aspect: 0.5, paths: [[0, 0, 1, 0, 1, 0.5, 0, 0.5, 0, 0]] } };
  const run = (opt: string) => layoutText({ text: `до\n![](img:r 50%${opt})\nпосле`, font, typo, paper, images });
  const pen = run('');
  const pencil = run(' карандаш');
  const space = run(' место');
  const frame = pen.pages[0].strokes.filter((s) => s.line === 0);
  assert.equal(frame.length, 1);
  const xs = frame[0].pts.filter((_, i) => i % 2 === 0);
  const w = Math.max(...xs) - Math.min(...xs);
  assert.ok(Math.abs(w - (paper.width - paper.marginLeft - paper.marginRight) * 0.5) < 0.01, `${w}`);
  assert.equal(pencil.pages[0].strokes.filter((s) => s.tool === 'pencil').length, 1);
  assert.equal(space.pages[0].strokes.filter((s) => s.line === 0).length, 0);
  // «после» стоит ниже рисунка, одинаково при любом инструменте
  const lastLine = (r: typeof pen) => Math.max(...r.pages[0].strokes.map((s) => s.line));
  assert.equal(lastLine(pen), lastLine(space));
  assert.ok(lastLine(pen) >= 1 + Math.ceil((w * 0.5) / paper.blankLineStep));
});

test('вёрстка: таблица — рамка от руки, текст внутри ячеек', () => {
  const r = layoutText({ text: '| Термин | Определение длинное, переносится внутри ячейки по словам |\n| а | б |', font, typo: { ...typo, slant: 0 }, paper });
  const lines = r.pages[0].strokes.filter((s) => s.line === 0);
  // верх + низ двух рядов = 3 горизонтали, по 3 вертикали на ряд
  assert.equal(lines.length, 3 + 3 * 2);
  const text = r.pages[0].strokes.filter((s) => s.line > 0);
  const left = paper.marginLeft, right = paper.width - paper.marginRight;
  for (const s of text) for (let i = 0; i < s.pts.length; i += 2) assert.ok(s.pts[i] > left && s.pts[i] < right);
});

test('стрелки и знаки есть в любом шрифте', () => {
  for (const ch of '→←≈≤≥±×∞°·') assert.equal(resolveGlyph(font, ch).missing, false, ch);
});

const it = (str: string, x: number, y: number, h = 10, bold = false): TextItem => ({ str, x, y, w: str.length * h * 0.5, h, bold });

test('PDF: абзацы, перенос слова, заголовок, список, таблица, подпись и пометка под рисунком', () => {
  const items = [
    it('Заголовок раздела', 50, 40, 14, true),
    it('Первая строка абзаца, которая идёт почти до правого края и пере-', 50, 70),
    it('носится на следующую строку.', 50, 84),
    it('• пункт списка', 60, 110),
    it('Термин', 50, 140), it('Определение', 200, 140),
    it('Калибр', 50, 160), it('Диаметр трубы', 200, 160),
    it('4.1-сурет. Схема прибора', 150, 300),
    it('[ басып шығару ]', 180, 314),
    it('Текст после рисунка.', 50, 340),
  ];
  const t = structure(items, [{ id: 'p1i1', y: 200 }]);
  const lines = t.trim().split('\n');
  assert.equal(lines[0], '# Заголовок раздела');
  assert.ok(lines.includes('Первая строка абзаца, которая идёт почти до правого края и переносится на следующую строку.'), t);
  assert.ok(lines.includes('— пункт списка'));
  assert.ok(lines.includes('| Термин | Определение |'));
  assert.ok(lines.includes('| Калибр | Диаметр трубы |'));
  assert.ok(lines.includes('![4.1-сурет. Схема прибора](img:p1i1 место)'), t);
  assert.equal(lines[lines.length - 1], 'Текст после рисунка.');
});

test('PDF: прямоугольник картинки по матрицам save/transform/paint', () => {
  const OPS = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintInlineImageXObject: 5, paintImageMaskXObject: 6, paintFormXObjectBegin: 7, paintFormXObjectEnd: 8 };
  const boxes = imageBoxes({ fnArray: [1, 3, 4, 2, 4], argsArray: [null, [200, 0, 0, 100, 50, 600], ['img1'], null, ['tiny']] }, OPS);
  assert.deepEqual(boxes, [[50, 600, 250, 700]]);
});

test('картинка → линии: квадрат превращается в замкнутый контур нужного размера', () => {
  const W = 200, H = 100;
  const data = new Uint8Array(W * H).fill(255);
  for (let x = 20; x < 180; x++) for (const y of [20, 21, 22, 78, 79, 80]) data[y * W + x] = 0;
  for (let y = 20; y < 81; y++) for (const x of [20, 21, 22, 177, 178, 179]) data[y * W + x] = 0;
  const d = vectorize({ w: W, h: H, data });
  assert.ok(Math.abs(d.aspect - 0.5) < 1e-9);
  assert.ok(d.paths.length >= 1 && d.paths.length <= 4, `${d.paths.length}`);
  const xs = d.paths.flatMap((p) => p.filter((_, i) => i % 2 === 0));
  assert.ok(Math.min(...xs) < 0.13 && Math.max(...xs) > 0.87);
});
