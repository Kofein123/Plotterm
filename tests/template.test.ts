// Лист-шаблон почерка: синтетическое «фото» (перспектива, стол вокруг листа) → буквы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_FONTS } from '../src/fonts/fonts.ts';
import { GRID_CORNERS, MARKS, MARK_SIZE, SHEET_H, SHEET_W, TEMPLATE_CHARS, TEMPLATE_CHARS_2, X_HEIGHT, templateCells, templateChars, templateSvg } from '../src/io/template.ts';
import { findMarks, homography, orderStrokes, project, readTemplate, type Gray } from '../src/io/templateImport.ts';

const font = BUILTIN_FONTS.find((f) => f.id === 'gost-b')!;
const PX = 8; // пикселей на мм в растре листа

/** Лист с «написанными» буквами ГОСТ Б (штрих 0,5 мм) в растре PX пикс/мм. */
function drawSheet(lineLum = 200, writeH = X_HEIGHT, sheetNo = 1): { sheet: Gray; written: Map<string, number[][]> } {
  const W = SHEET_W * PX, H = SHEET_H * PX;
  const data = new Uint8Array(W * H).fill(246);
  const dot = (x: number, y: number, r: number, v: number) => {
    for (let yy = Math.floor((y - r) * PX); yy <= Math.ceil((y + r) * PX); yy++)
      for (let xx = Math.floor((x - r) * PX); xx <= Math.ceil((x + r) * PX); xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        if (Math.hypot(xx / PX - x, yy / PX - y) <= r) data[yy * W + xx] = Math.min(data[yy * W + xx], v);
      }
  };
  const line = (x0: number, y0: number, x1: number, y1: number, r: number, v: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * PX * 2));
    for (let i = 0; i <= n; i++) dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, r, v);
  };
  for (const [cx, cy] of MARKS)
    for (let y = cy - MARK_SIZE / 2; y <= cy + MARK_SIZE / 2; y += 1 / PX) line(cx - MARK_SIZE / 2, y, cx + MARK_SIZE / 2, y, 0.1, 15);
  const written = new Map<string, number[][]>();
  const k = writeH / font.xHeight;
  for (const c of templateCells(sheetNo)) {
    // светлые направляющие, как на печати
    line(c.x + 1, c.baseline, c.x + c.w - 1, c.baseline, 0.12, lineLum);
    line(c.x, c.y - 3, c.x + c.w, c.y - 3, 0.1, lineLum + 15);
    for (const dy of [c.xh ?? X_HEIGHT, ...(c.guides ?? [])])
      for (let x = c.x + 1; x < c.x + c.w - 1; x += 1.6) line(x, c.baseline - dy, x + 0.8, c.baseline - dy, 0.1, lineLum + 15);
    line(c.x, c.y - 3, c.x, c.y + c.h, 0.1, lineLum + 15);
    if (written.has(c.ch)) continue; // второй экземпляр строчных оставляем пустым
    const g = font.glyphs.get(c.ch)?.[0];
    if (!g) continue;
    const strokes = g.s.map((s) => s.map((v, i) => (i % 2 === 0 ? c.x + 2 + v * k : c.baseline - v * k)));
    for (const s of strokes) for (let i = 2; i < s.length; i += 2) line(s[i - 2], s[i - 1], s[i], s[i + 1], 0.25, 70);
    written.set(c.ch, g.s);
  }
  return { sheet: { w: W, h: H, data }, written };
}

/** Снимок листа в перспективе на тёмном столе. */
function photograph(sheet: Gray, corners: [number, number][], w: number, h: number, bend = 0): Gray {
  const inv = homography(corners, MARKS); // фото → лист (мм)
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let [mx, my] = project(inv, x + 0.5, y + 0.5);
      // выгнутый лист: середина сдвинута относительно меток, к краям сдвиг сходит на нет
      const bx = Math.sin((Math.PI * mx) / SHEET_W) * Math.sin((Math.PI * my) / SHEET_H);
      mx += bend * bx;
      my += bend * bx * 0.8;
      const sx = Math.floor(mx * PX), sy = Math.floor(my * PX);
      data[y * w + x] = sx < 0 || sy < 0 || sx >= sheet.w || sy >= sheet.h ? 85 : sheet.data[sy * sheet.w + sx];
    }
  return { w, h, data };
}

