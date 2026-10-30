// Тесты ядра: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_FONTS } from '../src/fonts/fonts.ts';
import { layoutText } from '../src/core/layout.ts';
import { buildPlan, fmt, DEFAULT_LIMITS } from '../src/core/plan.ts';
import { BACKLASH_PAIRS, backlashTestGcode } from '../src/core/backlash.ts';
import { sheetFrame, paperToWork, workToPaper, DEFAULT_CALIBRATION } from '../src/core/calibration.ts';
import { hyphenPoints } from '../src/core/hyphen.ts';
import { parseMarkup } from '../src/core/markup.ts';
import { classify, parseStatus } from '../src/grbl/protocol.ts';
import { simplify } from '../src/core/geometry.ts';
import type { Calibration, PaperSettings, PenSettings, SpeedSettings, TypographySettings } from '../src/core/types.ts';

export const paper: PaperSettings = { template: 'a4', width: 210, height: 297, marginTop: 15, marginBottom: 15, marginLeft: 20, marginRight: 15, blankLineStep: 9, cell: 5, gridLineCells: 2, rulePitch: 8, side: 'right', rotate180: false, startLine: 1 };
export const typo: TypographySettings = { fontId: 'gost-a', xHeight: 3, slant: 10, letterSpacing: 1, wordSpacing: 1, align: 'left', hyphenate: true, indent: 10, liveliness: 2, seed: 1 };
export const pen: PenSettings = { pressure: 0.4, zDownFeed: 1500, dwellMs: 0, zDownRapid: false, hopLift: 0, hopDistance: 6 };
export const speed: SpeedSettings = { profile: 'normal', customFeed: 4000, travelFeed: 0, joinTolerance: 0.15, simplify: 0.05, park: 'zero' };
export const calib: Calibration = { ...DEFAULT_CALIBRATION, penSet: true, upZ: 2, zeroSet: true, cornerSet: true, corner: [210, -297] };

test('шрифты: вся кириллица и казахские буквы есть', () => {
  for (const f of BUILTIN_FONTS) {
    for (const ch of 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯәғқңөұүһіӘҒҚҢӨҰҮҺІ0123456789.,:;!?()«»-—№') {
      assert.ok(f.glyphs.has(ch), `${f.id}: нет «${ch}»`);
    }
  }
});

test('переносы', () => {
  assert.ok(hyphenPoints('конспект').length > 0);
  assert.deepEqual(hyphenPoints('вода'), [2]);
  assert.deepEqual(hyphenPoints('да'), []);
  // й не отрывается
  assert.ok(!hyphenPoints('майка').includes(2));
});

test('разметка', () => {
  const p = parseMarkup('# Заголовок\n\nx^2 + a_{12} __под__\n===\nконец');
  assert.equal(p.length, 5);
  assert.equal(p[0].kind, 'text');
  assert.equal((p[0] as any).heading, true);
  assert.equal(p[1].kind, 'blank');
  const chars = (p[2] as any).chars;
  assert.equal(chars.find((c: any) => c.ch === '2').script, 1);
  assert.equal(chars.filter((c: any) => c.script === -1).length, 2);
  assert.ok(chars.some((c: any) => c.underline));
  assert.equal(p[3].kind, 'page');
});

test('вёрстка: текст внутри полей, страницы делятся', () => {
  const text = ('Это проверочный текст для разбиения на строки и страницы. ').repeat(120);
  const r = layoutText({ text, font: BUILTIN_FONTS[0], typo, paper });
  assert.ok(r.pages.length >= 2, 'должно быть несколько страниц');
  for (const pg of r.pages) {
    for (const s of pg.strokes) {
      for (let i = 0; i < s.pts.length; i += 2) {
        assert.ok(s.pts[i] >= paper.marginLeft - 1.5 && s.pts[i] <= paper.width - paper.marginRight + 1.5, 'u вне полей: ' + s.pts[i]);
        assert.ok(s.pts[i + 1] > 0 && s.pts[i + 1] < paper.height, 'v вне листа');
      }
    }
  }
});

test('вёрстка детерминирована по зерну', () => {
  const a = layoutText({ text: 'Привет, мир', font: BUILTIN_FONTS[0], typo: { ...typo, liveliness: 8 }, paper });
  const b = layoutText({ text: 'Привет, мир', font: BUILTIN_FONTS[0], typo: { ...typo, liveliness: 8 }, paper });
  const c = layoutText({ text: 'Привет, мир', font: BUILTIN_FONTS[0], typo: { ...typo, liveliness: 8, seed: 2 }, paper });
  assert.deepEqual(a.pages[0].strokes, b.pages[0].strokes);
  assert.notDeepEqual(a.pages[0].strokes, c.pages[0].strokes);
});

test('клетка: базовые линии на линиях сетки', () => {
  const p: PaperSettings = { ...paper, template: 'grid', cell: 5, gridLineCells: 2 };
  const r = layoutText({ text: 'строка\nещё строка', font: BUILTIN_FONTS[0], typo: { ...typo, liveliness: 0, slant: 0 }, paper: p, gridOrigin: [0, 2.5] });
  for (const b of r.pages[0].baselines) assert.ok(Math.abs(((b - 2.5) / 10) % 1) < 1e-6 || Math.abs(((b - 2.5) / 10) % 1) > 1 - 1e-6, 'baseline ' + b);
});

