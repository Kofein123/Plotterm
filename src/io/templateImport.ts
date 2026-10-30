// Фото заполненного листа-шаблона → буквы своего почерка.
//   1) найти четыре чёрные метки по углам и выпрямить лист (гомография);
//   2) из каждой клетки взять чернила порогом (голубые направляющие и серые подписи светлее — уходят);
//   3) скелет → ломаные (как при импорте TTF), порядок и направление штрихов как у руки, точки входа/выхода.
// Без DOM: на вход — яркость пикселей, поэтому всё проверяется тестами в node.
import type { GlyphData } from '../fonts/types.ts';
import { CUSTOM_X_HEIGHT } from '../fonts/fonts.ts';
import { simplify } from '../core/geometry.ts';
import { extractDots, pruneStairs, smooth, thin, trace } from './outlinefont.ts';
import { LABEL_H, MARKS, MARK_SIZE, SHEET_W, X_HEIGHT, templateCells, type TemplateCell } from './template.ts';

/** Яркость 0–255, построчно. */
export interface Gray {
  w: number;
  h: number;
  data: Uint8Array;
}

export type Homography = number[]; // 3×3 по строкам

/** Гомография по четырём парам точек: from (лист, мм) → to (фото, пиксели). */
export function homography(from: [number, number][], to: [number, number][]): Homography {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Гаусс с выбором главного элемента
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) throw new Error('метки на фото стоят вырожденно');
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [...h, 1];
}

export function project(H: Homography, x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

function sample(g: Gray, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= g.w - 1 || y0 >= g.h - 1) return 255;
  const fx = x - x0, fy = y - y0;
  const i = y0 * g.w + x0;
  const d = g.data;
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + g.w] * (1 - fx) + d[i + g.w + 1] * fx) * fy;
}

function percentile(values: ArrayLike<number>, p: number): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) hist[Math.max(0, Math.min(255, values[i] | 0))]++;
  let need = values.length * p;
  for (let v = 0; v < 256; v++) {
    need -= hist[v];
    if (need <= 0) return v;
  }
  return 255;
}

/** Найти четыре угловые метки. Порядок как в MARKS: левый верхний, правый верхний, правый нижний, левый нижний. */
export function findMarks(g: Gray): [number, number][] | null {
  // работаем на уменьшенной копии: метки крупные
  const step = Math.max(1, Math.ceil(Math.max(g.w, g.h) / 1200));
  const W = Math.floor(g.w / step), H = Math.floor(g.h / step);
  const small = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) small[y * W + x] = g.data[y * step * g.w + x * step];
  const paper = percentile(small, 0.85);
  const thr = paper * 0.45;
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < dark.length; i++) dark[i] = small[i] < thr ? 1 : 0;
  // ожидаемый размер метки: 8 мм из 210 мм ширины листа, лист занимает 40–100 % кадра
  const big = Math.max(W, H);
  const minSide = big * (MARK_SIZE / 297) * 0.3;
  const maxSide = big * (MARK_SIZE / SHEET_W) * 1.6;
  const cands: { x: number; y: number }[] = [];
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let i = 0; i < dark.length; i++) {
    if (!dark[i] || seen[i]) continue;
    let n = 0, sx = 0, sy = 0, minX = W, minY = H, maxX = 0, maxY = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % W, y = (c / W) | 0;
      n++; sx += x; sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && dark[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; stack.push(c - 1); }
      if (x < W - 1 && dark[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; stack.push(c + 1); }
      if (y > 0 && dark[c - W] && !seen[c - W]) { seen[c - W] = 1; stack.push(c - W); }
      if (y < H - 1 && dark[c + W] && !seen[c + W]) { seen[c + W] = 1; stack.push(c + W); }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide) continue;
    if (bw / bh < 0.55 || bw / bh > 1.8) continue;
    if (n / (bw * bh) < 0.6) continue;
    cands.push({ x: (sx / n + 0.5) * step, y: (sy / n + 0.5) * step });
  }
  if (cands.length < 4) return null;
  const corners: [number, number][] = [[0, 0], [g.w, 0], [g.w, g.h], [0, g.h]];
  const out: [number, number][] = [];
  const used = new Set<number>();
  for (const [cx, cy] of corners) {
    let best = -1, bd = Infinity;
    cands.forEach((c, i) => {
      const d = Math.hypot(c.x - cx, c.y - cy);
      if (!used.has(i) && d < bd) { bd = d; best = i; }
    });
    used.add(best);
    out.push([cands[best].x, cands[best].y]);
  }
  // метки должны образовывать выпуклый четырёхугольник в правильном порядке (по часовой на фото)
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = out[i], [bx, by] = out[(i + 1) % 4], [cx, cy] = out[(i + 2) % 4];
    if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) <= 0) return null;
  }
  return out;
}

