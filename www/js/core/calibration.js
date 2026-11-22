export const DEFAULT_CALIBRATION = {
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
/** Оси станка в порядке «вдоль ширины листа, вдоль высоты» */
const axes = (swap, x, y) => (swap ? [y, x] : [x, y]);
export function sheetFrame(c) {
    const swap = !!c.swap;
    const [ca, cb] = axes(swap, c.corner[0], c.corner[1]);
    const sx = ca < 0 ? -1 : 1;
    const sy = cb < 0 ? -1 : 1;
    let theta = 0;
    if (c.skewPoint) {
        const [pa, pb] = axes(swap, c.skewPoint[0], c.skewPoint[1]);
        const bu = sx * pa;
        const bv = sy * pb;
        if (Math.hypot(bu, bv) > 20)
            theta = Math.atan2(bv, bu);
    }
    // размер листа в бумажной системе (с учётом поворота)
    const cu = sx * ca;
    const cv = sy * cb;
    const width = cu * Math.cos(theta) + cv * Math.sin(theta);
    const height = -cu * Math.sin(theta) + cv * Math.cos(theta);
    return { swap, sx, sy, theta, width: Math.abs(width), height: Math.abs(height), ready: c.zeroSet && c.cornerSet };
}
export function paperToWork(f, u, v) {
    const c = Math.cos(f.theta);
    const s = Math.sin(f.theta);
    const ur = u * c - v * s;
    const vr = u * s + v * c;
    return axes(f.swap, f.sx * ur, f.sy * vr);
}
export function workToPaper(f, x, y) {
    const c = Math.cos(f.theta);
    const s = Math.sin(f.theta);
    const [a, b] = axes(f.swap, x, y);
    const ur = f.sx * a;
    const vr = f.sy * b;
    return [ur * c + vr * s, -ur * s + vr * c];
}
/** Направление «вверх» для Z и Z опущенной ручки (с нажимом). */
export function penZ(c, pressure) {
    const dir = c.upZ >= 0 ? 1 : -1;
    return { up: c.upZ, down: -dir * Math.abs(pressure) };
}
