// Варианты букв из одного начертания (для шрифтов .ttf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addVariants, deformGlyph } from '../src/fonts/variants.ts';

const o = { w: 60, s: [[30, 100, 0, 50, 30, 0, 60, 50, 30, 100]] };

test('вариант: та же буква, но не копия; зерно повторяет результат', () => {
  const a = deformGlyph(o, 100, 1), b = deformGlyph(o, 100, 2);
  assert.deepEqual(deformGlyph(o, 100, 1), a);
  assert.notDeepEqual(a.s, b.s);
  for (const g of [a, b]) {
    assert.ok(Math.abs(g.w - o.w) < 10, 'ширина ' + g.w);
    let minX = Infinity, maxY = -Infinity;
    for (const st of g.s) for (let i = 0; i < st.length; i += 2) { minX = Math.min(minX, st[i]); maxY = Math.max(maxY, st[i + 1]); }
    assert.ok(minX >= 0 && Math.abs(maxY - 100) < 15, `левый край ${minX}, верх ${maxY}`);
  }
});

test('добавить варианты: буквы до 4, знаки не трогаем', () => {
  const r = addVariants({ о: [o], '.': [{ w: 10, s: [[0, 0, 1, 0]] }] }, 100, 4);
  assert.equal(r.glyphs['о'].length, 4);
  assert.equal(r.glyphs['.'].length, 1);
  assert.equal(r.added, 3);
  assert.equal(addVariants(r.glyphs, 100, 4).added, 0);
});