/** пикселей на мм при вырезании клетки */
const RES = 10;

export interface CellResult {
  ch: string;
  glyph: GlyphData | null;
}

/** Чернила клетки → глиф в единицах шрифта (x-высота = 100, базовая линия y = 0). */
const INSET = 0.5;

/** Яркость области письма клетки в растре RES пикс/мм. */
function cellLum(g: Gray, H: Homography, cell: TemplateCell) {
  const x0 = cell.x + INSET, y0 = cell.y + INSET;
  const W = Math.round((cell.w - 2 * INSET) * RES), Hh = Math.round((cell.h - 2 * INSET) * RES);
  const lum = new Uint8Array(W * Hh);
  for (let y = 0; y < Hh; y++)
    for (let x = 0; x < W; x++) {
      const [u, v] = project(H, x0 + (x + 0.5) / RES, y0 + (y + 0.5) / RES);
      lum[y * W + x] = sample(g, u, v);
    }
  return { lum, W, Hh, y0 };
}

/**
 * Лист на фото редко лежит идеально плоско: выгнутая бумага сдвигает клетки на миллиметр-два от расчётных,
 * и буква режется краем. Уточняем положение клетки по её печатным линиям: края клетки и базовая линия
 * тянутся на всю ширину и дают острые «гребни» в профиле яркости, буквы — нет.
 */
export function cellShift(g: Gray, H: Homography, cell: TemplateCell, SHIFT = 2.5): [number, number] {
  const R = 5; // пикс/мм — для поиска линий хватает
  const top = cell.y - LABEL_H;
  const x0 = cell.x - SHIFT - 1, y0 = top - SHIFT - 1;
  const W = Math.round((cell.w + 2 * SHIFT + 2) * R), Hh = Math.round((cell.h + LABEL_H + 2 * SHIFT + 2) * R);
  const d = new Uint8Array(W * Hh);
  for (let y = 0; y < Hh; y++)
    for (let x = 0; x < W; x++) {
      const [u, v] = project(H, x0 + (x + 0.5) / R, y0 + (y + 0.5) / R);
      d[y * W + x] = 255 - sample(g, u, v);
    }
  // медиана по строке/столбцу: печатная линия тёмная по всей длине, штрих буквы — лишь на части
  const med = (vals: number[]) => vals.sort((a, b) => a - b)[vals.length >> 1];
  const col = Float64Array.from({ length: W }, (_, x) => med(Array.from({ length: Hh }, (_, y) => d[y * W + x])));
  const row = Float64Array.from({ length: Hh }, (_, y) => med(Array.from(d.subarray(y * W, y * W + W))));
  // гребень: тёмная полоса уже ~1 мм светлее соседей
  const ridge = (p: Float64Array, mm: number) => {
    const i = Math.round((mm + 0.0) * R);
    const at = (k: number) => p[Math.max(0, Math.min(p.length - 1, k))];
    const c = Math.max(at(i - 1), at(i), at(i + 1));
    return c - (at(i - 4) + at(i + 4)) / 2;
  };
  const best = (p: Float64Array, lines: number[]) => {
    let bs = 0, bv = -Infinity, zero = 0;
    for (let s = -SHIFT; s <= SHIFT + 1e-9; s += 1 / R) {
      const v = lines.reduce((a, m) => a + ridge(p, m + s), 0);
      if (Math.abs(s) < 1e-9) zero = v;
      if (v > bv) { bv = v; bs = s; }
    }
    // сдвигаем, только если линии на новом месте заметно чётче, чем на расчётном
    return bv > zero * 1.15 + 1e-9 ? bs : 0;
  };
  const dx = best(col, [cell.x - x0, cell.x + cell.w - x0]);
  const dy = best(row, [top - y0, cell.baseline - y0, cell.y + cell.h - y0]);
  return [dx, dy];
}

function flatten(lum: Uint8Array, W: number, H: number, r: number): Uint8Array {
  const tmp = new Uint8Array(W * H), bg = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) m = Math.max(m, lum[y * W + k]);
      tmp[y * W + x] = m;
    }
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) m = Math.max(m, tmp[k * W + x]);
      bg[y * W + x] = m;
    }
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = bg[i] ? Math.min(255, Math.round((lum[i] * 255) / bg[i])) : 255;
  return out;
}