/** Средняя удалённость точек b от ломаных a (независимо от порядка и направления штрихов), единицы шрифта. */
function chamfer(a: number[][], b: number[][]): number {
  const segs: number[][] = [];
  for (const s of a) for (let i = 2; i < s.length; i += 2) segs.push([s[i - 2], s[i - 1], s[i], s[i + 1]]);
  if (!segs.length) for (const s of a) segs.push([s[0], s[1], s[0], s[1]]);
  let sum = 0, n = 0;
  for (const s of b)
    for (let i = 0; i < s.length; i += 2) {
      let best = Infinity;
      for (const [x0, y0, x1, y1] of segs) {
        const dx = x1 - x0, dy = y1 - y0;
        const t = dx || dy ? Math.max(0, Math.min(1, ((s[i] - x0) * dx + (s[i + 1] - y0) * dy) / (dx * dx + dy * dy))) : 0;
        best = Math.min(best, Math.hypot(s[i] - x0 - t * dx, s[i + 1] - y0 - t * dy));
      }
      sum += best;
      n++;
    }
  return sum / n;
}

test('шаблон: все символы помещаются, SVG собирается', () => {
  assert.ok(TEMPLATE_CHARS.length >= 150);
  for (const ch of 'аяәіАЯӘІ09.,—«»') assert.ok(TEMPLATE_CHARS.includes(ch), ch);
  const cells = templateCells();
  for (const c of cells) assert.ok(c.x >= 14 && c.x + c.w <= 196 && c.y + c.h <= 280, `клетка «${c.ch}» вне листа`);
  assert.ok(templateSvg().startsWith('<svg') && templateSvg().includes('лист-шаблон'));
  // второй лист той же сетки — те же опорные углы таблицы
  assert.equal(TEMPLATE_CHARS_2.length, TEMPLATE_CHARS.length);
  for (const ch of 'xyzFImαπΔ√≤∫') assert.ok(TEMPLATE_CHARS_2.includes(ch), ch);
  assert.ok(templateSvg(2).includes('латиница'));
});

test('гомография: четыре точки переходят точно', () => {
  const to: [number, number][] = [[100, 120], [1400, 90], [1450, 1900], [60, 1870]];
  const H = homography(MARKS, to);
  MARKS.forEach(([x, y], i) => {
    const [u, v] = project(H, x, y);
    assert.ok(Math.hypot(u - to[i][0], v - to[i][1]) < 1e-6);
  });
});

test('порядок штрихов: слева направо, вертикаль сверху вниз, петля против часовой', () => {
  const [a, b] = orderStrokes([[50, 100, 50, 0], [0, 0, 0, 100]]);
  assert.equal(a[0], 0, 'левый штрих первым');
  assert.ok(a[1] > a[3] && b[1] > b[3], 'сверху вниз');
  const sq = [0, 0, 0, 50, 50, 50, 50, 0, 0, 0]; // по часовой
  const loop = orderStrokes([sq])[0];
  let area = 0;
  for (let i = 0; i + 3 < loop.length; i += 2) area += loop[i] * loop[i + 3] - loop[i + 2] * loop[i + 1];
  assert.ok(area > 0, 'против часовой');
});

function checkPhoto(lineLum: number, writeH = X_HEIGHT, maxDev = 14, sheetNo = 1, chars = 'абвгдежзиклмнопрстуфхцчшщэюяБДЖЩӘҚ0123456789', bend = 0) {
  const { sheet, written } = drawSheet(lineLum, writeH, sheetNo);
  const corners: [number, number][] = [[140, 170], [1330, 120], [1400, 1830], [95, 1880]];
  const photo = photograph(sheet, corners, 1500, 2000, bend);
  const marks = findMarks(photo);
  assert.ok(marks, 'метки не найдены');
  marks!.forEach(([x, y], i) => assert.ok(Math.hypot(x - corners[i][0], y - corners[i][1]) < 4, `метка ${i}: ${x},${y}`));

  const res = readTemplate(photo, marks, undefined, sheetNo);
  // точка и запятая у ГОСТ крошечные — их допускаем пропустить
  assert.ok(res.filled >= written.size - 6, `снято ${res.filled} из ${written.size}`);
  // пустые клетки (второй экземпляр строчных) пустыми и остались
  assert.ok(res.filled <= written.size, 'лишние буквы из пустых клеток');

  let worst = 0, worstCh = '';
  for (const ch of chars) {
    const g = res.glyphs[ch]?.[0];
    assert.ok(g, `нет «${ch}»`);
    // сравниваем после совмещения левых краёв (импорт сдвигает букву к x = 0)
    const orig = written.get(ch)!;
    let minX = Infinity;
    for (const s of orig) for (let i = 0; i < s.length; i += 2) minX = Math.min(minX, s[i]);
    const k = 100 / font.xHeight; // импорт приводит x-высоту к 100 единицам, как бы крупно ни писали
    const o = orig.map((s) => s.map((v, i) => (i % 2 === 0 ? (v - minX) * k : v * k)));
    // ошибку меряем в мм-эквиваленте листа (100 ед. = 3,5 мм), иначе мелкое письмо после масштаба «ошибается» сильнее
    const d = Math.max(chamfer(o, g!.s), chamfer(g!.s, o)) * (writeH / X_HEIGHT);
    if (d > worst) { worst = d; worstCh = ch; }
  }
  // 100 единиц = x-высота 3,5 мм; скелет скругляет острые углы ГОСТ (м, 4) — до ≈ 10 ед. ≈ 0,35 мм;
  // добор бледных пикселей у штриха (нужен для светлой пасты на реальном фото) добавляет ещё ≈ 2 ед.
  assert.ok(worst < maxDev, `хуже всего «${worstCh}»: ${worst.toFixed(1)} ед.`);
}

