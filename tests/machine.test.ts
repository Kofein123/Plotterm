// Сквозной тест: вёрстка → план → потоковая отправка на виртуальную плату GRBL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_FONTS } from '../src/fonts/fonts.ts';
import { layoutText } from '../src/core/layout.ts';
import { buildPlan, DEFAULT_LIMITS } from '../src/core/plan.ts';
import { sheetFrame, workToPaper } from '../src/core/calibration.ts';
import { Machine, sleep } from '../src/grbl/machine.ts';
import { JobRunner } from '../src/grbl/job.ts';
import { SimulatorTransport } from '../src/grbl/simulator.ts';
import { paper, typo, pen, speed, calib } from './core.test.ts';

function makePlan(text: string) {
  const r = layoutText({ text, font: BUILTIN_FONTS[0], typo, paper });
  return buildPlan({ strokes: r.pages[0].strokes, pageW: 210, pageH: 297, rotate180: false, frame: sheetFrame(calib), calib, pen, speed: { ...speed, park: 'none' }, limits: DEFAULT_LIMITS, dryRun: false, reorder: true, title: 't' });
}

async function setup(speedup = 400) {
  const sim = new SimulatorTransport({ speedup });
  const m = new Machine();
  await m.connect(sim);
  // ноль ручки и листа
  await m.send('G10 L20 P1 X0 Y0 Z0');
  return { sim, m };
}

test('стример: задание печатается целиком, буфер платы не переполняется', async () => {
  const { sim, m } = await setup();
  const errors: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => errors.push(a.join(' '));
  let inkSegs = 0;
  sim.trace.onInk = () => inkSegs++;
  const plan = makePlan('Мама мыла раму. Съешь же ещё этих мягких французских булок.');
  const frame = sheetFrame(calib);
  const job = new JobRunner(m, { upZ: () => 2, toPaper: (x, y) => workToPaper(frame, x, y), penDownAt: (z) => z < 1 });
  m.onStatus = (r) => job.onStatus(r);
  job.start([{ plan, pageNo: 0 }]);
  const t0 = Date.now();
  while (job.status.peek() !== 'done' && Date.now() - t0 < 60000) await sleep(50);
  console.error = orig;
  assert.equal(job.status.peek(), 'done', job.message.peek() ?? '');
  assert.deepEqual(errors, []);
  assert.ok(inkSegs > plan.strokes.length, 'ручка должна рисовать');
  const z = m.wpos.peek()[2];
  assert.ok(Math.abs(z - 2) < 0.01, 'в конце ручка поднята, Z=' + z);
  await m.disconnect();
});

test('СТОП посреди печати: ручка поднимается, место запоминается, можно продолжить', async () => {
  const { m } = await setup(40);
  const plan = makePlan('Длинный текст для проверки остановки. '.repeat(6));
  const frame = sheetFrame(calib);
  const job = new JobRunner(m, { upZ: () => 2, toPaper: (x, y) => workToPaper(frame, x, y), penDownAt: (z) => z < 1 });
  m.onStatus = (r) => job.onStatus(r);
  job.start([{ plan, pageNo: 0 }]);
  await sleep(1500);
  await job.stop();
  assert.equal(job.status.peek(), 'stopped');
  const rp = job.resumePoint.peek();
  assert.ok(rp && rp.stroke > 0, 'место остановки: ' + JSON.stringify(rp));
  await sleep(400);
  assert.ok(Math.abs(m.wpos.peek()[2] - 2) < 0.01, 'ручка поднята после стопа');
  assert.equal(m.state.peek(), 'Idle');
  // продолжение с места остановки
  job.reset();
  job.start([{ plan, pageNo: 0 }], rp!.page, rp!.stroke);
  const t0 = Date.now();
  while (job.status.peek() !== 'done' && Date.now() - t0 < 60000) await sleep(50);
  assert.equal(job.status.peek(), 'done');
  await m.disconnect();
});

test('пауза на границе штриха и продолжение', async () => {
  const { m } = await setup(40);
  const plan = makePlan('Пауза и продолжение работы плоттера. '.repeat(3));
  const frame = sheetFrame(calib);
  const job = new JobRunner(m, { upZ: () => 2, toPaper: (x, y) => workToPaper(frame, x, y), penDownAt: (z) => z < 1 });
  job.start([{ plan, pageNo: 0 }]);
  await sleep(800);
  job.pause();
  const t0 = Date.now();
  while (job.status.peek() !== 'paused' && Date.now() - t0 < 10000) await sleep(20);
  assert.equal(job.status.peek(), 'paused');
  assert.ok(Math.abs(m.wpos.peek()[2] - 2) < 0.01, 'на паузе ручка поднята');
  job.resume();
  while (job.status.peek() !== 'done' && Date.now() - t0 < 60000) await sleep(50);
  assert.equal(job.status.peek(), 'done');
  await m.disconnect();
});

test('ошибка платы останавливает печать и поднимает ручку', async () => {
  const { m } = await setup(40);
  const plan = makePlan('Ошибка');
  plan.gcode.splice(plan.strokeStart[2] + 2, 0, 'G99'); // недопустимая команда
  // пересчитывать индексы не обязательно для теста
  const frame = sheetFrame(calib);
  const job = new JobRunner(m, { upZ: () => 2, toPaper: (x, y) => workToPaper(frame, x, y), penDownAt: (z) => z < 1 });
  job.start([{ plan, pageNo: 0 }]);
  const t0 = Date.now();
  while (job.status.peek() !== 'error' && job.status.peek() !== 'done' && Date.now() - t0 < 20000) await sleep(20);
  assert.equal(job.status.peek(), 'error');
  await sleep(300);
  assert.ok(Math.abs(m.wpos.peek()[2] - 2) < 0.01);
  await m.disconnect();
});