/** Гауссово сглаживание точек вдоль ломаной (sigma — в пикселях пути); замкнутую петлю гладим по кругу. */
function smoothChain(p: number[], sigma: number): number[] {
  const n = p.length / 2;
  if (n < 4) return p;
  const closed = Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]) < 2;
  const r = Math.ceil(sigma * 2);
  const w = Array.from({ length: r * 2 + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)));
  const out = p.slice();
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue;
    let sx = 0, sy = 0, sw = 0;
    for (let k = -r; k <= r; k++) {
      let j = i + k;
      if (closed) j = ((j % (n - 1)) + (n - 1)) % (n - 1);
      else if (j < 0 || j >= n) continue;
      // у открытого конца окно сужаем симметрично, иначе конец штриха «съёживается»
      if (!closed && (i - Math.abs(k) < 0 || i + Math.abs(k) > n - 1)) continue;
      sx += p[j * 2] * w[k + r];
      sy += p[j * 2 + 1] * w[k + r];
      sw += w[k + r];
    }
    out[i * 2] = sx / sw;
    out[i * 2 + 1] = sy / sw;
  }
  if (closed) { out[out.length - 2] = out[0]; out[out.length - 1] = out[1]; }
  return out;
}

/** Срезание углов Чайкина: ломаная становится плавной кривой, концы на месте. */
function chaikin(p: number[], passes: number): number[] {
  let cur = p;
  for (let k = 0; k < passes && cur.length >= 6; k++) {
    const out = [cur[0], cur[1]];
    for (let i = 0; i + 3 < cur.length; i += 2) {
      const [x0, y0, x1, y1] = [cur[i], cur[i + 1], cur[i + 2], cur[i + 3]];
      out.push(x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25, x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75);
    }
    out.push(cur[cur.length - 2], cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

/** символы, у которых бывают отдельные точки; у остальных точка — случайная капля пасты */
const DOTTED = /[ёйіЁЙІijäöü.,:;!?"%№…«»*÷]/u;

/** Чернила клетки → глиф в единицах шрифта (x-высота = 100, базовая линия y = 0). */
export function readCell(g: Gray, H: Homography, cell: TemplateCell): GlyphData | null {
  const inset = INSET;
  const { lum: raw, W, Hh, y0 } = cellLum(g, H, cell);
  // тень от руки или телефона: яркость бумаги меняется даже внутри клетки. Делим на местный фон —
  // максимум в окне 3 мм (штрих уже, так что в окно всегда попадает бумага)
  const lum = flatten(raw, W, Hh, Math.round(1.5 * RES));
  const paper = percentile(lum, 0.9);
  const thr = paper * 0.62;
  const bin = new Uint8Array(W * Hh);
  let ink = 0;
  for (let i = 0; i < bin.length; i++) if (lum[i] < thr) { bin[i] = 1; ink++; }
  // гистерезис: светлая шариковая паста рвёт штрих; бледные пиксели берём, если они продолжают уверенный штрих —
  // не дальше ~0,3 мм от него, иначе по серой печатной линии «натечёт» через всю клетку
  const weak = paper * 0.75;
  let front: number[] = [];
  for (let i = 0; i < bin.length; i++) if (bin[i]) front.push(i);
  for (let step = 0; step < 3 && front.length; step++) {
    const next: number[] = [];
    for (const i of front) {
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= Hh) continue;
          const j = yy * W + xx;
          if (!bin[j] && lum[j] < weak) { bin[j] = 1; next.push(j); }
        }
    }
    front = next;
  }
  // печатные линии клетки (на ч/б принтере они выходят тёмными): базовая, пунктир x-высоты, края клетки
  const by = (cell.baseline - y0) * RES;
  const XH = cell.xh ?? X_HEIGHT;
  // найденная на фото базовая линия точнее расчётной: лист бывает выгнут, а фото — с искажениями объектива
  const foundBase = eraseLine(bin, W, Hh, by, true, 2);
  for (const y of [(foundBase ?? by) - XH * RES, ...(cell.guides ?? []).map((g) => (foundBase ?? by) - g * RES), -inset * RES, (cell.h - inset) * RES]) eraseLine(bin, W, Hh, y, true);
  for (const x of [-inset * RES, (cell.w - inset) * RES]) eraseLine(bin, W, Hh, x, false);
  // обрывки пунктира и полутонов: тонкие плоские пятна, целиком лежащие на линии
  const lineRows = [foundBase ?? by, (foundBase ?? by) - XH * RES, ...(cell.guides ?? []).map((g) => (foundBase ?? by) - g * RES)];
  for (const c of components(bin, W, Hh)) {
    const h = c.maxY - c.minY + 1, w = c.maxX - c.minX + 1;
    if (h > 0.4 * RES || w > 2 * RES) continue;
    if (lineRows.some((y) => c.minY >= y - 0.5 * RES && c.maxY <= y + 0.5 * RES)) for (const i of c.px) bin[i] = 0;
  }
  removeSpecks(bin, W, Hh, 6);
  dropStrays(bin, W, Hh);
  ink = bin.reduce((a, b) => a + b, 0);
  // пустая клетка: меньше ~0,15 мм² чернил (точка ручкой — около 0,2 мм²)
  if (ink < 0.15 * RES * RES) return null;
  const before = ink;
  const dots = extractDots(bin, W, Hh, XH * RES * 0.36);
  thin(bin, W, Hh);
  pruneStairs(bin, W, Hh);
  let skel = 0;
  for (let i = 0; i < bin.length; i++) skel += bin[i];
  let paths = joinChains(trace(bin, W, Hh, Math.max(3, (before / Math.max(skel, 1)) * 0.9)), 2.5);
  // плоские огрызки печатной линии, пережившие стирание: на странице они выглядят как лишние точки
  if (/[\p{L}\p{N}]/u.test(cell.ch) && paths.length > 1) {
    const rows = lineRows;
    const near = (p: number[], q: number[]) => {
      for (let i = 0; i < p.length; i += 2) for (let j = 0; j < q.length; j += 2) if (Math.hypot(p[i] - q[j], p[i + 1] - q[j + 1]) < 0.6 * RES) return true;
      return false;
    };
    paths = paths.filter((p) => {
      if (paths.some((q) => q !== p && near(p, q))) return true;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
      const flat = x1 - x0 < 1.6 * RES && y1 - y0 < 0.4 * RES;
      if (flat && rows.some((y) => Math.abs((y0 + y1) / 2 - y) < 0.7 * RES)) return false;
      // остаток вертикального края клетки
      const edge = x1 < 1.2 * RES || x0 > W - 1.2 * RES;
      if (edge && x1 - x0 < 0.5 * RES && y1 - y0 > 2 * RES) return false;
      return true;
    });
  }
  // выше 8 мм над строкой букв не бывает (в крупной клетке — выше верха клетки): это подпись или чужая буква сверху
  const ceiling = (foundBase ?? by) - Math.max(8, cell.baseline - cell.y) * RES;
  paths = paths.filter((p) => p.some((v, i) => i % 2 === 1 && v > ceiling));
  // крошечный отдельный штрих (меньше 0,7 мм) у буквы без точек — капля или соринка
  if (!DOTTED.test(cell.ch) && paths.length > 1) {
    const ext = (p: number[]) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
      return Math.max(x1 - x0, y1 - y0);
    };
    const near = (p: number[], q: number[]) => {
      for (let i = 0; i < p.length; i += 2) for (let j = 0; j < q.length; j += 2) if (Math.hypot(p[i] - q[j], p[i + 1] - q[j + 1]) < 0.6 * RES) return true;
      return false;
    };
    const kept = paths.filter((p) => ext(p) >= 0.7 * RES || paths.some((q) => q !== p && near(p, q)));
    if (kept.length) paths = kept;
  }
  // точки над ё, й, і стоят выше пунктира; «точка» прямо на линии у буквы — это кусок штриха печатной линии
  const lineYs = lineRows;
  const isText = /[\p{L}\p{N}]/u.test(cell.ch);
  for (const [cx, cy, r] of dots) {
    if (cy < ceiling || !DOTTED.test(cell.ch)) continue;
    // у ё, й, і точки только сверху
    if (/\p{L}/u.test(cell.ch) && cy > (foundBase ?? by) - XH * RES * 0.45) continue;
    if (isText && lineYs.some((y) => Math.abs(cy - y) < 0.6 * RES)) continue;
    paths.push([cx - r * 0.35, cy, cx + r * 0.35, cy]);
  }
  if (!paths.length) return null;
  const k = CUSTOM_X_HEIGHT / (XH * RES);
  const basePx = foundBase ?? by;
  const strokes: number[][] = [];
  for (const p of paths) {
    // скелет из пикселей идёт «лесенкой»: гладим вдоль штриха на ~0,3 мм, затем скругляем углы ломаной
    const simp = chaikin(simplify(smoothChain(smooth(p), 0.3 * RES), 0.35), 2);
    const out: number[] = [];
    for (let i = 0; i < simp.length; i += 2) out.push(simp[i] * k, (basePx - simp[i + 1]) * k);
    if (out.length >= 4) strokes.push(out);
  }
  if (!strokes.length) return null;
  return toGlyph(orderStrokes(strokes), /\p{Ll}/u.test(cell.ch));
}

/**
 * После удаления «усиков» на остром углу (м, л, 4) линия остаётся разрезанной на две.
 * Склеиваем концы, где сходятся ровно два штриха, — под любым углом: рука там ручку не отрывала.
 */
export function joinChains(paths: number[][], tol: number): number[][] {
  const out = paths.map((p) => p.slice());
  const near = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by) <= tol;
  const ends = (p: number[]): [number, number][] => [[p[0], p[1]], [p[p.length - 2], p[p.length - 1]]];
  let merged = true;
  while (merged) {
    merged = false;
    search: for (let i = 0; i < out.length; i++) {
      for (const [ei, [x, y]] of ends(out[i]).entries()) {
        // кто ещё касается этой точки
        const touch: [number, number][] = [];
        out.forEach((q, j) => ends(q).forEach(([qx, qy], ej) => { if (near(x, y, qx, qy) && !(j === i && ej === ei)) touch.push([j, ej]); }));
        if (touch.length !== 1 || touch[0][0] === i) continue;
        const [j, ej] = touch[0];
        const a = ei === 1 ? out[i] : rev(out[i]);
        const b = ej === 0 ? out[j] : rev(out[j]);
        out[i] = a.concat(b.slice(2));
        out.splice(j, 1);
        merged = true;
        break search;
      }
    }
  }
  return out;
}