test('фото листа в перспективе: метки найдены, буквы сняты близко к написанным', () => checkPhoto(200));

// ч/б принтер печатает голубые линии серыми — почти как чернила; пишут обычно чуть ниже пунктира.
// Линию отличаем от букв только по толщине, поэтому штрих, лежащий вдоль линии (низ «1»), теряет
// кусочек — допуск шире (≈ 0,6 мм). Настоящий растровый лист проверен вручную и снимается чисто.
test('тёмные печатные линии клетки не попадают в буквы', () => checkPhoto(130, 3, 20));

// «w» ГОСТ при x-высоте 3,5 мм — острые узкие зубцы, скелет их сглаживает, поэтому в сравнении её нет;
// у «t» скругляется угол перекладины — допуск чуть шире
test('лист 2: латиница снимается', () => checkPhoto(200, X_HEIGHT, 16, 2, 'abdeghkmnpqrstuvxyzFGIMNQRS'));

test('углы таблицы вручную вместо меток дают те же буквы', () => {
  const { sheet, written } = drawSheet();
  const corners: [number, number][] = [[140, 170], [1330, 120], [1400, 1830], [95, 1880]];
  const photo = photograph(sheet, corners, 1500, 2000);
  const H = homography(MARKS, corners);
  // человек попадает в угол с ошибкой в пару пикселей
  const taps = GRID_CORNERS.map(([x, y], i) => { const [u, v] = project(H, x, y); return [u + (i % 2 ? 2 : -2), v + 1] as [number, number]; });
  const res = readTemplate(photo, taps, GRID_CORNERS);
  assert.ok(res.filled >= written.size - 6 && res.filled <= written.size, `снято ${res.filled} из ${written.size}`);
});

// бумага на столе выгибается: середина таблицы уезжает от меток на 3 мм, клетки уточняем по печатным линиям.
// Изгиб чуть растягивает и сами буквы, поэтому допуск шире; без уточнения клеток здесь ≈ 40 ед.
test('выгнутый лист: буквы не режутся краем клетки', () => checkPhoto(200, X_HEIGHT, 17, 1, undefined, 3));

test('без меток — понятная ошибка', () => {
  const blank: Gray = { w: 400, h: 600, data: new Uint8Array(400 * 600).fill(240) };
  assert.equal(findMarks(blank), null);
  assert.throws(() => readTemplate(blank), /метки/);
});

test('крупные листы А, Б, В: все буквы алфавитов, клетки на листе, четыре направляющие', () => {
  const all = [3, 4, 5].flatMap((n) => templateChars(n));
  for (const ch of 'АаЯяЁёӘәҢңІі09.,—«»AazZπ≤') assert.ok(all.includes(ch), ch);
  for (const n of [3, 4, 5]) {
    for (const c of templateCells(n)) assert.ok(c.x >= 12 && c.x + c.w <= 198 && c.y + c.h <= 278, `лист ${n}: клетка «${c.ch}» вне листа`);
    assert.equal(templateSvg(n).match(/<line/g)?.length, templateCells(n).length * 4);
  }
});

// крупная клетка: пишут мельче пунктира (4 мм из 5) — снимается точнее мелкого листа (там допуск 14)
test('крупный лист А: русские буквы снимаются', () => checkPhoto(200, 4, 11, 3, 'абвгдежзиклмнопрстуфхцчшщэюяБДЖЩЯ'));
test('крупный лист Б: казахские буквы и цифры', () => checkPhoto(200, 4, 13, 4, 'әғқңөұүһі0123456789'));
// тёмные (ч/б) линии: у букв с палкой слева (қ, һ, і) к низу прилипает огрызок базовой линии —
// как и на мелком листе, допуск шире; лучше печатать в цвете
test('крупный лист Б: тёмные линии не превращаются в буквы', () => checkPhoto(140, 4, 25, 4, 'әғқңөұүһі0123456789'));
