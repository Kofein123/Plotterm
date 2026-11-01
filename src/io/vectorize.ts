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
  /**
   * lines — по средней линии (схемы, рисунки линиями); outline — по контуру залитых мест (силуэты, жирные буквы);
   * auto — каждое пятно отдельно: тонкое — линией, толстое — контуром
   */
  mode?: VectorMode;
}

export type VectorMode = 'auto' | 'lines' | 'outline';

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

/** Порог Оцу по гистограмме яркости. */
export function otsu(data: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const n = data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; th = t; }
  }
  return th;
}

/**
 * Картинка «с компьютера» (рисунок, скриншот, значок): ровный белый фон, почти нет полутонов.
 * Для неё порог общий — иначе середина больших залитых мест не считается чернилами (она не темнее соседей).
 */
export function isCleanImage(g: Gray): boolean {
  let white = 0, mid = 0;
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i];
    if (v >= 225) white++;
    else if (v > 70 && v < 190) mid++;
  }
  return white / g.data.length > 0.3 && mid / g.data.length < 0.12;
}

function binarizeGlobal(g: Gray): Uint8Array {
  const th = Math.min(200, Math.max(60, otsu(g.data)));
  const out = new Uint8Array(g.data.length);
  for (let i = 0; i < out.length; i++) if (g.data[i] < th) out[i] = 1;
  return out;
}

/** Связные пятна (8 соседей): номер пятна для каждого пикселя, 0 — фон. */
function label(bin: Uint8Array, W: number, H: number): { lab: Int32Array; count: number } {
  const lab = new Int32Array(W * H);
  const stack: number[] = [];
  let count = 0;
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i] || lab[i]) continue;
    count++;
    lab[i] = count;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % W, y = (c / W) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (bin[n] && !lab[n]) { lab[n] = count; stack.push(n); }
        }
    }
  }
  return { lab, count };
}

/** Край пятна: пиксель чернил, у которого сверху/снизу/слева/справа фон. */
function isEdge(bin: Uint8Array, W: number, H: number, i: number): boolean {
  const x = i % W, y = (i / W) | 0;
  return x === 0 || y === 0 || x === W - 1 || y === H - 1 || !bin[i - 1] || !bin[i + 1] || !bin[i - W] || !bin[i + W];
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
  const bin = isCleanImage(img) ? binarizeGlobal(img) : binarize(img, opts.contrast ?? 0.14);
  removeSpecks(bin, W, H, Math.max(6, Math.round((W * H) / 40000)));
  const mode = opts.mode ?? 'lines';
  if (mode === 'lines') thin(bin, W, H);
  else {
    // скелет — для тонких пятен, контур — для толстых (средняя линия залитого круга — это точка, а не круг)
    const skel = bin.slice();
    thin(skel, W, H);
    const { lab, count } = label(bin, W, H);
    const area = new Float64Array(count + 1), sk = new Float64Array(count + 1);
    for (let i = 0; i < bin.length; i++) if (lab[i]) { area[lab[i]]++; if (skel[i]) sk[lab[i]]++; }
    const thick = Math.max(5, W / 120);
    const outline = (k: number) => mode === 'outline' || area[k] / Math.max(1, sk[k]) > thick;
    const res = new Uint8Array(W * H);
    for (let i = 0; i < bin.length; i++) {
      const k = lab[i];
      if (!k) continue;
      if (outline(k) ? isEdge(bin, W, H, i) : skel[i]) res[i] = 1;
    }
    thin(res, W, H);
    bin.set(res);
  }
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
