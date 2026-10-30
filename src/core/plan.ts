// Планировщик: штрихи страницы → порядок → G-код с подъёмом/опусканием ручки по Z.
import { dropTiny, polyLength, reversePts, simplify } from './geometry.ts';
import { paperToWork, penZ, type SheetFrame } from './calibration.ts';
import { feedOf, type Calibration, type PenSettings, type SpeedSettings, type Stroke } from './types.ts';

export interface MachineLimits {
  /** максимальная скорость XY, мм/мин ($110/$111) */
  rapid: number;
  /** ускорение XY, мм/с² ($120/$121) */
  accel: number;
  /** максимальная скорость Z, мм/мин ($112) */
  zRate: number;
  /** ускорение Z, мм/с² ($122) */
  zAccel: number;
}

export const DEFAULT_LIMITS: MachineLimits = { rapid: 12000, accel: 6000, zRate: 3000, zAccel: 500 };

export interface PlanInput {
  strokes: Stroke[];
  /** размер страницы (для поворота на 180°) */
  pageW: number;
  pageH: number;
  rotate180: boolean;
  frame: SheetFrame;
  calib: Calibration;
  pen: PenSettings;
  speed: SpeedSettings;
  limits: MachineLimits;
  dryRun: boolean;
  /** переставлять штрихи для минимального холостого хода */
  reorder: boolean;
  title: string;
  /** коэффициент уточнения оценки времени по прошлым печатям */
  timeFactor?: number;
}

export interface Plan {
  /** штрихи в порядке печати, бумажные координаты (после поворота) */
  strokes: number[][];
  strokeLine: number[];
  gcode: string[];
  /** индекс первой строки G-кода каждого штриха */
  strokeStart: number[];
  /** строка G-кода → штрих (-1 для служебных строк) */
  lineStroke: Int32Array;
  outOfBounds: number[];
  drawLength: number;
  travelLength: number;
  penLifts: number;
  estSeconds: number;
  /** оценка времени до начала каждого штриха, с */
  strokeTime: number[];
  /** из чего складывается время: письмо, переезды, подъёмы/опускания ручки */
  timeDraw?: number;
  timeTravel?: number;
  timePen?: number;
}

export function fmt(n: number): string {
  const s = (Math.round(n * 100) / 100).toFixed(2);
  const t = s.replace(/\.?0+$/, '');
  return t === '-0' ? '0' : t;
}

/** Порядок штрихов: строка за строкой, внутри строки — ближайший сосед с возможным разворотом. */
export function orderStrokes(strokes: { pts: number[]; line: number }[], reorder: boolean) {
  if (!reorder) return strokes.map((s) => ({ ...s }));
  const groups = new Map<number, { pts: number[]; line: number }[]>();
  for (const s of strokes) {
    if (!groups.has(s.line)) groups.set(s.line, []);
    groups.get(s.line)!.push(s);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === 0 ? 1e9 : a) - (b === 0 ? 1e9 : b));
  const out: { pts: number[]; line: number }[] = [];
  let cx = 0, cy = 0;
  for (const k of keys) {
    const rest = groups.get(k)!.slice();
    // начинаем строку с самого левого штриха
    if (out.length === 0 || k !== 0) {
      let bi = 0, bv = Infinity;
      rest.forEach((s, i) => {
        const m = Math.min(s.pts[0], s.pts[s.pts.length - 2]);
        if (m < bv) { bv = m; bi = i; }
      });
      const s = rest.splice(bi, 1)[0];
      const rev = s.pts[s.pts.length - 2] < s.pts[0] - 0.01;
      const pts = rev ? reversePts(s.pts) : s.pts;
      out.push({ pts, line: s.line });
      cx = pts[pts.length - 2];
      cy = pts[pts.length - 1];
    }
    while (rest.length) {
      let bi = 0, bd = Infinity, brev = false;
      for (let i = 0; i < rest.length; i++) {
        const p = rest[i].pts;
        const ds = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
        const de = (p[p.length - 2] - cx) ** 2 + (p[p.length - 1] - cy) ** 2;
        if (ds < bd) { bd = ds; bi = i; brev = false; }
        if (de < bd) { bd = de; bi = i; brev = true; }
      }
      const s = rest.splice(bi, 1)[0];
      const pts = brev ? reversePts(s.pts) : s.pts;
      out.push({ pts, line: s.line });
      cx = pts[pts.length - 2];
      cy = pts[pts.length - 1];
    }
  }
  return out;
}

