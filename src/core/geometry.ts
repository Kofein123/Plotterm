// Геометрия ломаных: упрощение, длины, расстояния.

/** Упрощение Дугласа–Пекера для плоского массива [x0,y0,x1,y1,...]. */
export function simplify(pts: number[], tol: number): number[] {
  const n = pts.length / 2;
  if (n <= 2 || tol <= 0) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a * 2], ay = pts[a * 2 + 1];
    const bx = pts[b * 2], by = pts[b * 2 + 1];
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(pts[i * 2], pts[i * 2 + 1], ax, ay, bx, by);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

/** Убрать подряд идущие точки ближе minLen (кроме последней). */
export function dropTiny(pts: number[], minLen: number): number[] {
  if (pts.length <= 4) return pts;
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length - 2; i += 2) {
    const lx = out[out.length - 2], ly = out[out.length - 1];
    if (Math.hypot(pts[i] - lx, pts[i + 1] - ly) >= minLen) out.push(pts[i], pts[i + 1]);
  }
  out.push(pts[pts.length - 2], pts[pts.length - 1]);
  return out;
}

export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

export function polyLength(pts: number[]): number {
  let l = 0;
  for (let i = 2; i < pts.length; i += 2) l += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return l;
}

export function polyDist2(pts: number[], x: number, y: number): number {
  if (pts.length < 4) return (pts[0] - x) ** 2 + (pts[1] - y) ** 2;
  let best = Infinity;
  for (let i = 2; i < pts.length; i += 2) {
    const d = segDist2(x, y, pts[i - 2], pts[i - 1], pts[i], pts[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

export function reversePts(pts: number[]): number[] {
  const out = new Array(pts.length);
  for (let i = 0, j = pts.length - 2; j >= 0; i += 2, j -= 2) {
    out[i] = pts[j];
    out[i + 1] = pts[j + 1];
  }
  return out;
}
