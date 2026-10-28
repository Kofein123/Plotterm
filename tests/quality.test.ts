// Метрики качества почерка (этап 0 ТЗ). Пороги — текущий уровень: дальше они только ужесточаются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILTIN_FONTS } from '../src/fonts/fonts.ts';
import { layoutText } from '../src/core/layout.ts';
import { measureQuality } from '../src/core/quality.ts';
import type { LayoutResult, PaperSettings, TypographySettings } from '../src/core/types.ts';

const paper: PaperSettings = { template: 'grid', width: 170, height: 205, marginTop: 10, marginBottom: 8, marginLeft: 8, marginRight: 25, blankLineStep: 9, cell: 5, gridLineCells: 2, rulePitch: 8, side: 'right', rotate180: false, startLine: 1 };
const typo: TypographySettings = { fontId: 'propis', xHeight: 3.2, slant: 12, letterSpacing: 1, wordSpacing: 1, align: 'justify', hyphenate: true, indent: 10, liveliness: 3, seed: 7, cursive: true };
const propis = BUILTIN_FONTS.find((f) => f.id === 'propis')!;
const gostB = BUILTIN_FONTS.find((f) => f.id === 'gost-b')!;
const sample = (name: string) => readFileSync(new URL(`../samples/texts/${name}`, import.meta.url), 'utf8');

/** Пустой результат вёрстки с заданной трассой — для проверки самих метрик. */
function fake(trace: NonNullable<LayoutResult['trace']>): LayoutResult {
  return { pages: [], missingChars: [], chars: 0, trace };
}

test('метрика: повёрнутая и увеличенная копия — та же форма', () => {
  const a = [0, 0, 1, 2, 2, 0, 3, 2];
  const rot = (p: number[], ang: number, k: number) =>
    p.map((_, i) => (i % 2 === 0 ? k * (p[i] * Math.cos(ang) - p[i + 1] * Math.sin(ang)) + 5 : k * (p[i - 1] * Math.sin(ang) + p[i] * Math.cos(ang)) - 1));
  const q = measureQuality(fake({ glyphs: [{ ch: 'а', page: 0, strokes: [a] }, { ch: 'а', page: 0, strokes: [rot(a, 0.2, 1.3)] }], runs: [] }), paper, 1);
  assert.ok(q.variety > 0.05, 'сырое отличие должно быть');
  assert.ok(q.shapeVariety < 1e-6, 'форма та же: ' + q.shapeVariety);
  const other = measureQuality(fake({ glyphs: [{ ch: 'а', page: 0, strokes: [a] }, { ch: 'а', page: 0, strokes: [[0, 0, 1, 2, 2, 2, 3, 0]] }], runs: [] }), paper, 1);
  assert.ok(other.shapeVariety > 0.1, 'другая форма: ' + other.shapeVariety);
});

test('метрика: угол излома на стыке', () => {
  const straight = measureQuality(fake({ glyphs: [], runs: [{ page: 0, pts: [0, 0, 1, 0, 2, 0, 3, 0, 4, 0], joints: [2] }] }), paper, 3);
  assert.equal(straight.joins.count, 1);
  assert.ok(straight.joins.max < 1e-6);
  const corner = measureQuality(fake({ glyphs: [], runs: [{ page: 0, pts: [0, 0, 1, 0, 2, 0, 2, 1, 2, 2], joints: [2] }] }), paper, 3);
  assert.ok(Math.abs(corner.joins.max - 90) < 1e-6, 'прямой угол: ' + corner.joins.max);
  assert.equal(corner.joins.kinked, 1);
});

test('трасса не меняет вёрстку', () => {
  const text = sample('pangram.txt');
  const a = layoutText({ text, font: propis, typo, paper });
  const b = layoutText({ text, font: propis, typo, paper, trace: true });
  assert.deepEqual(a.pages, b.pages);
  assert.equal(a.trace, undefined);
  assert.ok(b.trace!.glyphs.length > 100);
});

test('без живости одинаковые буквы — точные копии', () => {
  const r = layoutText({ text: sample('repeat.txt'), font: gostB, typo: { ...typo, fontId: 'gost-b', liveliness: 0 }, paper, trace: true });
  const q = measureQuality(r, paper, typo.xHeight);
  assert.ok(q.variety < 1e-6 && q.shapeVariety < 1e-6, `variety ${q.variety}, shape ${q.shapeVariety}`);
});

// Текущий уровень (28.10.2026): буквы различаются только поворотом/масштабом (форма ≈ 0,004),
// у «Прописи» ~85 % стыков с изломом больше 25°. Этапы 1–2 ТЗ должны поднять первое и опустить второе.
test('эталон: разнообразие букв не хуже текущего', () => {
  const r = layoutText({ text: sample('repeat.txt'), font: propis, typo, paper, trace: true });
  const q = measureQuality(r, paper, typo.xHeight);
  assert.ok(q.repeatedChars >= 8);
  assert.ok(q.variety >= 0.005, 'разнообразие ' + q.variety);
  assert.ok(q.shapeVariety >= 0.003, 'разнообразие формы ' + q.shapeVariety);
});

test('эталон: стыки связного письма не хуже текущего', () => {
  const r = layoutText({ text: sample('lecture-1.md'), font: propis, typo, paper, trace: true });
  const q = measureQuality(r, paper, typo.xHeight);
  assert.ok(q.joins.count > 500, 'стыков ' + q.joins.count);
  assert.ok(q.joins.kinked <= 0.9, 'доля изломов ' + q.joins.kinked);
  assert.ok(q.joins.mean <= 60, 'средний излом ' + q.joins.mean);
});

test('эталон: конспект целиком в полях и без пропущенных букв', () => {
  for (const name of ['lecture-1.md', 'pangram.txt', 'punct.txt']) {
    for (const font of [propis, gostB]) {
      const r = layoutText({ text: sample(name), font, typo: { ...typo, fontId: font.id }, paper, trace: true });
      const q = measureQuality(r, paper, typo.xHeight);
      assert.equal(q.outside, 0, `${name}/${font.id}: точек за полями ${q.outside}`);
      assert.deepEqual(q.missing, [], `${name}/${font.id}: нет символов ${q.missing.join('')}`);
    }
  }
});