export function buildPlan(inp: PlanInput): Plan {
  const { frame, speed, pen, limits } = inp;
  // 1. поворот страницы и упрощение
  const prepared = inp.strokes
    .map((s) => {
      let pts = s.pts;
      if (inp.rotate180) {
        pts = pts.map((v, i) => (i % 2 === 0 ? inp.pageW - v : inp.pageH - v));
      }
      pts = dropTiny(simplify(pts, speed.simplify), 0.05);
      return { pts, line: s.line };
    })
    .map((s) => (s.pts.length === 2 ? { pts: [s.pts[0], s.pts[1], s.pts[0] + 0.05, s.pts[1]], line: s.line } : s))
    .filter((s) => s.pts.length >= 4);

  // 2. порядок и склейка
  const ordered = orderStrokes(prepared, inp.reorder);
  const joined: { pts: number[]; line: number }[] = [];
  for (const s of ordered) {
    const last = joined[joined.length - 1];
    if (last && speed.joinTolerance > 0) {
      const lx = last.pts[last.pts.length - 2], ly = last.pts[last.pts.length - 1];
      if (Math.hypot(s.pts[0] - lx, s.pts[1] - ly) <= speed.joinTolerance && last.line === s.line) {
        last.pts = last.pts.concat(s.pts.slice(2));
        continue;
      }
    }
    joined.push({ pts: s.pts.slice(), line: s.line });
  }

  // 3. проверка границ листа
  const outOfBounds: number[] = [];
  const tol = 0.3;
  joined.forEach((s, i) => {
    for (let j = 0; j < s.pts.length; j += 2) {
      const u = s.pts[j], v = s.pts[j + 1];
      if (u < -tol || v < -tol || u > frame.width + tol || v > frame.height + tol) {
        outOfBounds.push(i);
        break;
      }
    }
  });

  // 4. G-код
  const z = penZ(inp.calib, pen.pressure);
  const feed = Math.min(feedOf(speed), limits.rapid);
  const zFeed = Math.max(50, Math.min(pen.zDownFeed, limits.zRate));
  const gcode: string[] = [];
  const lineStrokeArr: number[] = [];
  const strokeStart: number[] = [];
  const emit = (l: string, si: number) => {
    gcode.push(l);
    lineStrokeArr.push(si);
  };
  emit(`; Plotterm: ${inp.title}${inp.dryRun ? ' (сухой прогон)' : ''}`, -1);
  emit('G21 G90', -1);
  emit(`G0 Z${fmt(z.up)}`, -1);
  // люфт: при смене направления по оси мотор сначала «выбирает» зазор, а каретка стоит.
  // Пока ось едет в минус, отправляем координату на люфт меньше; при развороте — короткий
  // доворот только мотором (каретка не сдвигается, на бумаге следа нет)
  const [bu, bv] = inp.calib.backlash ?? [0, 0];
  const bl = frame.swap ? [Math.abs(bv), Math.abs(bu)] : [Math.abs(bu), Math.abs(bv)];
  const useBl = bl[0] > 0.005 || bl[1] > 0.005;
  const last = [NaN, NaN], dirs = [1, 1];
  const compensate = (x: number, y: number, si: number): [number, number] => {
    if (!useBl) return [x, y];
    const want = [x, y];
    let jump = false;
    for (let a = 0; a < 2; a++) {
      const d = Number.isNaN(last[a]) ? 0 : want[a] - last[a];
      if (Math.abs(d) > 0.001) {
        const nd = d > 0 ? 1 : -1;
        if (nd !== dirs[a] && bl[a] > 0.005) jump = true;
        dirs[a] = nd;
      }
    }
    const out: [number, number] = [x - (dirs[0] < 0 ? bl[0] : 0), y - (dirs[1] < 0 ? bl[1] : 0)];
    if (jump && !Number.isNaN(last[0])) {
      const jx = last[0] - (dirs[0] < 0 ? bl[0] : 0), jy = last[1] - (dirs[1] < 0 ? bl[1] : 0);
      emit(`G1 X${fmt(jx)} Y${fmt(jy)} F${Math.round(feed)}`, si);
    }
    last[0] = x;
    last[1] = y;
    return out;
  };
  let drawLength = 0;
  let travelLength = 0;
  let px = 0, py = 0;
  let first = true;
  const strokeTime: number[] = [];
  let t = 0;
  const vDraw = feed / 60;
  const vTravel = (speed.travelFeed > 0 ? Math.min(speed.travelFeed, limits.rapid) : limits.rapid) / 60;
  const a = Math.max(100, limits.accel);
  const dir = inp.calib.upZ >= 0 ? 1 : -1;
  const zRate = Math.max(50, limits.zRate) / 60; // мм/с
  const zAcc = Math.max(20, limits.zAccel);
  /** время хода по Z на расстояние d со скоростью v (трапеция) */
  const zMove = (d: number, v: number) => {
    d = Math.abs(d);
    if (d < 1e-6) return 0;
    const dAcc = (v * v) / zAcc;
    return d >= dAcc ? d / v + v / zAcc : 2 * Math.sqrt(d / zAcc);
  };
  // низкий подъём: только для коротких переездов в пределах строки
  const hop = Math.abs(pen.hopLift) > 0.05 ? dir * Math.min(Math.abs(pen.hopLift), Math.abs(z.up)) : z.up;
  const useHop = hop !== z.up && pen.hopDistance > 0;
  let tDraw = 0, tTravel = 0, tPen = 0;
  let curZ = z.up;

  joined.forEach((s, si) => {
    strokeTime.push(t);
    strokeStart.push(gcode.length);
    const [x0, y0] = compensate(...paperToWork(frame, s.pts[0], s.pts[1]), si);
    const travel = first ? 0 : Math.hypot(s.pts[0] - px, s.pts[1] - py);
    travelLength += travel;
    const tt = travel / vTravel + (travel > 0 ? 2 * Math.sqrt(travel / a) : 0);
    t += tt;
    tTravel += tt;
    if (speed.travelFeed > 0) emit(`G1 X${fmt(x0)} Y${fmt(y0)} F${Math.round(Math.min(speed.travelFeed, limits.rapid))}`, si);
    else emit(`G0 X${fmt(x0)} Y${fmt(y0)}`, si);
    if (!inp.dryRun) {
      if (pen.zDownRapid) emit(`G0 Z${fmt(z.down)}`, si);
      else emit(`G1 Z${fmt(z.down)} F${Math.round(zFeed)}`, si);
      if (pen.dwellMs > 0) emit(`G4 P${fmt(pen.dwellMs / 1000)}`, si);
      const td = zMove(curZ - z.down, pen.zDownRapid ? zRate : Math.min(zRate, zFeed / 60)) + pen.dwellMs / 1000;
      t += td;
      tPen += td;
      curZ = z.down;
    }
    let lx = fmt(x0), ly = fmt(y0);
    let firstMove = true;
    let prevAngle: number | null = null;
    let tStroke = 0;
    for (let j = 2; j < s.pts.length; j += 2) {
      const [x, y] = compensate(...paperToWork(frame, s.pts[j], s.pts[j + 1]), si);
      const fx = fmt(x), fy = fmt(y);
      if (fx === lx && fy === ly) continue;
      let cmd = firstMove ? 'G1 ' : '';
      // с поправкой на люфт доворот мог сдвинуть другую ось — пишем обе
      if (fx !== lx || useBl) cmd += 'X' + fx;
      if (fy !== ly || useBl) cmd += 'Y' + fy;
      if (firstMove) cmd += ` F${Math.round(feed)}`;
      emit(cmd, si);
      firstMove = false;
      const seg = Math.hypot(s.pts[j] - s.pts[j - 2], s.pts[j + 1] - s.pts[j - 1]);
      drawLength += seg;
      tStroke += seg / vDraw;
      const ang = Math.atan2(s.pts[j + 1] - s.pts[j - 1], s.pts[j] - s.pts[j - 2]);
      if (prevAngle !== null) {
        let d = Math.abs(ang - prevAngle);
        if (d > Math.PI) d = 2 * Math.PI - d;
        // торможение на поворотах: примерно v/a на резкий угол
        tStroke += (vDraw / a) * (d / Math.PI) * 1.2;
      }
      prevAngle = ang;
      lx = fx;
      ly = fy;
    }
    tStroke += 2 * (vDraw / a);
    t += tStroke;
    tDraw += tStroke;
    // подъём: низкий, если следующий штрих близко и в той же строке
    const next = joined[si + 1];
    const ex = s.pts[s.pts.length - 2], ey = s.pts[s.pts.length - 1];
    const short = useHop && !inp.dryRun && next && next.line === s.line && Math.hypot(next.pts[0] - ex, next.pts[1] - ey) <= pen.hopDistance;
    const liftTo = short ? hop : z.up;
    emit(`G0 Z${fmt(liftTo)}`, si);
    const tu = inp.dryRun ? 0 : zMove(liftTo - curZ, zRate);
    t += tu;
    tPen += tu;
    curZ = liftTo;
    px = ex;
    py = ey;
    first = false;
  });
  emit(`G0 Z${fmt(z.up)}`, -1);
  if (speed.park === 'zero') emit('G0 X0 Y0', -1);
  else if (speed.park === 'away') {
    const [x, y] = paperToWork(frame, 0, frame.height);
    emit(`G0 X${fmt(x)} Y${fmt(y)}`, -1);
  }

  const factor = inp.timeFactor && inp.timeFactor > 0.3 && inp.timeFactor < 3 ? inp.timeFactor : 1;
  return {
    strokes: joined.map((s) => s.pts),
    strokeLine: joined.map((s) => s.line),
    gcode,
    strokeStart,
    lineStroke: Int32Array.from(lineStrokeArr),
    outOfBounds,
    drawLength,
    travelLength,
    penLifts: joined.length,
    estSeconds: t * factor,
    strokeTime: strokeTime.map((x) => x * factor),
    timeDraw: tDraw * factor,
    timeTravel: tTravel * factor,
    timePen: tPen * factor,
  };
}

/** Длина ломаных (для статистики). */
export function totalLength(strokes: number[][]) {
  return strokes.reduce((a, s) => a + polyLength(s), 0);
}
