import { CUSTOM_X_HEIGHT } from "../fonts/fonts.js";
import { simplify } from "../core/geometry.js";
import { extractDots, pruneStairs, smooth, thin, trace } from "./outlinefont.js";
import { LABEL_H, MARKS, MARK_SIZE, SHEET_W, X_HEIGHT, templateCells } from "./template.js";
/** Гомография по четырём парам точек: from (лист, мм) → to (фото, пиксели). */
export function homography(from, to) {
    const A = [];
    for (let i = 0; i < 4; i++) {
        const [x, y] = from[i], [u, v] = to[i];
        A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
        A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    // Гаусс с выбором главного элемента
    for (let c = 0; c < 8; c++) {
        let p = c;
        for (let r = c + 1; r < 8; r++)
            if (Math.abs(A[r][c]) > Math.abs(A[p][c]))
                p = r;
        [A[c], A[p]] = [A[p], A[c]];
        if (Math.abs(A[c][c]) < 1e-12)
            throw new Error('метки на фото стоят вырожденно');
        for (let r = 0; r < 8; r++) {
            if (r === c)
                continue;
            const f = A[r][c] / A[c][c];
            for (let k = c; k < 9; k++)
                A[r][k] -= f * A[c][k];
        }
    }
    const h = A.map((row, i) => row[8] / row[i]);
    return [...h, 1];
}
export function project(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}
function sample(g, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 >= g.w - 1 || y0 >= g.h - 1)
        return 255;
    const fx = x - x0, fy = y - y0;
    const i = y0 * g.w + x0;
    const d = g.data;
    return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + g.w] * (1 - fx) + d[i + g.w + 1] * fx) * fy;
}
function percentile(values, p) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < values.length; i++)
        hist[Math.max(0, Math.min(255, values[i] | 0))]++;
    let need = values.length * p;
    for (let v = 0; v < 256; v++) {
        need -= hist[v];
        if (need <= 0)
            return v;
    }
    return 255;
}
/** Найти четыре угловые метки. Порядок как в MARKS: левый верхний, правый верхний, правый нижний, левый нижний. */
export function findMarks(g, ref = MARKS) {
    // работаем на уменьшенной копии: метки крупные
    const step = Math.max(1, Math.ceil(Math.max(g.w, g.h) / 1200));
    const W = Math.floor(g.w / step), H = Math.floor(g.h / step);
    const small = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
            small[y * W + x] = g.data[y * step * g.w + x * step];
    const paper = percentile(small, 0.85);
    const thr = paper * 0.45;
    const dark = new Uint8Array(W * H);
    for (let i = 0; i < dark.length; i++)
        dark[i] = small[i] < thr ? 1 : 0;
    // полоса от принтера или край стола может касаться метки и сливаться с ней в одно пятно. Сжимаем тёмное
    // на ERODE пикселей: тонкие линии исчезают, метка остаётся квадратом чуть меньше (центр тот же)
    const ERODE = 2;
    for (let k = 0; k < ERODE; k++) {
        const prev = dark.slice();
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                if (prev[i] && (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !prev[i - 1] || !prev[i + 1] || !prev[i - W] || !prev[i + W]))
                    dark[i] = 0;
            }
    }
    // вокруг настоящей метки — бумага; тёмные пятна на столе, тени и края кадра этого не проходят
    const ringLight = (x0, y0, x1, y1) => {
        const m = Math.max(3, Math.round((x1 - x0) * 0.5));
        let n = 0, light = 0, all = 0;
        const at = (x, y) => {
            all++;
            if (x < 0 || y < 0 || x >= W || y >= H)
                return; // за краем кадра — не знаем, не считаем
            n++;
            if (small[y * W + x] > thr)
                light++;
        };
        for (let x = x0 - m; x <= x1 + m; x++) {
            at(x, y0 - m);
            at(x, y1 + m);
        }
        for (let y = y0 - m; y <= y1 + m; y++) {
            at(x0 - m, y);
            at(x1 + m, y);
        }
        // метка, обрезанная краем кадра больше чем наполовину, — скорее тёмный угол стола
        return n >= all * 0.6 ? light / n : 0;
    };
    // ожидаемый размер метки: 8 мм из 210 мм ширины листа, лист занимает 40–100 % кадра
    const big = Math.max(W, H);
    const minSide = big * (MARK_SIZE / 297) * 0.3;
    const maxSide = big * (MARK_SIZE / SHEET_W) * 1.6;
    const cands = [];
    const seen = new Uint8Array(W * H);
    const stack = [];
    for (let i = 0; i < dark.length; i++) {
        if (!dark[i] || seen[i])
            continue;
        let n = 0, sx = 0, sy = 0, minX = W, minY = H, maxX = 0, maxY = 0;
        stack.push(i);
        seen[i] = 1;
        while (stack.length) {
            const c = stack.pop();
            const x = c % W, y = (c / W) | 0;
            n++;
            sx += x;
            sy += y;
            if (x < minX)
                minX = x;
            if (x > maxX)
                maxX = x;
            if (y < minY)
                minY = y;
            if (y > maxY)
                maxY = y;
            if (x > 0 && dark[c - 1] && !seen[c - 1]) {
                seen[c - 1] = 1;
                stack.push(c - 1);
            }
            if (x < W - 1 && dark[c + 1] && !seen[c + 1]) {
                seen[c + 1] = 1;
                stack.push(c + 1);
            }
            if (y > 0 && dark[c - W] && !seen[c - W]) {
                seen[c - W] = 1;
                stack.push(c - W);
            }
            if (y < H - 1 && dark[c + W] && !seen[c + W]) {
                seen[c + W] = 1;
                stack.push(c + W);
            }
        }
        const bw = maxX - minX + 1 + 2 * ERODE, bh = maxY - minY + 1 + 2 * ERODE;
        if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide)
            continue;
        if (bw / bh < 0.55 || bw / bh > 1.8)
            continue;
        if (n / ((bw - 2 * ERODE) * (bh - 2 * ERODE)) < 0.6)
            continue;
        if (ringLight(minX - ERODE, minY - ERODE, maxX + ERODE, maxY + ERODE) < 0.75)
            continue;
        {
            // центр — по исходным (не сжатым) тёмным пикселям рамки метки: сжатие в перспективе чуть сдвигает центр
            let m = 0, mx = 0, my = 0;
            for (let y = Math.max(0, minY - ERODE - 1); y <= Math.min(H - 1, maxY + ERODE + 1); y++)
                for (let x = Math.max(0, minX - ERODE - 1); x <= Math.min(W - 1, maxX + ERODE + 1); x++)
                    if (small[y * W + x] < thr) {
                        m++;
                        mx += x;
                        my += y;
                    }
            cands.push({ x: (mx / m + 0.5) * step, y: (my / m + 0.5) * step, side: Math.sqrt(n) });
        }
    }
    if (cands.length < 4)
        return null;
    // у каждого угла кадра — несколько ближайших пятен; из них выбираем четвёрку, похожую на метки листа:
    // одинакового размера, выпуклую, с отношением сторон как у листа (186 × 273 мм). Тёмный угол стола у края
    // кадра бывает ближе к углу, чем сама метка, — по одной близости его не отличить.
    const corners = [[0, 0], [g.w, 0], [g.w, g.h], [0, g.h]];
    const near = corners.map(([cx, cy]) => cands.map((_, i) => i).sort((a, b) => Math.hypot(cands[a].x - cx, cands[a].y - cy) - Math.hypot(cands[b].x - cx, cands[b].y - cy)).slice(0, 4));
    const [rw, rh] = [ref[1][0] - ref[0][0], ref[3][1] - ref[0][1]];
    let best = null, bestScore = Infinity;
    const pick = [0, 0, 0, 0];
    const score = (q) => {
        if (new Set(q).size < 4)
            return Infinity;
        const P = q.map((i) => cands[i]);
        for (let i = 0; i < 4; i++) {
            const a = P[i], b = P[(i + 1) % 4], c = P[(i + 2) % 4];
            if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0)
                return Infinity;
        }
        const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const ratio = (d(P[0], P[1]) + d(P[3], P[2])) / (d(P[0], P[3]) + d(P[1], P[2]));
        const ls = P.map((p) => Math.log(p.side));
        const mean = ls.reduce((a, b) => a + b, 0) / 4;
        const spread = Math.sqrt(ls.reduce((a, b) => a + (b - mean) ** 2, 0) / 4);
        // размер метки относительно расстояния между метками тоже известен
        const sideMm = (Math.exp(mean) * step) / ((d(P[0], P[1]) + d(P[3], P[2])) / 2 / rw);
        return Math.abs(Math.log(ratio / (rw / rh))) * 3 + spread * 2 + Math.abs(Math.log(sideMm / MARK_SIZE));
    };
    const rec = (k) => {
        if (k === 4) {
            const v = score(pick);
            if (v < bestScore) {
                bestScore = v;
                best = pick.slice();
            }
            return;
        }
        for (const i of near[k]) {
            pick[k] = i;
            rec(k + 1);
        }
    };
    rec(0);
    if (!best || bestScore > 1.5)
        return null;
    const out = best.map((i) => [cands[i].x, cands[i].y]);
    return out;
}
/** пикселей на мм при вырезании клетки */
const RES = 10;
/** Чернила клетки → глиф в единицах шрифта (x-высота = 100, базовая линия y = 0). */
const INSET = 0.5;
/** Яркость области письма клетки в растре RES пикс/мм. */
function cellLum(g, H, cell) {
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
export function cellShift(g, H, cell, SHIFT = 2.5) {
    const [dx, dy] = cellLines(g, H, cell, SHIFT);
    return [dx, dy];
}
/** Чёткость печатных линий клетки на расчётном месте: чем выше, тем точнее клетка совпала с фото. */
export const lineScore = (g, H, cell) => cellLines(g, H, cell, 0)[2];
function cellLines(g, H, cell, SHIFT) {
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
    const med = (vals) => vals.sort((a, b) => a - b)[vals.length >> 1];
    const col = Float64Array.from({ length: W }, (_, x) => med(Array.from({ length: Hh }, (_, y) => d[y * W + x])));
    const row = Float64Array.from({ length: Hh }, (_, y) => med(Array.from(d.subarray(y * W, y * W + W))));
    // гребень: тёмная полоса уже ~1 мм светлее соседей
    const ridge = (p, mm) => {
        const i = Math.round((mm + 0.0) * R);
        const at = (k) => p[Math.max(0, Math.min(p.length - 1, k))];
        const c = Math.max(at(i - 1), at(i), at(i + 1));
        return c - (at(i - 4) + at(i + 4)) / 2;
    };
    let score = 0;
    const best = (p, lines) => {
        let bs = 0, bv = -Infinity, zero = 0;
        for (let s = -SHIFT; s <= SHIFT + 1e-9; s += 1 / R) {
            const v = lines.reduce((a, m) => a + ridge(p, m + s), 0);
            if (Math.abs(s) < 1e-9)
                zero = v;
            if (v > bv) {
                bv = v;
                bs = s;
            }
        }
        // сдвигаем, только если линии на новом месте заметно чётче, чем на расчётном
        const move = bv > zero * 1.15 + 1e-9;
        score += move ? bv : zero;
        return move ? bs : 0;
    };
    const dx = best(col, [cell.x - x0, cell.x + cell.w - x0]);
    const dy = best(row, [top - y0, cell.baseline - y0, cell.y + cell.h - y0]);
    return [dx, dy, score];
}
function flatten(lum, W, H, r) {
    const tmp = new Uint8Array(W * H), bg = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            let m = 0;
            for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++)
                m = Math.max(m, lum[y * W + k]);
            tmp[y * W + x] = m;
        }
    for (let x = 0; x < W; x++)
        for (let y = 0; y < H; y++) {
            let m = 0;
            for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++)
                m = Math.max(m, tmp[k * W + x]);
            bg[y * W + x] = m;
        }
    const out = new Uint8Array(W * H);
    for (let i = 0; i < out.length; i++)
        out[i] = bg[i] ? Math.min(255, Math.round((lum[i] * 255) / bg[i])) : 255;
    return out;
}
/** Гауссово сглаживание точек вдоль ломаной (sigma — в пикселях пути); замкнутую петлю гладим по кругу. */
function smoothChain(p, sigma) {
    const n = p.length / 2;
    if (n < 4)
        return p;
    const closed = Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]) < 2;
    const r = Math.ceil(sigma * 2);
    const w = Array.from({ length: r * 2 + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)));
    const out = p.slice();
    for (let i = 0; i < n; i++) {
        if (!closed && (i === 0 || i === n - 1))
            continue;
        let sx = 0, sy = 0, sw = 0;
        for (let k = -r; k <= r; k++) {
            let j = i + k;
            if (closed)
                j = ((j % (n - 1)) + (n - 1)) % (n - 1);
            else if (j < 0 || j >= n)
                continue;
            // у открытого конца окно сужаем симметрично, иначе конец штриха «съёживается»
            if (!closed && (i - Math.abs(k) < 0 || i + Math.abs(k) > n - 1))
                continue;
            sx += p[j * 2] * w[k + r];
            sy += p[j * 2 + 1] * w[k + r];
            sw += w[k + r];
        }
        out[i * 2] = sx / sw;
        out[i * 2 + 1] = sy / sw;
    }
    if (closed) {
        out[out.length - 2] = out[0];
        out[out.length - 1] = out[1];
    }
    return out;
}
/** Срезание углов Чайкина: ломаная становится плавной кривой, концы на месте. */
function chaikin(p, passes) {
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
export function readCell(g, H, cell) {
    const inset = INSET;
    const { lum: raw, W, Hh, y0 } = cellLum(g, H, cell);
    // тень от руки или телефона: яркость бумаги меняется даже внутри клетки. Делим на местный фон —
    // максимум в окне 3 мм (штрих уже, так что в окно всегда попадает бумага)
    const lum = flatten(raw, W, Hh, Math.round(1.5 * RES));
    const paper = percentile(lum, 0.9);
    const thr = paper * 0.62;
    const bin = new Uint8Array(W * Hh);
    let ink = 0;
    for (let i = 0; i < bin.length; i++)
        if (lum[i] < thr) {
            bin[i] = 1;
            ink++;
        }
    // гистерезис: светлая шариковая паста рвёт штрих; бледные пиксели берём, если они продолжают уверенный штрих —
    // не дальше ~0,3 мм от него, иначе по серой печатной линии «натечёт» через всю клетку
    const weak = paper * 0.75;
    let front = [];
    for (let i = 0; i < bin.length; i++)
        if (bin[i])
            front.push(i);
    for (let step = 0; step < 3 && front.length; step++) {
        const next = [];
        for (const i of front) {
            const x = i % W, y = (i / W) | 0;
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx, yy = y + dy;
                    if (xx < 0 || yy < 0 || xx >= W || yy >= Hh)
                        continue;
                    const j = yy * W + xx;
                    if (!bin[j] && lum[j] < weak) {
                        bin[j] = 1;
                        next.push(j);
                    }
                }
        }
        front = next;
    }
    // печатные линии клетки (на ч/б принтере они выходят тёмными): базовая, пунктир x-высоты, края клетки
    const by = (cell.baseline - y0) * RES;
    const XH = cell.xh ?? X_HEIGHT;
    // найденная на фото базовая линия точнее расчётной: лист бывает выгнут, а фото — с искажениями объектива
    const foundBase = eraseLine(bin, W, Hh, by, true, 2);
    for (const y of [(foundBase ?? by) - XH * RES, ...(cell.guides ?? []).map((g) => (foundBase ?? by) - g * RES), -inset * RES, (cell.h - inset) * RES])
        eraseLine(bin, W, Hh, y, true);
    for (const x of [-inset * RES, (cell.w - inset) * RES])
        eraseLine(bin, W, Hh, x, false);
    // обрывки пунктира и полутонов: тонкие плоские пятна, целиком лежащие на линии
    const lineRows = [foundBase ?? by, (foundBase ?? by) - XH * RES, ...(cell.guides ?? []).map((g) => (foundBase ?? by) - g * RES)];
    for (const c of components(bin, W, Hh)) {
        const h = c.maxY - c.minY + 1, w = c.maxX - c.minX + 1;
        if (h > 0.4 * RES || w > 2 * RES)
            continue;
        if (lineRows.some((y) => c.minY >= y - 0.5 * RES && c.maxY <= y + 0.5 * RES))
            for (const i of c.px)
                bin[i] = 0;
    }
    removeSpecks(bin, W, Hh, 6);
    dropStrays(bin, W, Hh);
    ink = bin.reduce((a, b) => a + b, 0);
    // пустая клетка: меньше ~0,15 мм² чернил (точка ручкой — около 0,2 мм²)
    if (ink < 0.15 * RES * RES)
        return null;
    const before = ink;
    const dots = extractDots(bin, W, Hh, XH * RES * 0.36);
    thin(bin, W, Hh);
    pruneStairs(bin, W, Hh);
    let skel = 0;
    for (let i = 0; i < bin.length; i++)
        skel += bin[i];
    let paths = joinChains(trace(bin, W, Hh, Math.max(3, (before / Math.max(skel, 1)) * 0.9)), 2.5);
    // плоские огрызки печатной линии, пережившие стирание: на странице они выглядят как лишние точки
    if (/[\p{L}\p{N}]/u.test(cell.ch) && paths.length > 1) {
        const rows = lineRows;
        const near = (p, q) => {
            for (let i = 0; i < p.length; i += 2)
                for (let j = 0; j < q.length; j += 2)
                    if (Math.hypot(p[i] - q[j], p[i + 1] - q[j + 1]) < 0.6 * RES)
                        return true;
            return false;
        };
        paths = paths.filter((p) => {
            if (paths.some((q) => q !== p && near(p, q)))
                return true;
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            for (let i = 0; i < p.length; i += 2) {
                x0 = Math.min(x0, p[i]);
                x1 = Math.max(x1, p[i]);
                y0 = Math.min(y0, p[i + 1]);
                y1 = Math.max(y1, p[i + 1]);
            }
            const flat = x1 - x0 < 1.6 * RES && y1 - y0 < 0.4 * RES;
            if (flat && rows.some((y) => Math.abs((y0 + y1) / 2 - y) < 0.7 * RES))
                return false;
            // остаток вертикального края клетки; в крупной клетке выгнутый лист сдвигает край дальше и наискось
            const zone = (cell.w > 20 ? 3 : 1.2) * RES;
            const edge = x1 < zone || x0 > W - zone;
            if (edge && x1 - x0 < (cell.w > 20 ? 0.8 : 0.5) * RES && y1 - y0 > 2 * RES)
                return false;
            return true;
        });
    }
    // выше 8 мм над строкой букв не бывает (в крупной клетке — выше верха клетки): это подпись или чужая буква сверху
    const ceiling = (foundBase ?? by) - Math.max(8, cell.baseline - cell.y) * RES;
    paths = paths.filter((p) => p.some((v, i) => i % 2 === 1 && v > ceiling));
    // крошечный отдельный штрих (меньше 0,7 мм) у буквы без точек — капля или соринка
    if (!DOTTED.test(cell.ch) && paths.length > 1) {
        const ext = (p) => {
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            for (let i = 0; i < p.length; i += 2) {
                x0 = Math.min(x0, p[i]);
                x1 = Math.max(x1, p[i]);
                y0 = Math.min(y0, p[i + 1]);
                y1 = Math.max(y1, p[i + 1]);
            }
            return Math.max(x1 - x0, y1 - y0);
        };
        const near = (p, q) => {
            for (let i = 0; i < p.length; i += 2)
                for (let j = 0; j < q.length; j += 2)
                    if (Math.hypot(p[i] - q[j], p[i + 1] - q[j + 1]) < 0.6 * RES)
                        return true;
            return false;
        };
        // меньше 0,4 мм — даже рядом с буквой: это огрызок стёртой печатной линии под штрихом, а не часть буквы
        const kept = paths.filter((p) => ext(p) >= 0.7 * RES || (ext(p) >= 0.4 * RES && paths.some((q) => q !== p && near(p, q))));
        if (kept.length)
            paths = kept;
    }
    // точки над ё, й, і стоят выше пунктира; «точка» прямо на линии у буквы — это кусок штриха печатной линии
    const lineYs = lineRows;
    const isText = /[\p{L}\p{N}]/u.test(cell.ch);
    for (const [cx, cy, r] of dots) {
        if (cy < ceiling || !DOTTED.test(cell.ch))
            continue;
        // у ё, й, і точки только сверху
        if (/\p{L}/u.test(cell.ch) && cy > (foundBase ?? by) - XH * RES * 0.45)
            continue;
        if (isText && lineYs.some((y) => Math.abs(cy - y) < 0.6 * RES))
            continue;
        paths.push([cx - r * 0.35, cy, cx + r * 0.35, cy]);
    }
    if (!paths.length)
        return null;
    const k = CUSTOM_X_HEIGHT / (XH * RES);
    const basePx = foundBase ?? by;
    const strokes = [];
    for (const p of paths) {
        // скелет из пикселей идёт «лесенкой»: гладим вдоль штриха на ~0,3 мм, затем скругляем углы ломаной
        const simp = chaikin(simplify(smoothChain(smooth(p), 0.3 * RES), 0.35), 2);
        const out = [];
        for (let i = 0; i < simp.length; i += 2)
            out.push(simp[i] * k, (basePx - simp[i + 1]) * k);
        if (out.length >= 4)
            strokes.push(out);
    }
    if (!strokes.length)
        return null;
    return toGlyph(orderStrokes(strokes), /\p{Ll}/u.test(cell.ch));
}
/**
 * После удаления «усиков» на остром углу (м, л, 4) линия остаётся разрезанной на две.
 * Склеиваем концы, где сходятся ровно два штриха, — под любым углом: рука там ручку не отрывала.
 */