test('калибровка: прямое и обратное преобразование, оси по знаку угла', () => {
  const th = Math.atan2(3, 150);
  const cx = 200 * Math.cos(th) - 280 * Math.sin(th);
  const cy = 200 * Math.sin(th) + 280 * Math.cos(th);
  const f = sheetFrame({ ...calib, corner: [-cx, cy], skewPoint: [-150, 3] });
  assert.equal(f.sx, -1);
  assert.equal(f.sy, 1);
  const [x, y] = paperToWork(f, 30, 40);
  const [u, v] = workToPaper(f, x, y);
  assert.ok(Math.abs(u - 30) < 1e-9 && Math.abs(v - 40) < 1e-9);
  assert.ok(Math.abs(f.width - 200) < 1e-6 && Math.abs(f.height - 280) < 1e-6, `${f.width} ${f.height}`);
});

test('калибровка: тетрадь поперёк осей — ширина листа идёт по Y станка', () => {
  // X станка вдоль высоты листа (вниз по листу = −X), Y — вдоль ширины
  const f = sheetFrame({ ...calib, swap: true, corner: [-280, 200] });
  assert.ok(Math.abs(f.width - 200) < 1e-9 && Math.abs(f.height - 280) < 1e-9);
  assert.deepEqual(paperToWork(f, 10, 0), [-0, 10]);
  assert.deepEqual(paperToWork(f, 0, 10), [-10, 0]);
  const [u, v] = workToPaper(f, ...paperToWork(f, 30, 40));
  assert.ok(Math.abs(u - 30) < 1e-9 && Math.abs(v - 40) < 1e-9);
});

test('план: G-код поднимает и опускает ручку по Z', () => {
  const r = layoutText({ text: 'Тест', font: BUILTIN_FONTS[0], typo, paper });
  const plan = buildPlan({ strokes: r.pages[0].strokes, pageW: 210, pageH: 297, rotate180: false, frame: sheetFrame(calib), calib, pen, speed, limits: DEFAULT_LIMITS, dryRun: false, reorder: true, title: 't' });
  const g = plan.gcode.join('\n');
  assert.match(g, /G0 Z2\n/);
  assert.match(g, /G1 Z-0\.4 F1500/);
  assert.equal(plan.outOfBounds.length, 0);
  // каждый штрих начинается переездом с поднятой ручкой и заканчивается подъёмом
  for (let i = 0; i < plan.strokeStart.length; i++) {
    assert.match(plan.gcode[plan.strokeStart[i]], /^G0 X/);
    assert.match(plan.gcode[plan.strokeStart[i] - 1], /^G0 Z2$/);
  }
  // Y отрицательный, т.к. угол листа был в -Y
  assert.ok(plan.gcode.some((l) => /Y-\d/.test(l)));
  assert.ok(plan.estSeconds > 0);
  // сухой прогон не опускает ручку
  const dry = buildPlan({ strokes: r.pages[0].strokes, pageW: 210, pageH: 297, rotate180: false, frame: sheetFrame(calib), calib, pen, speed, limits: DEFAULT_LIMITS, dryRun: true, reorder: true, title: 't' });
  assert.ok(!dry.gcode.some((l) => l.startsWith('G1 Z')));
});

test('план: выход за лист обнаруживается', () => {
  const plan = buildPlan({ strokes: [{ pts: [10, 10, 250, 10], line: 1 }], pageW: 210, pageH: 297, rotate180: false, frame: sheetFrame(calib), calib, pen, speed, limits: DEFAULT_LIMITS, dryRun: false, reorder: true, title: 't' });
  assert.deepEqual(plan.outOfBounds, [0]);
});

test('fmt и упрощение', () => {
  assert.equal(fmt(1.006), '1.01');
  assert.equal(fmt(-0.001), '0');
  assert.equal(fmt(12.5), '12.5');
  assert.equal(simplify([0, 0, 1, 0.001, 2, 0], 0.05).length, 4);
});

test('протокол GRBL', () => {
  const s = parseStatus('<Hold:0|MPos:1.000,2.000,3.000|FS:0,0|Pn:XY|Ov:100,100,100|WCO:1,1,1>')!;
  assert.equal(s.state, 'Hold');
  assert.equal(s.subState, 0);
  assert.deepEqual(s.mpos, [1, 2, 3]);
  assert.equal(s.pins, 'XY');
  assert.equal(classify('error:9').type, 'error');
  assert.equal(classify('ALARM:3').type, 'alarm');
  assert.equal(classify("Grbl 1.1h ['$' for help]").type, 'welcome');
  const st = classify('$110=12000.000');
  assert.equal(st.type, 'setting');
});

