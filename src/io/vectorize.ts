// Картинка (схема, чертёж, график) → линии для ручки: порог с поправкой на неровный свет, скелет, ломаные.
// Плоттер рисует одной линией, поэтому залитые места превращаются в свою «среднюю линию», а мелкий шум отбрасывается.
import type { Gray } from './templateImport.ts';
import { pruneStairs, smooth, thin, trace } from './outlinefont.ts';
import { simplify } from '../core/geometry.ts';

/** Рисунок в долях ширины: x от 0 до 1, y от 0 до aspect (высота / ширина). */
export interface VectorDrawing {
  aspect: number;
  paths: number[][];
}

export interface VectorizeOptions {
  /** рабочее разрешение по длинной стороне, px */
  size?: number;
  /** насколько пиксель темнее соседей, чтобы считаться линией (0–1) */
  contrast?: number;
  /** штрихи короче этой доли ширины отбрасываются */
  minLen?: number;
}

function resize(g: Gray, maxSide: number): Gray {
  const k = Math.min(1, maxSide / Math.max(g.w, g.h));
  if (k >= 1) return g;
  const w = Math.max(1, Math.round(g.w * k)), h = Math.max(1, Math.round(g.h * k));
  const data = new Uint8Array(w * h);
  // усреднение по блоку: тонкие линии не пропадают, как при выборке ближайшего
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / k), x1 = Math.min(g.w, Math.ceil((x + 1) / k));
      const y0 = Math.floor(y / k), y1 = Math.min(g.h, Math.ceil((y + 1) / k));
      let s = 0, n = 0, mn = 255;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const v = g.data[yy * g.w + xx];
          s += v;
          n++;
          if (v < mn) mn = v;
        }
      // тёмная линия в блоке важнее светлого фона вокруг
      data[y * w + x] = n ? Math.round((s / n) * 0.5 + mn * 0.5) : 255;
    }
  return { w, h, data };
}

/** Чернила: пиксель заметно темнее среднего по окрестности и не светлее бумаги. */
export function binarize(g: Gray, contrast = 0.14): Uint8Array {
  const { w, h, data } = g;
  const r = Math.max(4, Math.round(Math.max(w, h) / 40));
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = data[y * w + x];
      if (v < 215 && v < mean * (1 - contrast) - 4) out[y * w + x] = 1;
    }
  return out;
}

function removeSpecks(bin: Uint8Array, W: number, H: number, minArea: number) {
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i] || seen[i]) continue;
    const comp: number[] = [];
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      const x = c % W, y = (c / W) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (bin[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
    }
    if (comp.length < minArea) for (const c of comp) bin[c] = 0;
  }
}

function length(p: number[]) {
  let l = 0;
  for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return l;
}

export function vectorize(g: Gray, opts: VectorizeOptions = {}): VectorDrawing {
  const img = resize(g, opts.size ?? 900);
  const { w: W, h: H } = img;
  const bin = binarize(img, opts.contrast ?? 0.14);
  removeSpecks(bin, W, H, Math.max(6, Math.round((W * H) / 40000)));
  thin(bin, W, H);
  pruneStairs(bin, W, H);
  const raw = trace(bin, W, H, Math.max(3, W / 150));
  const minLen = (opts.minLen ?? 0.012) * W;
  const paths: number[][] = [];
  for (const p of raw) {
    if (p.length < 4 || length(p) < minLen) continue;
    const s = simplify(smooth(p), 0.6);
    const out: number[] = new Array(s.length);
    for (let i = 0; i < s.length; i += 2) {
      out[i] = Math.round((s[i] / W) * 10000) / 10000;
      out[i + 1] = Math.round((s[i + 1] / W) * 10000) / 10000;
    }
    paths.push(out);
  }
  return { aspect: H / W, paths };
}

/** Рамка с диагоналями — заглушка, если картинку не удалось прочитать. */
export function placeholderDrawing(aspect = 0.6): VectorDrawing {
  return { aspect, paths: [[0, 0, 1, 0, 1, aspect, 0, aspect, 0, 0]] };
}
