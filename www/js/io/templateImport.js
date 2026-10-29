import { CUSTOM_X_HEIGHT } from "../fonts/fonts.js";
import { simplify } from "../core/geometry.js";
import { extractDots, pruneStairs, smooth, thin, trace } from "./outlinefont.js";
import { MARKS, MARK_SIZE, SHEET_W, X_HEIGHT, templateCells } from "./template.js";
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
export function findMarks(g) {
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
        const bw = maxX - minX + 1, bh = maxY - minY + 1;
        if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide)
            continue;
        if (bw / bh < 0.55 || bw / bh > 1.8)
            continue;
        if (n / (bw * bh) < 0.6)
            continue;
        cands.push({ x: (sx / n + 0.5) * step, y: (sy / n + 0.5) * step });
    }
    if (cands.length < 4)
        return null;
    const corners = [[0, 0], [g.w, 0], [g.w, g.h], [0, g.h]];
    const out = [];
    const used = new Set();
    for (const [cx, cy] of corners) {
        let best = -1, bd = Infinity;
        cands.forEach((c, i) => {
            const d = Math.hypot(c.x - cx, c.y - cy);
            if (!used.has(i) && d < bd) {
                bd = d;
                best = i;
            }
        });
        used.add(best);
        out.push([cands[best].x, cands[best].y]);
    }
    // метки должны образовывать выпуклый четырёхугольник в правильном порядке (по часовой на фото)
    for (let i = 0; i < 4; i++) {
        const [ax, ay] = out[i], [bx, by] = out[(i + 1) % 4], [cx, cy] = out[(i + 2) % 4];
        if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) <= 0)
            return null;
    }
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
/** Чернила клетки → глиф в единицах шрифта (x-высота = 100, базовая линия y = 0). */
export function readCell(g, H, cell) {
    const inset = INSET;
    const { lum, W, Hh, y0 } = cellLum(g, H, cell);
    const paper = percentile(lum, 0.9);
    const thr = paper * 0.62;
    const bin = new Uint8Array(W * Hh);
    let ink = 0;
    for (let i = 0; i < bin.length; i++)
        if (lum[i] < thr) {
            bin[i] = 1;
            ink++;
        }
    // печатные линии клетки (на ч/б принтере они выходят тёмными): базовая, пунктир x-высоты, края клетки
    const by = (cell.baseline - y0) * RES;
    // найденная на фото базовая линия точнее расчётной: лист бывает выгнут, а фото — с искажениями объектива
    const foundBase = eraseLine(bin, W, Hh, by, true, 2);
    for (const y of [(foundBase ?? by) - X_HEIGHT * RES, -inset * RES, (cell.h - inset) * RES])
        eraseLine(bin, W, Hh, y, true);
    for (const x of [-inset * RES, (cell.w - inset) * RES])
        eraseLine(bin, W, Hh, x, false);
    // обрывки пунктира и полутонов: тонкие плоские пятна, целиком лежащие на линии
    const lineRows = [foundBase ?? by, (foundBase ?? by) - X_HEIGHT * RES];
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
    const dots = extractDots(bin, W, Hh, X_HEIGHT * RES * 0.36);
    thin(bin, W, Hh);
    pruneStairs(bin, W, Hh);
    let skel = 0;
    for (let i = 0; i < bin.length; i++)
        skel += bin[i];
    const paths = joinChains(trace(bin, W, Hh, Math.max(3, (before / Math.max(skel, 1)) * 0.9)), 2.5);
    for (const [cx, cy, r] of dots)
        paths.push([cx - r * 0.35, cy, cx + r * 0.35, cy]);
    if (!paths.length)
        return null;
    const k = CUSTOM_X_HEIGHT / (X_HEIGHT * RES);
    const basePx = foundBase ?? by;
    const strokes = [];
    for (const p of paths) {
        const simp = simplify(smooth(p), 0.5);
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
const FLAT_BOTTOM = new Set([...'абвгеёжзийклмнопстхчшъыьэюяәғқңөһіАБВГЕЁЖЗИЙКЛМНОПРСТХЧШЪЫЬЭЮЯӘҒӨҺІ0123456789']);
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
/**
 * Прочитать весь лист. По умолчанию — по найденным угловым меткам. Если метки не попали в кадр,
 * можно передать опорные точки сами: ref — точки листа (мм, например GRID_CORNERS), at — где они на фото.
 */
export function readTemplate(g, at, ref = MARKS) {
    const m = at ?? findMarks(g);
    if (!m)
        throw new Error('не нашёл четыре чёрные метки по углам листа — снимите лист целиком, сверху, без теней');
    const H = homography(ref, m);
    const cells = templateCells().map((c) => ({ ch: c.ch, glyph: readCell(g, H, c) }));
    const glyphs = {};
    let filled = 0;
    for (const c of cells) {
        if (!c.glyph)
            continue;
        (glyphs[c.ch] ??= []).push(c.glyph);
        filled++;
    }
    alignBaselines(cells);
    return { marks: MARKS.map(([x, y]) => project(H, x, y)), cells, glyphs, filled };
}