test('низкий подъём между буквами внутри строки', () => {
  const r = layoutText({ text: 'Быстро пишем строку', font: BUILTIN_FONTS[0], typo, paper });
  const base = { strokes: r.pages[0].strokes, pageW: 210, pageH: 297, rotate180: false, frame: sheetFrame(calib), calib, speed, limits: DEFAULT_LIMITS, dryRun: false, reorder: true, title: 't' };
  const slow = buildPlan({ ...base, pen });
  const fast = buildPlan({ ...base, pen: { ...pen, hopLift: 0.8, zDownRapid: true } });
  assert.ok(fast.gcode.includes('G0 Z0.8'));
  assert.ok(fast.gcode.some((l) => l === 'G0 Z-0.4'));
  assert.ok(fast.estSeconds < slow.estSeconds * 0.9, `${fast.estSeconds} vs ${slow.estSeconds}`);
  // после последнего штриха — полный подъём
  assert.equal(fast.gcode[fast.gcode.length - 2], 'G0 Z2');
});

/** Станок с люфтом b по осям: каретка тянется за мотором, только когда упирается (позиция в [m, m + b]). */
function playWithBacklash(gcode: string[], b: [number, number], downZ: (z: number) => boolean): number[][] {
  const m = [0, 0, 0], p = [0, 0];
  const out: number[][] = [];
  let cur: number[] | null = null;
  for (const l of gcode) {
    const g = /^G[01]/.test(l) || /^[XY]/.test(l);
    if (!g) continue;
    const t = [m[0], m[1], m[2]];
    for (const [k, i] of [['X', 0], ['Y', 1], ['Z', 2]] as const) {
      const r = new RegExp(k + '(-?[\\d.]+)').exec(l);
      if (r) t[i] = parseFloat(r[1]);
    }
    const n = Math.max(1, Math.ceil(Math.hypot(t[0] - m[0], t[1] - m[1]) / 0.02));
    const sx = m[0], sy = m[1];
    for (let s = 1; s <= n; s++) {
      const mx = sx + ((t[0] - sx) * s) / n, my = sy + ((t[1] - sy) * s) / n;
      p[0] = Math.min(Math.max(p[0], mx), mx + b[0]);
      p[1] = Math.min(Math.max(p[1], my), my + b[1]);
      if (downZ(t[2]) && downZ(m[2])) cur?.push(p[0], p[1]);
    }
    if (downZ(t[2]) && !downZ(m[2])) { cur = [p[0], p[1]]; out.push(cur); }
    if (!downZ(t[2])) cur = null;
    m[0] = t[0]; m[1] = t[1]; m[2] = t[2];
  }
  return out;
}

test('люфт: с поправкой круг на станке с зазором 0,6 мм выходит кругом', () => {
  const circle: number[] = [];
  for (let a = 0; a <= 2 * Math.PI + 1e-9; a += Math.PI / 40) circle.push(50 + 4 * Math.cos(a), 50 + 4 * Math.sin(a));
  const strokes = [{ pts: circle, line: 1 }, { pts: [70, 50, 66, 58], line: 1 }];
  const run = (bl?: [number, number]) => {
    const c = { ...calib, swap: true, corner: [-280, 200] as [number, number], backlash: bl };
    const f = sheetFrame(c);
    const plan = buildPlan({ strokes, pageW: 210, pageH: 297, rotate180: false, frame: f, calib: c, pen, speed: { ...speed, simplify: 0 }, limits: DEFAULT_LIMITS, dryRun: false, reorder: false, title: 't' });
    const drawn = playWithBacklash(plan.gcode, [0.6, 0.6], (z) => z <= 0.01);
    // худшее отклонение от круга радиуса 4 (в машинных координатах тот же круг)
    let worst = 0;
    const [cx, cy] = paperToWork(f, 50, 50);
    for (let i = 0; i < drawn[0].length; i += 2) worst = Math.max(worst, Math.abs(Math.hypot(drawn[0][i] - cx, drawn[0][i + 1] - cy) - 4));
    return worst;
  };
  const raw = run(), fixed = run([0.6, 0.6]);
  assert.ok(raw > 0.25, `без поправки ${raw}`);
  assert.ok(fixed < 0.08, `с поправкой ${fixed}`);
});

test('тест люфта: при зазоре 0,5 мм сходится пара №2 в обоих рядах', () => {
  const c = { ...calib, swap: true, corner: [-280, 200] as [number, number] };
  const f = sheetFrame(c);
  const g = backlashTestGcode(f, c, pen, 1500, () => []);
  const drawn = playWithBacklash(g, [0.5, 0.5], (z) => z <= 0.01).map((s) => workToPaper(f, s[0], s[1]).concat(workToPaper(f, s[s.length - 2], s[s.length - 1])));
  // по 4 чёрточки на пару: верх, низ (поперёк), левая, правая (вдоль)
  const best = (pick: (k: number) => number) => {
    let bk = -1, bd = Infinity;
    for (let k = 0; k < BACKLASH_PAIRS; k++) { const d = Math.abs(pick(k)); if (d < bd) { bd = d; bk = k; } }
    return bk;
  };
  assert.equal(best((k) => drawn[k * 4][0] - drawn[k * 4 + 1][0]), 2);
  assert.equal(best((k) => drawn[k * 4 + 2][1] - drawn[k * 4 + 3][1]), 2);
});
