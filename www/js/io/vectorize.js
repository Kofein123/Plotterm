import { pruneStairs, smooth, thin, trace } from "./outlinefont.js";
import { simplify } from "../core/geometry.js";
/** во сколько раз максимум увеличиваем мелкую картинку перед скелетом */
const UPSCALE_MAX = 3;
/** Бислинейное увеличение: у мелких букв и тонких линий скелет выходит гладким, а не «лесенкой». */
function upscale(g, k) {
    const w = Math.max(1, Math.round(g.w * k)), h = Math.max(1, Math.round(g.h * k));
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const sx = (x + 0.5) / k - 0.5, sy = (y + 0.5) / k - 0.5;
            const x0 = Math.max(0, Math.min(g.w - 1, Math.floor(sx))), y0 = Math.max(0, Math.min(g.h - 1, Math.floor(sy)));
            const x1 = Math.min(g.w - 1, x0 + 1), y1 = Math.min(g.h - 1, y0 + 1);
            const fx = Math.min(1, Math.max(0, sx - x0)), fy = Math.min(1, Math.max(0, sy - y0));
            const a = g.data[y0 * g.w + x0], b = g.data[y0 * g.w + x1], c = g.data[y1 * g.w + x0], d = g.data[y1 * g.w + x1];
            data[y * w + x] = Math.round(a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy);
        }
    return { w, h, data };
}
function resize(g, maxSide) {
    const long = Math.max(g.w, g.h);
    // картинка из документа часто мелкая (300–500 px): подписи внутри неё тоньше, чем нужно скелету,
    // и превращаются в закорючки. Увеличиваем до рабочего размера, тогда буквы читаются.
    if (long < maxSide) {
        const up = Math.min(UPSCALE_MAX, maxSide / long);
        return up > 1.05 ? upscale(g, up) : g;
    }
    const k = Math.min(1, maxSide / long);
    if (k >= 1)
        return g;
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
                    if (v < mn)
                        mn = v;
                }
            // тёмная линия в блоке важнее светлого фона вокруг
            data[y * w + x] = n ? Math.round((s / n) * 0.5 + mn * 0.5) : 255;
        }
    return { w, h, data };
}
/** Чернила: пиксель заметно темнее среднего по окрестности и не светлее бумаги. */
export function binarize(g, contrast = 0.14) {
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
            if (v < 215 && v < mean * (1 - contrast) - 4)
                out[y * w + x] = 1;
        }
    return out;
}
/** Порог Оцу по гистограмме яркости. */
export function otsu(data) {
    const hist = new Float64Array(256);
    for (let i = 0; i < data.length; i++)
        hist[data[i]]++;
    const n = data.length;
    let sumAll = 0;
    for (let i = 0; i < 256; i++)
        sumAll += i * hist[i];
    let wB = 0, sumB = 0, best = 0, th = 128;
    for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (!wB)
            continue;
        const wF = n - wB;
        if (!wF)
            break;
        sumB += t * hist[t];
        const mB = sumB / wB, mF = (sumAll - sumB) / wF;
        const v = wB * wF * (mB - mF) * (mB - mF);
        if (v > best) {
            best = v;
            th = t;
        }
    }
    return th;
}
/**
 * Картинка «с компьютера» (рисунок, скриншот, значок): ровный белый фон, почти нет полутонов.
 * Для неё порог общий — иначе середина больших залитых мест не считается чернилами (она не темнее соседей).
 */
export function isCleanImage(g) {
    let white = 0, mid = 0;
    for (let i = 0; i < g.data.length; i++) {
        const v = g.data[i];
        if (v >= 225)
            white++;
        else if (v > 70 && v < 190)
            mid++;
    }
    return white / g.data.length > 0.3 && mid / g.data.length < 0.12;
}
function binarizeGlobal(g) {
    const th = Math.min(200, Math.max(60, otsu(g.data)));
    const out = new Uint8Array(g.data.length);
    for (let i = 0; i < out.length; i++)
        if (g.data[i] < th)
            out[i] = 1;
    addRegionEdges(g, out, th);
    return out;
}
/**
 * Граница между серыми заливками (сектор диаграммы, залитый блок): сама заливка светлее порога
 * и чернилами не считается, но её край нарисовать надо — иначе от круговой диаграммы остаётся
 * один тёмный сектор. Берём пиксель с тёмной стороны перепада яркости.
 */
