// Связь бумажных координат (u вправо, v вниз от угла листа) с рабочими координатами станка (X, Y).
// Ноль станка ставится в левый верхний угол листа, противоположный угол задаёт размер листа
// и заодно направление осей: если X угла отрицательный — ось X «смотрит» влево, и т. п.
import type { Calibration } from './types.ts';

export const DEFAULT_CALIBRATION: Calibration = {
  penSet: false,
  upZ: 2,
  zeroSet: false,
  cornerSet: false,
  corner: [210, 297],
  skewPoint: null,
  gridOrigin: null,
  lastMPos: null,
  stale: false,
};

export interface SheetFrame {
  sx: 1 | -1;
  sy: 1 | -1;
  theta: number;
  width: number;
  height: number;
  ready: boolean;
}

export function sheetFrame(c: Calibration): SheetFrame {
  const sx: 1 | -1 = c.corner[0] < 0 ? -1 : 1;
  const sy: 1 | -1 = c.corner[1] < 0 ? -1 : 1;
  let theta = 0;
  if (c.skewPoint) {
    const bu = sx * c.skewPoint[0];
    const bv = sy * c.skewPoint[1];
    if (Math.hypot(bu, bv) > 20) theta = Math.atan2(bv, bu);
  }
  // размер листа в бумажной системе (с учётом поворота)
  const cu = sx * c.corner[0];
  const cv = sy * c.corner[1];
  const width = cu * Math.cos(theta) + cv * Math.sin(theta);
  const height = -cu * Math.sin(theta) + cv * Math.cos(theta);
  return { sx, sy, theta, width: Math.abs(width), height: Math.abs(height), ready: c.zeroSet && c.cornerSet };
}

export function paperToWork(f: SheetFrame, u: number, v: number): [number, number] {
  const c = Math.cos(f.theta);
  const s = Math.sin(f.theta);
  const ur = u * c - v * s;
  const vr = u * s + v * c;
  return [f.sx * ur, f.sy * vr];
}

export function workToPaper(f: SheetFrame, x: number, y: number): [number, number] {
  const c = Math.cos(f.theta);
  const s = Math.sin(f.theta);
  const ur = f.sx * x;
  const vr = f.sy * y;
  return [ur * c + vr * s, -ur * s + vr * c];
}

/** Направление «вверх» для Z и Z опущенной ручки (с нажимом). */
export function penZ(c: Calibration, pressure: number) {
  const dir = c.upZ >= 0 ? 1 : -1;
  return { up: c.upZ, down: -dir * Math.abs(pressure) };
}