/**
 * Стереть печатную линию около ожидаемого положения pos (пиксели): ищем ряд/столбец с наибольшим числом
 * тёмных точек в окне ±searchMm (фото чуть искажает лист) и стираем те её куски, где поперёк линии
 * тонко (печатная линия ≈ 0,25 мм, штрих ручки ≈ 0,5 мм и толще). Возвращает найденный ряд.
 */
function eraseLine(bin: Uint8Array, W: number, H: number, pos: number, horizontal: boolean, searchMm = 1.5): number | null {
  const len = horizontal ? W : H, across = horizontal ? H : W;
  const at = (a: number, b: number) => (horizontal ? bin[b * W + a] : bin[a * W + b]); // a — вдоль линии, b — поперёк
  const set0 = (a: number, b: number) => { if (horizontal) bin[b * W + a] = 0; else bin[a * W + b] = 0; };
  const win = Math.round(searchMm * RES);
  let best = -1, bestN = 0;
  for (let b = Math.round(pos) - win; b <= Math.round(pos) + win; b++) {
    if (b < 0 || b >= across) continue;
    let n = 0;
    for (let a = 0; a < len; a++) n += at(a, b);
    if (n > bestN) { bestN = n; best = b; }
  }
  if (best < 0 || bestN < len * 0.25) return null;
  const thick = Math.round(0.4 * RES), near = Math.round(0.3 * RES);
  const lo = new Int32Array(len).fill(-1), hi = new Int32Array(len).fill(-1);
  const lineOnly = new Uint8Array(len);
  for (let a = 0; a < len; a++) {
    let l = -1;
    for (let d = 0; d <= near && l < 0; d++) {
      if (best - d >= 0 && at(a, best - d)) l = best - d;
      else if (best + d < across && at(a, best + d)) l = best + d;
    }
    if (l < 0) continue;
    let h = l;
    while (l - 1 >= 0 && at(a, l - 1)) l--;
    while (h + 1 < across && at(a, h + 1)) h++;
    if (h - l + 1 <= thick) { lineOnly[a] = 1; lo[a] = l; hi[a] = h; }
  }
  // стираем только длинные куски (≥ 1 мм, через разрывы пунктира до 0,6 мм): точка на линии остаётся
  const minRun = RES, maxGap = Math.round(0.6 * RES);
  for (let a = 0; a < len; ) {
    if (!lineOnly[a]) { a++; continue; }
    let ext = a;
    while (ext < len && lineOnly[ext]) ext++;
    for (;;) {
      let gap = ext;
      while (gap < len && !lineOnly[gap] && gap - ext < maxGap) gap++;
      if (gap >= len || !lineOnly[gap]) break;
      ext = gap;
      while (ext < len && lineOnly[ext]) ext++;
    }
    if (ext - a >= minRun) for (let k = a; k < ext; k++) if (lineOnly[k]) for (let q = lo[k]; q <= hi[k]; q++) set0(k, q);
    a = ext;
  }
  return best;
}