function addRegionEdges(g, out, th) {
    const { w, h, data } = g;
    const JUMP = 16;
    for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const v = data[i];
            // почти бумага или уже чернила — не трогаем
            if (out[i] || v >= 245 || v < th)
                continue;
            let mx = 0, nearInk = false;
            for (let dy = -2; dy <= 2 && !nearInk; dy++)
                for (let dx = -2; dx <= 2; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h)
                        continue;
                    if (out[ny * w + nx]) {
                        nearInk = true;
                        break;
                    }
                }
            for (let d = 0; d < 4 && !nearInk; d++) {
                const n = d === 0 ? i - 1 : d === 1 ? i + 1 : d === 2 ? i - w : i + w;
                const diff = data[n] - v;
                if (diff > mx)
                    mx = diff;
            }
            // край буквы — это её же сглаживание: там чернила уже есть, и вторая линия только портит букву
            if (!nearInk && mx > JUMP)
                out[i] = 1;
        }
}
/** Связные пятна (8 соседей): номер пятна для каждого пикселя, 0 — фон. */
function label(bin, W, H) {
    const lab = new Int32Array(W * H);
    const stack = [];
    let count = 0;
    for (let i = 0; i < bin.length; i++) {
        if (!bin[i] || lab[i])
            continue;
        count++;
        lab[i] = count;
        stack.push(i);
        while (stack.length) {
            const c = stack.pop();
            const x = c % W, y = (c / W) | 0;
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= H)
                        continue;
                    const n = ny * W + nx;
                    if (bin[n] && !lab[n]) {
                        lab[n] = count;
                        stack.push(n);
                    }
                }
        }
    }
    return { lab, count };
}
/** Край пятна: пиксель чернил, у которого сверху/снизу/слева/справа фон. */
function isEdge(bin, W, H, i) {
    const x = i % W, y = (i / W) | 0;
    return x === 0 || y === 0 || x === W - 1 || y === H - 1 || !bin[i - 1] || !bin[i + 1] || !bin[i - W] || !bin[i + W];
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
            const x = c % W, y = (c / W) | 0;
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= H)
                        continue;
                    const n = ny * W + nx;
                    if (bin[n] && !seen[n]) {
                        seen[n] = 1;
                        stack.push(n);
                    }
                }
        }
        if (comp.length < minArea)
            for (const c of comp)
                bin[c] = 0;
    }
}
function length(p) {
    let l = 0;
    for (let i = 2; i < p.length; i += 2)
        l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    return l;
}
/** Толщина штриха: медиана отношения «площадь пятна / длина его скелета» с весом длины скелета. */
function weightedMedian(area, sk) {
    const rows = [];
    let total = 0;
    for (let k = 1; k < area.length; k++) {
        const w = sk[k];
        if (w < 1)
            continue;
        rows.push({ v: area[k] / w, w });
        total += w;
    }
    if (!rows.length)
        return 1;
    rows.sort((a, b) => a.v - b.v);
    let acc = 0;
    for (const r of rows) {
        acc += r.w;
        if (acc >= total / 2)
            return Math.min(Math.max(1, r.v), 12);
    }
    return Math.min(Math.max(1, rows[rows.length - 1].v), 12);
}
/**
 * Рабочее разрешение по умолчанию. Картинку с компьютера (схема, диаграмма, скриншот) не уменьшаем:
 * подпись высотой 20 точек после сжатия вдвое перестаёт быть буквами и выходит закорючками.
 * У фотографии такой мелочи нет, а шума много, поэтому ей хватает меньшего размера.
 */
export function defaultSize(g) {
    const long = Math.max(g.w, g.h);
    return isCleanImage(g) ? Math.min(2000, Math.max(900, long)) : 1200;
}
export function vectorize(g, opts = {}) {
    const img = resize(g, opts.size ?? defaultSize(g));
    const { w: W, h: H } = img;
    const bin = isCleanImage(img) ? binarizeGlobal(img) : binarize(img, opts.contrast ?? 0.14);
    // Скелет и пятна считаем один раз: по ним видно и толщину штриха, и какие пятна залитые.
    const skel = bin.slice();
    thin(skel, W, H);
    const { lab, count } = label(bin, W, H);
    const area = new Float64Array(count + 1), sk = new Float64Array(count + 1);
    for (let i = 0; i < bin.length; i++)
        if (lab[i]) {
            area[lab[i]]++;
            if (skel[i])
                sk[lab[i]]++;
        }
    // Толщина штриха = площадь пятна / длина его скелета, по всем пятнам медианой с весом длины скелета.
    // Среднее по всей картинке не годится: одно залитое место (сектор диаграммы) перетянуло бы его на себя,
    // и тогда подписи рядом считались бы мусором — из-за этого они и превращались в закорючки.
    const strokeW = weightedMedian(area, sk);
    removeSpecks(bin, W, H, Math.max(4, Math.round(strokeW * strokeW)));
    const mode = opts.mode ?? 'lines';
    if (mode === 'lines')
        bin.set(skel);
    else {
        // скелет — для тонких пятен, контур — для толстых (средняя линия залитого круга — это точка, а не круг)
        const thick = Math.max(5, strokeW * 4);
        const outline = (k) => mode === 'outline' || area[k] / Math.max(1, sk[k]) > thick;
        const res = new Uint8Array(W * H);
        for (let i = 0; i < bin.length; i++) {
            const k = lab[i];
            if (!k || !bin[i])
                continue;
            if (outline(k) ? isEdge(bin, W, H, i) : skel[i])
                res[i] = 1;
        }
        thin(res, W, H);
        bin.set(res);
    }
    pruneStairs(bin, W, H);
    const raw = trace(bin, W, H, Math.max(2, strokeW * 0.8));
    const minLen = opts.minLen !== undefined ? opts.minLen * W : Math.max(3, strokeW);
    const paths = [];
    for (const p of raw) {
        if (p.length < 4 || length(p) < minLen)
            continue;
        const s = simplify(smooth(p), 0.6);
        const out = new Array(s.length);
        for (let i = 0; i < s.length; i += 2) {
            out[i] = Math.round((s[i] / W) * 10000) / 10000;
            out[i + 1] = Math.round((s[i + 1] / W) * 10000) / 10000;
        }
        paths.push(out);
    }
    return { aspect: H / W, paths };
}
/** Рамка с диагоналями — заглушка, если картинку не удалось прочитать. */
export function placeholderDrawing(aspect = 0.6) {
    return { aspect, paths: [[0, 0, 1, 0, 1, aspect, 0, aspect, 0, 0]] };
}
