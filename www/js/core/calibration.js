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
export function sheetFrame(c) {
    const sx = c.corner[0] < 0 ? -1 : 1;
    const sy = c.corner[1] < 0 ? -1 : 1;
    let theta = 0;
    if (c.skewPoint) {
        const bu = sx * c.skewPoint[0];
        const bv = sy * c.skewPoint[1];
        if (Math.hypot(bu, bv) > 20)
            theta = Math.atan2(bv, bu);
    }
    // размер листа в бумажной системе (с учётом поворота)
    const cu = sx * c.corner[0];
    const cv = sy * c.corner[1];
    const width = cu * Math.cos(theta) + cv * Math.sin(theta);
    const height = -cu * Math.sin(theta) + cv * Math.cos(theta);
    return { sx, sy, theta, width: Math.abs(width), height: Math.abs(height), ready: c.zeroSet && c.cornerSet };
}
export function paperToWork(f, u, v) {
    const c = Math.cos(f.theta);
    const s = Math.sin(f.theta);
    const ur = u * c - v * s;
    const vr = u * s + v * c;
    return [f.sx * ur, f.sy * vr];
}
export function workToPaper(f, x, y) {
    const c = Math.cos(f.theta);
    const s = Math.sin(f.theta);
    const ur = f.sx * x;
    const vr = f.sy * y;
    return [ur * c + vr * s, -ur * s + vr * c];
}
/** Направление «вверх» для Z и Z опущенной ручки (с нажимом). */
export function penZ(c, pressure) {
    const dir = c.upZ >= 0 ? 1 : -1;
    return { up: c.upZ, down: -dir * Math.abs(pressure) };
}