export function joinChains(paths, tol) {
    const out = paths.map((p) => p.slice());
    const near = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by) <= tol;
    const ends = (p) => [[p[0], p[1]], [p[p.length - 2], p[p.length - 1]]];
    let merged = true;
    while (merged) {
        merged = false;
        search: for (let i = 0; i < out.length; i++) {
            for (const [ei, [x, y]] of ends(out[i]).entries()) {
                // кто ещё касается этой точки
                const touch = [];
                out.forEach((q, j) => ends(q).forEach(([qx, qy], ej) => { if (near(x, y, qx, qy) && !(j === i && ej === ei))
                    touch.push([j, ej]); }));
                if (touch.length !== 1 || touch[0][0] === i)
                    continue;
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
function eraseLine(bin, W, H, pos, horizontal, searchMm = 1.5) {
    const len = horizontal ? W : H, across = horizontal ? H : W;
    const at = (a, b) => (horizontal ? bin[b * W + a] : bin[a * W + b]); // a — вдоль линии, b — поперёк
    const set0 = (a, b) => { if (horizontal)
        bin[b * W + a] = 0;
    else
        bin[a * W + b] = 0; };
    const win = Math.round(searchMm * RES);
    let best = -1, bestN = 0;
    for (let b = Math.round(pos) - win; b <= Math.round(pos) + win; b++) {
        if (b < 0 || b >= across)
            continue;
        let n = 0;
        for (let a = 0; a < len; a++)
            n += at(a, b);
        if (n > bestN) {
            bestN = n;
            best = b;
        }
    }
    if (best < 0 || bestN < len * 0.25)
        return null;
    const thick = Math.round(0.4 * RES), near = Math.round(0.3 * RES);
    const lo = new Int32Array(len).fill(-1), hi = new Int32Array(len).fill(-1);
    const lineOnly = new Uint8Array(len);
    for (let a = 0; a < len; a++) {
        let l = -1;
        for (let d = 0; d <= near && l < 0; d++) {
            if (best - d >= 0 && at(a, best - d))
                l = best - d;
            else if (best + d < across && at(a, best + d))
                l = best + d;
        }
        if (l < 0)
            continue;
        let h = l;
        while (l - 1 >= 0 && at(a, l - 1))
            l--;
        while (h + 1 < across && at(a, h + 1))
            h++;
        if (h - l + 1 <= thick) {
            lineOnly[a] = 1;
            lo[a] = l;
            hi[a] = h;
        }
    }
    // стираем только длинные куски (≥ 1 мм, через разрывы пунктира до 0,6 мм): точка на линии остаётся
    const minRun = RES, maxGap = Math.round(0.6 * RES);
    for (let a = 0; a < len;) {
        if (!lineOnly[a]) {
            a++;
            continue;
        }
        let ext = a;
        while (ext < len && lineOnly[ext])
            ext++;
        for (;;) {
            let gap = ext;
            while (gap < len && !lineOnly[gap] && gap - ext < maxGap)
                gap++;
            if (gap >= len || !lineOnly[gap])
                break;
            ext = gap;
            while (ext < len && lineOnly[ext])
                ext++;
        }
        if (ext - a >= minRun)
            for (let k = a; k < ext; k++)
                if (lineOnly[k])
                    for (let q = lo[k]; q <= hi[k]; q++)
                        set0(k, q);
        a = ext;
    }
    return best;
}
/** Убрать обрывки рядом с буквой (край соседней клетки, подпись): мелкое пятно, не перекрывающее букву по горизонтали. */
function dropStrays(bin, W, H) {
    const comps = components(bin, W, H);
    if (comps.length < 2)
        return;
    const main = comps.reduce((a, b) => (b.px.length > a.px.length ? b : a));
    for (const c of comps) {
        if (c === main || c.px.length > main.px.length * 0.25)
            continue;
        const apart = c.maxX < main.minX - RES || c.minX > main.maxX + RES;
        if (apart)
            for (const i of c.px)
                bin[i] = 0;
    }
}
function components(bin, W, H) {
    const seen = new Uint8Array(W * H);
    const out = [];
    const stack = [];
    for (let i = 0; i < bin.length; i++) {
        if (!bin[i] || seen[i])
            continue;
        const px = [];
        let minX = W, maxX = 0, minY = H, maxY = 0;
        stack.push(i);
        seen[i] = 1;
        while (stack.length) {
            const c = stack.pop();
            px.push(c);
            const x = c % W;
            if (x < minX)
                minX = x;
            if (x > maxX)
                maxX = x;
            const y = (c / W) | 0;
            if (y < minY)
                minY = y;
            if (y > maxY)
                maxY = y;
            for (const n of [c - 1, c + 1, c - W, c + W, c - W - 1, c - W + 1, c + W - 1, c + W + 1]) {
                if (n < 0 || n >= bin.length || Math.abs((n % W) - x) > 1 || !bin[n] || seen[n])
                    continue;
                seen[n] = 1;
                stack.push(n);
            }
        }
        out.push({ px, minX, maxX, minY, maxY });
    }
    return out;
}
function removeSpecks(bin, W, H, minArea) {
    const seen = new Uint8Array(W * H);
    const stack = [];
    for (let i = 0; i < bin.length; i++) {
        if (!bin[i] || seen[i])
            continue;
        const comp = [];
        stack.push(i);
        seen[i] = 1;
        while (stack.length) {
            const c = stack.pop();
            comp.push(c);
            const x = c % W;
            for (const n of [c - 1, c + 1, c - W, c + W, c - W - 1, c - W + 1, c + W - 1, c + W + 1]) {
                if (n < 0 || n >= bin.length || Math.abs((n % W) - x) > 1 || !bin[n] || seen[n])
                    continue;
                seen[n] = 1;
                stack.push(n);
            }
        }
        if (comp.length < minArea)
            for (const c of comp)
                bin[c] = 0;
    }
}
/**
 * Порядок и направление штрихов как у руки: слева направо; горизонтальный штрих — слева направо,
 * вертикальный — сверху вниз; замкнутая петля (о) — от верхней правой точки против часовой.
 */
export function orderStrokes(strokes) {
    const oriented = strokes.map((s) => {
        const n = s.length / 2;
        const closed = n > 4 && Math.hypot(s[0] - s[s.length - 2], s[1] - s[s.length - 1]) < 8;
        if (closed)
            return orientLoop(s);
        const dx = s[s.length - 2] - s[0], dy = s[s.length - 1] - s[1];
        const flip = Math.abs(dx) >= Math.abs(dy) * 0.6 ? dx < 0 : dy > 0; // y вверх: «сверху вниз» = dy < 0
        return flip ? rev(s) : s;
    });
    const minX = (s) => { let m = Infinity; for (let i = 0; i < s.length; i += 2)
        m = Math.min(m, s[i]); return m; };
    return oriented.sort((a, b) => minX(a) - minX(b));
}
function orientLoop(s) {
    let pts = s.slice();
    if (Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]) < 1e-6)
        pts = pts.slice(0, -2);
    const n = pts.length / 2;
    let area = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
    }
    if (area < 0)
        pts = rev(pts); // против часовой (ось y вверх)
    // старт — верхняя правая точка
    let best = 0, bv = -Infinity;
    for (let i = 0; i < n; i++) {
        const v = pts[i * 2 + 1] + pts[i * 2] * 0.5;
        if (v > bv) {
            bv = v;
            best = i;
        }
    }
    const out = [];
    for (let k = 0; k <= n; k++) {
        const i = (best + k) % n;
        out.push(pts[i * 2], pts[i * 2 + 1]);
    }
    return out;
}
function rev(s) {
    const r = [];
    for (let i = s.length - 2; i >= 0; i -= 2)
        r.push(s[i], s[i + 1]);
    return r;
}
/** Сдвинуть к x = 0, посчитать ширину; у строчных с главным штрихом слева направо — вход и выход для связного письма. */
function toGlyph(strokes, lower) {
    let minX = Infinity, maxX = -Infinity;
    for (const s of strokes)
        for (let i = 0; i < s.length; i += 2) {
            minX = Math.min(minX, s[i]);
            maxX = Math.max(maxX, s[i]);
        }
    const r = (v) => Math.round(v * 10) / 10;
    const s = strokes.map((st) => st.map((v, i) => r(i % 2 === 0 ? v - minX : v)));
    const w = r(maxX - minX);
    const g = { w, s };
    if (lower && w > 0) {
        // главный штрих — самый длинный; ставим его первым
        let main = 0, best = -1;
        s.forEach((st, i) => {
            let l = 0;
            for (let j = 2; j < st.length; j += 2)
                l += Math.hypot(st[j] - st[j - 2], st[j + 1] - st[j - 1]);
            if (l > best) {
                best = l;
                main = i;
            }
        });
        const st = s[main];
        const sx = st[0], ex = st[st.length - 2];
        if (sx <= w * 0.35 && ex >= w * 0.65) {
            if (main)
                s.unshift(...s.splice(main, 1));
            g.i = [r(sx), r(st[1])];
            g.o = [r(ex), r(st[st.length - 1])];
        }
    }
    return g;
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
function alignBaselines(cells) {
    const bottom = (g) => {
        let m = Infinity;
        for (const s of g.s)
            for (let i = 1; i < s.length; i += 2)
                m = Math.min(m, s[i]);
        return m;
    };
    const flat = cells.filter((c) => c.glyph && FLAT_BOTTOM.has(c.ch));
    if (flat.length < 5)
        return;
    const bs = flat.map((c) => bottom(c.glyph)).sort((a, b) => a - b);
    const med = bs[bs.length >> 1];
    for (const c of cells) {
        if (!c.glyph)
            continue;
        const g = c.glyph;
        const dy = FLAT_BOTTOM.has(c.ch) ? -(med + (bottom(g) - med) * 0.7) : -med;
        const r = (v) => Math.round(v * 10) / 10;
        g.s = g.s.map((st) => st.map((v, i) => (i % 2 ? r(v + dy) : v)));
        if (g.i)
            g.i = [g.i[0], r(g.i[1] + dy)];
        if (g.o)
            g.o = [g.o[0], r(g.o[1] + dy)];
    }
}
const FIT_RANGE = 3;
/**
 * Загнутый угол листа сдвигает клетки на сантиметр и больше — за пределы поиска одной клетки. Идём от клеток
 * у меток (там фото выпрямлено точно) к соседям: сдвиг соседа — подсказка, вокруг неё ищем линии клетки.
 * Так набегает любой плавный изгиб, лишь бы между соседними клетками он менялся меньше чем на 2,5 мм.
 */
export function growShifts(g, H, cells, marks) {
    const shift = cells.map(() => null);
    // соседи по сетке: клетка, сдвинутая на (di, dj) ячеек
    const at = new Map();
    const key = (c) => `${Math.round(c.x / c.w)},${Math.round((c.y - LABEL_H) / (c.h + LABEL_H))}`;
    const ij = cells.map((c) => [Math.round(c.x / c.w), Math.round((c.y - LABEL_H) / (c.h + LABEL_H))]);
    cells.forEach((c, i) => at.set(key(c), i));
    const cell = (i, di, dj) => at.get(`${ij[i][0] + di},${ij[i][1] + dj}`);
    const solve = (i, pred, range) => {
        const c = cells[i];
        const moved = { ...c, x: c.x + pred[0], y: c.y + pred[1], baseline: c.baseline + pred[1] };
        const [dx, dy] = cellShift(g, H, moved, range);
        shift[i] = [pred[0] + dx, pred[1] + dy];
    };
    // начало — клетки, ближайшие к меткам: там фото выпрямлено точно
    for (const [mx, my] of marks) {
        let best = -1, bd = Infinity;
        cells.forEach((c, i) => {
            const d = Math.hypot(c.x + c.w / 2 - mx, c.y + c.h / 2 - my);
            if (d < bd) {
                bd = d;
                best = i;
            }
        });
        if (best >= 0 && !shift[best])
            solve(best, [0, 0], 1);
    }
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (;;) {
        // следующая — у которой больше всего найденных соседей; сдвиг продолжаем по прямой от двух соседей
        let pick = -1, pn = 0;
        let preds = [];
        cells.forEach((_, i) => {
            if (shift[i])
                return;
            const p = [];
            for (const [di, dj] of DIRS) {
                const a = cell(i, di, dj);
                if (a === undefined || !shift[a])
                    continue;
                const b = cell(i, 2 * di, 2 * dj);
                const sa = shift[a];
                p.push(b !== undefined && shift[b] ? [sa[0] + (sa[0] - shift[b][0]) * 0.7, sa[1] + (sa[1] - shift[b][1]) * 0.7] : sa);
            }
            if (p.length > pn) {
                pn = p.length;
                pick = i;
                preds = p;
            }
        });
        if (pick < 0)
            break;
        const med = (d) => {
            const v = preds.map((p) => p[d]).sort((a, b) => a - b);
            return v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
        };
        solve(pick, [med(0), med(1)], 1.2);
    }
    return shift.map((s) => s ?? [0, 0]);
}
/**
 * Сдвиги отдельных клеток шумят (буква у края, пятно), а изгиб листа плавный. Приближаем их
 * квадратичной поверхностью по всей таблице, дважды отбрасывая выбросы; упёршиеся в край поиска не берём.
 */
function fitShifts(cells, raw) {
    const cx = 105, cy = 150, sc = 100;
    const basis = (c) => {
        const x = (c.x + c.w / 2 - cx) / sc, y = (c.y - cy) / sc;
        return [1, x, y, x * y, x * x, y * y];
    };
    const solve = (rows, vals) => {
        const n = 6;
        const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
        rows.forEach((b, k) => {
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++)
                    A[i][j] += b[i] * b[j];
                A[i][n] += b[i] * vals[k];
            }
        });
        for (let c = 0; c < n; c++) {
            let p = c;
            for (let r = c + 1; r < n; r++)
                if (Math.abs(A[r][c]) > Math.abs(A[p][c]))
                    p = r;
            [A[c], A[p]] = [A[p], A[c]];
            if (Math.abs(A[c][c]) < 1e-9)
                return null;
            for (let r = 0; r < n; r++) {
                if (r === c)
                    continue;
                const f = A[r][c] / A[c][c];
                for (let k = c; k <= n; k++)
                    A[r][k] -= f * A[c][k];
            }
        }
        return A.map((row, i) => row[n] / row[i]);
    };
    const axis = (d) => {
        let idx = cells.map((_, i) => i).filter((i) => Math.abs(raw[i][d]) < FIT_RANGE - 0.05);
        let coef = null;
        for (let pass = 0; pass < 3 && idx.length >= 12; pass++) {
            coef = solve(idx.map((i) => basis(cells[i])), idx.map((i) => raw[i][d]));
            if (!coef)
                return null;
            const cf = coef;
            idx = idx.filter((i) => Math.abs(basis(cells[i]).reduce((a, b, k) => a + b * cf[k], 0) - raw[i][d]) < 0.8);
        }
        return coef;
    };
    const kx = axis(0), ky = axis(1);
    const ev = (k, c) => {
        if (!k)
            return 0;
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
const DIGIT_SET = new Set([...'0123456789']);
const DIGIT_RATIO = 1.4;
/**
 * В шрифте x-высота — 100 единиц, а человек на листе пишет мельче или крупнее пунктира. Масштабируем весь лист
 * так, чтобы средняя строчная стала 100, а слишком мелкие прописные дотягиваем до CAP_RATIO.
 */
function normalizeSizes(cells) {
    const top = (g) => {
        let m = -Infinity;
        for (const s of g.s)
            for (let i = 1; i < s.length; i += 2)
                m = Math.max(m, s[i]);
        return m;
    };
    const median = (set) => {
        const v = cells.filter((c) => c.glyph && set.has(c.ch)).map((c) => top(c.glyph)).sort((a, b) => a - b);
        return v.length >= 5 ? v[v.length >> 1] : null;
    };
    const xh = median(X_LETTERS);
    if (!xh || xh <= 0)
        return;
    const cap = median(CAPS);
    const k = 100 / xh;
    const capK = cap && cap / xh < CAP_RATIO - 0.25 ? (CAP_RATIO * xh) / cap : 1;
    // цифры в клетке тоже часто пишут ростом со строчную, а в тетради они почти как прописные
    const dig = median(DIGIT_SET);
    const digK = dig && dig / xh < DIGIT_RATIO - 0.2 ? (DIGIT_RATIO * xh) / dig : 1;
    const r = (v) => Math.round(v * 10) / 10;
    for (const c of cells) {
        if (!c.glyph)
            continue;
        const g = c.glyph;
        const f = k * (/\p{Lu}/u.test(c.ch) ? capK : DIGIT_SET.has(c.ch) ? digK : 1);
        g.s = g.s.map((st) => st.map((v) => r(v * f)));
        g.w = r(g.w * f);
        if (g.i)
            g.i = [r(g.i[0] * f), r(g.i[1] * f)];
        if (g.o)
            g.o = [r(g.o[0] * f), r(g.o[1] * f)];
    }
}
/**
 * Прочитать весь лист. По умолчанию — по найденным угловым меткам. Если метки не попали в кадр,
 * можно передать опорные точки сами: ref — точки листа (мм, например GRID_CORNERS), at — где они на фото.
 */
export function readTemplate(g, at, ref = MARKS, sheet = 1) {
    const m = at ?? findMarks(g);
    if (!m)
        throw new Error('не нашёл четыре чёрные метки по углам листа — снимите лист целиком, сверху, без теней');
    const H = homography(ref, m);
    const tc = templateCells(sheet);
    const grown = growShifts(g, H, tc, ref);
    const fit = fitShifts(tc, tc.map((c) => cellShift(g, H, c, FIT_RANGE)));
    const cells = tc.map((c, i) => {
        // плавный изгиб листа по всей таблице + небольшое уточнение по линиям самой клетки. Если лист сильно
        // загнут (угол приподнят над столом), клетки уезжают дальше FIT_RANGE — тогда берём сдвиг, найденный «по цепочке»
        const f = fit(c);
        const big = Math.abs(grown[i][0]) >= FIT_RANGE - 0.5 || Math.abs(grown[i][1]) >= FIT_RANGE - 0.5;
        const at = (s) => lineScore(g, H, { ...c, x: c.x + s[0], y: c.y + s[1], baseline: c.baseline + s[1] });
        // «по цепочке» можно и ошибиться: берём его, только если линии клетки там заметно чётче
        const [fx, fy] = big && at(grown[i]) > at(f) * 1.2 ? grown[i] : f;
        const moved = { ...c, x: c.x + fx, y: c.y + fy, baseline: c.baseline + fy };
        const [dx, dy] = cellShift(g, H, moved, 0.8);
        return { ch: c.ch, glyph: readCell(g, H, { ...moved, x: moved.x + dx, y: moved.y + dy, baseline: moved.baseline + dy }) };
    });
    const glyphs = {};
    let filled = 0;
    for (const c of cells) {
        if (!c.glyph)
            continue;
        (glyphs[c.ch] ??= []).push(c.glyph);
        filled++;
    }
    alignBaselines(cells);
    normalizeSizes(cells);
    return { marks: MARKS.map(([x, y]) => project(H, x, y)), cells, glyphs, filled };
}