/** Убрать обрывки рядом с буквой (край соседней клетки, подпись): мелкое пятно, не перекрывающее букву по горизонтали. */
function dropStrays(bin: Uint8Array, W: number, H: number) {
  const comps = components(bin, W, H);
  if (comps.length < 2) return;
  const main = comps.reduce((a, b) => (b.px.length > a.px.length ? b : a));
  for (const c of comps) {
    if (c === main || c.px.length > main.px.length * 0.25) continue;
    const apart = c.maxX < main.minX - RES || c.minX > main.maxX + RES;
    if (apart) for (const i of c.px) bin[i] = 0;
  }
}

function components(bin: Uint8Array, W: number, H: number) {
  const seen = new Uint8Array(W * H);
  const out: { px: number[]; minX: number; maxX: number; minY: number; maxY: number }[] = [];
  const stack: number[] = [];
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i] || seen[i]) continue;
    const px: number[] = [];
    let minX = W, maxX = 0, minY = H, maxY = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      px.push(c);
      const x = c % W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      const y = (c / W) | 0;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const n of [c - 1, c + 1, c - W, c + W, c - W - 1, c - W + 1, c + W - 1, c + W + 1]) {
        if (n < 0 || n >= bin.length || Math.abs((n % W) - x) > 1 || !bin[n] || seen[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    out.push({ px, minX, maxX, minY, maxY });
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
      const x = c % W;
      for (const n of [c - 1, c + 1, c - W, c + W, c - W - 1, c - W + 1, c + W - 1, c + W + 1]) {
        if (n < 0 || n >= bin.length || Math.abs((n % W) - x) > 1 || !bin[n] || seen[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (comp.length < minArea) for (const c of comp) bin[c] = 0;
  }
}

/**
 * Порядок и направление штрихов как у руки: слева направо; горизонтальный штрих — слева направо,
 * вертикальный — сверху вниз; замкнутая петля (о) — от верхней правой точки против часовой.
 */
export function orderStrokes(strokes: number[][]): number[][] {
  const oriented = strokes.map((s) => {
    const n = s.length / 2;
    const closed = n > 4 && Math.hypot(s[0] - s[s.length - 2], s[1] - s[s.length - 1]) < 8;
    if (closed) return orientLoop(s);
    const dx = s[s.length - 2] - s[0], dy = s[s.length - 1] - s[1];
    const flip = Math.abs(dx) >= Math.abs(dy) * 0.6 ? dx < 0 : dy > 0; // y вверх: «сверху вниз» = dy < 0
    return flip ? rev(s) : s;
  });
  const minX = (s: number[]) => { let m = Infinity; for (let i = 0; i < s.length; i += 2) m = Math.min(m, s[i]); return m; };
  return oriented.sort((a, b) => minX(a) - minX(b));
}

function orientLoop(s: number[]): number[] {
  let pts = s.slice();
  if (Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]) < 1e-6) pts = pts.slice(0, -2);
  const n = pts.length / 2;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  if (area < 0) pts = rev(pts); // против часовой (ось y вверх)
  // старт — верхняя правая точка
  let best = 0, bv = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = pts[i * 2 + 1] + pts[i * 2] * 0.5;
    if (v > bv) { bv = v; best = i; }
  }
  const out: number[] = [];
  for (let k = 0; k <= n; k++) {
    const i = (best + k) % n;
    out.push(pts[i * 2], pts[i * 2 + 1]);
  }
  return out;
}

function rev(s: number[]): number[] {
  const r: number[] = [];
  for (let i = s.length - 2; i >= 0; i -= 2) r.push(s[i], s[i + 1]);
  return r;
}

/** Сдвинуть к x = 0, посчитать ширину; у строчных с главным штрихом слева направо — вход и выход для связного письма. */
function toGlyph(strokes: number[][], lower: boolean): GlyphData {
  let minX = Infinity, maxX = -Infinity;
  for (const s of strokes) for (let i = 0; i < s.length; i += 2) { minX = Math.min(minX, s[i]); maxX = Math.max(maxX, s[i]); }
  const r = (v: number) => Math.round(v * 10) / 10;
  const s = strokes.map((st) => st.map((v, i) => r(i % 2 === 0 ? v - minX : v)));
  const w = r(maxX - minX);
  const g: GlyphData = { w, s };
  if (lower && w > 0) {
    // главный штрих — самый длинный; ставим его первым
    let main = 0, best = -1;
    s.forEach((st, i) => {
      let l = 0;
      for (let j = 2; j < st.length; j += 2) l += Math.hypot(st[j] - st[j - 2], st[j + 1] - st[j - 1]);
      if (l > best) { best = l; main = i; }
    });
    const st = s[main];
    const sx = st[0], ex = st[st.length - 2];
    if (sx <= w * 0.35 && ex >= w * 0.65) {
      if (main) s.unshift(...s.splice(main, 1));
      g.i = [r(sx), r(st[1])];
      g.o = [r(ex), r(st[st.length - 1])];
    }
  }
  return g;
}

export interface TemplateReadResult {
  marks: [number, number][];
  cells: CellResult[];
  /** символ → варианты (с одного листа — обычно 1, у строчных 2) */
  glyphs: Record<string, GlyphData[]>;
  filled: number;
}

/** Буквы, которые стоят на строке низом (без хвостов вниз). */
const FLAT_BOTTOM = new Set([
  ...'абвгеёжзийклмнопстхчшъыьэюяәғқңөһіАБВГЕЁЖЗИЙКЛМНОПРСТХЧШЪЫЬЭЮЯӘҒӨҺІ0123456789',
  ...'abcdehiklmnorstuvwxzABCDEFGHIKLMNOPRSTUVWXYZαδεθλνπσωΔΣΩ',
]);

/**
 * Человек пишет то чуть выше, то чуть ниже линии. Общий сдвиг убираем (почерк садится на строку),
 * а разброс отдельных букв оставляем на треть — остальное добавит «живость» при вёрстке.
 */
function alignBaselines(cells: CellResult[]) {
  const bottom = (g: GlyphData) => {
    let m = Infinity;
    for (const s of g.s) for (let i = 1; i < s.length; i += 2) m = Math.min(m, s[i]);
    return m;
  };
  const flat = cells.filter((c) => c.glyph && FLAT_BOTTOM.has(c.ch));
  if (flat.length < 5) return;
  const bs = flat.map((c) => bottom(c.glyph!)).sort((a, b) => a - b);
  const med = bs[bs.length >> 1];
  for (const c of cells) {
    if (!c.glyph) continue;
    const g = c.glyph;
    const dy = FLAT_BOTTOM.has(c.ch) ? -(med + (bottom(g) - med) * 0.7) : -med;
    const r = (v: number) => Math.round(v * 10) / 10;
    g.s = g.s.map((st) => st.map((v, i) => (i % 2 ? r(v + dy) : v)));
    if (g.i) g.i = [g.i[0], r(g.i[1] + dy)];
    if (g.o) g.o = [g.o[0], r(g.o[1] + dy)];
  }
}

const FIT_RANGE = 3;

/**
 * Сдвиги отдельных клеток шумят (буква у края, пятно), а изгиб листа плавный. Приближаем их
 * квадратичной поверхностью по всей таблице, дважды отбрасывая выбросы; упёршиеся в край поиска не берём.
 */
function fitShifts(cells: TemplateCell[], raw: [number, number][]): (c: TemplateCell) => [number, number] {
  const cx = 105, cy = 150, sc = 100;
  const basis = (c: TemplateCell) => {
    const x = (c.x + c.w / 2 - cx) / sc, y = (c.y - cy) / sc;
    return [1, x, y, x * y, x * x, y * y];
  };
  const solve = (rows: number[][], vals: number[]): number[] | null => {
    const n = 6;
    const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
    rows.forEach((b, k) => {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) A[i][j] += b[i] * b[j];
        A[i][n] += b[i] * vals[k];
      }
    });
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      if (Math.abs(A[c][c]) < 1e-9) return null;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
      }
    }
    return A.map((row, i) => row[n] / row[i]);
  };
  const axis = (d: 0 | 1) => {
    let idx = cells.map((_, i) => i).filter((i) => Math.abs(raw[i][d]) < FIT_RANGE - 0.05);
    let coef: number[] | null = null;
    for (let pass = 0; pass < 3 && idx.length >= 12; pass++) {
      coef = solve(idx.map((i) => basis(cells[i])), idx.map((i) => raw[i][d]));
      if (!coef) return null;
      const cf = coef;
      idx = idx.filter((i) => Math.abs(basis(cells[i]).reduce((a, b, k) => a + b * cf[k], 0) - raw[i][d]) < 0.8);
    }
    return coef;
  };
  const kx = axis(0), ky = axis(1);
  const ev = (k: number[] | null, c: TemplateCell) => {
    if (!k) return 0;
    const v = basis(c).reduce((a, b, i) => a + b * k[i], 0);
    // доли миллиметра — шум подгонки, а не изгиб
    return Math.abs(v) < 0.15 ? 0 : Math.max(-5, Math.min(5, v));
  };
  return (c) => [ev(kx, c), ev(ky, c)];
}

