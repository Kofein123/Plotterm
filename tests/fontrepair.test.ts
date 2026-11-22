// Починка заголовка старых .ttf, которые браузер отвергает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairSfnt } from '../src/io/fontrepair.ts';

/** sfnt из двух таблиц: cmap (формат 4, segCount 3, поля поиска испорчены) и post v2, cmap сдвинута на 2 байта */
function broken(): ArrayBuffer {
  const cmap = new Uint8Array(4 + 8 + 16 + 3 * 8);
  const c = new DataView(cmap.buffer);
  c.setUint16(2, 1); // один подтаблица
  c.setUint16(4, 3); c.setUint16(6, 1); c.setUint32(8, 12);
  c.setUint16(12, 4); c.setUint16(14, cmap.length - 12); c.setUint16(18, 6); // формат 4, segCountX2 = 6
  c.setUint16(20, 99); c.setUint16(22, 99); c.setUint16(24, 99);
  const post = new Uint8Array(40);
  new DataView(post.buffer).setUint32(0, 0x00020000);
  const head = 12 + 2 * 16;
  const buf = new ArrayBuffer(head + 2 + cmap.length + post.length);
  const v = new DataView(buf), b = new Uint8Array(buf);
  v.setUint32(0, 0x00010000); v.setUint16(4, 2); v.setUint16(6, 1); v.setUint16(8, 7); v.setUint16(10, 7);
  const put = (i: number, tag: string, off: number, data: Uint8Array) => {
    for (let k = 0; k < 4; k++) b[12 + i * 16 + k] = tag.charCodeAt(k);
    v.setUint32(12 + i * 16 + 8, off); v.setUint32(12 + i * 16 + 12, data.length); b.set(data, off);
  };
  put(0, 'cmap', head + 2, cmap);
  put(1, 'post', head + 2 + cmap.length, post);
  return buf;
}

test('починка заголовка: поля поиска, выравнивание таблиц, post v3', () => {
  const out = repairSfnt(broken())!;
  const v = new DataView(out);
  assert.deepEqual([v.getUint16(6), v.getUint16(8), v.getUint16(10)], [32, 1, 0]);
  const cmapOff = v.getUint32(12 + 8), postOff = v.getUint32(28 + 8);
  assert.equal(cmapOff % 4, 0);
  assert.equal(postOff % 4, 0);
  const st = cmapOff + 12;
  assert.deepEqual([v.getUint16(st + 8), v.getUint16(st + 10), v.getUint16(st + 12)], [4, 1, 2]);
  assert.equal(v.getUint32(postOff), 0x00030000);
  assert.equal(v.getUint32(28 + 12), 32);
});

test('не шрифт — null', () => {
  assert.equal(repairSfnt(new TextEncoder().encode('<svg>hello</svg>').buffer as ArrayBuffer), null);
});