/** Строчные без выносных элементов — по ним меряем x-высоту; прописные без хвостов и надстрочных знаков. */
const X_LETTERS = new Set([...'аеиклмнопстхчшыьэюяжгәңөacemnorsuvwxz']);
const CAPS = new Set([...'АБВГЕЖЗИКЛМНОПРСТУФХЧШЫЭЮЯABCDEFGHIKLMNOPRSTUVWXYZ']);
/** у человека в конспектах прописные ≈ 1,6 строчной; в клетке шаблона их часто пишут мельче */
const CAP_RATIO = 1.6;

/**
 * В шрифте x-высота — 100 единиц, а человек на листе пишет мельче или крупнее пунктира. Масштабируем весь лист
 * так, чтобы средняя строчная стала 100, а слишком мелкие прописные дотягиваем до CAP_RATIO.
 */
function normalizeSizes(cells: CellResult[]) {
  const top = (g: GlyphData) => {
    let m = -Infinity;
    for (const s of g.s) for (let i = 1; i < s.length; i += 2) m = Math.max(m, s[i]);
    return m;
  };
  const median = (set: Set<string>) => {
    const v = cells.filter((c) => c.glyph && set.has(c.ch)).map((c) => top(c.glyph!)).sort((a, b) => a - b);
    return v.length >= 5 ? v[v.length >> 1] : null;
  };
  const xh = median(X_LETTERS);
  if (!xh || xh <= 0) return;
  const cap = median(CAPS);
  const k = 100 / xh;
  const capK = cap && cap / xh < CAP_RATIO - 0.25 ? (CAP_RATIO * xh) / cap : 1;
  const r = (v: number) => Math.round(v * 10) / 10;
  for (const c of cells) {
    if (!c.glyph) continue;
    const g = c.glyph;
    const f = k * (/\p{Lu}/u.test(c.ch) ? capK : 1);
    g.s = g.s.map((st) => st.map((v) => r(v * f)));
    g.w = r(g.w * f);
    if (g.i) g.i = [r(g.i[0] * f), r(g.i[1] * f)];
    if (g.o) g.o = [r(g.o[0] * f), r(g.o[1] * f)];
  }
}

/**
 * Прочитать весь лист. По умолчанию — по найденным угловым меткам. Если метки не попали в кадр,
 * можно передать опорные точки сами: ref — точки листа (мм, например GRID_CORNERS), at — где они на фото.
 */
export function readTemplate(g: Gray, at?: [number, number][] | null, ref: [number, number][] = MARKS, sheet = 1): TemplateReadResult {
  const m = at ?? findMarks(g);
  if (!m) throw new Error('не нашёл четыре чёрные метки по углам листа — снимите лист целиком, сверху, без теней');
  const H = homography(ref, m);
  const tc = templateCells(sheet);
  const fit = fitShifts(tc, tc.map((c) => cellShift(g, H, c, FIT_RANGE)));
  const cells = tc.map((c) => {
    // плавный изгиб листа по всей таблице + небольшое уточнение по линиям самой клетки
    const [fx, fy] = fit(c);
    const moved = { ...c, x: c.x + fx, y: c.y + fy, baseline: c.baseline + fy };
    const [dx, dy] = cellShift(g, H, moved, 0.8);
    return { ch: c.ch, glyph: readCell(g, H, { ...moved, x: moved.x + dx, y: moved.y + dy, baseline: moved.baseline + dy }) };
  });
  const glyphs: Record<string, GlyphData[]> = {};
  let filled = 0;
  for (const c of cells) {
    if (!c.glyph) continue;
    (glyphs[c.ch] ??= []).push(c.glyph);
    filled++;
  }
  alignBaselines(cells);
  normalizeSizes(cells);
  return { marks: MARKS.map(([x, y]) => project(H, x, y)), cells, glyphs, filled };
}
