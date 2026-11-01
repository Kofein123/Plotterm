import { CUSTOM_X_HEIGHT } from "../fonts/fonts.js";
import { simplify } from "../core/geometry.js";
export const IMPORT_CHARS = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ' +
    'әғқңөұүһіӘҒҚҢӨҰҮҺІ' +
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ' +
    '0123456789.,:;!?-—–()[]«»"\'/\\+=%№*<>@#&_^~$';
const FONT_PX = 180; // размер растра: x-высота получается ~80–100 px
import { repairSfnt } from "./fontrepair.js";
export async function importOutlineFont(file, onProgress) {
    const fam = 'plt_import_' + Date.now().toString(36);
    const data = await file.arrayBuffer();
    let face = new FontFace(fam, data);
    try {
        await face.load();
    }
    catch {
        // старый шрифт с ошибками в заголовке — чиним служебные поля и пробуем ещё раз
        const fixed = repairSfnt(data);
        face = new FontFace(fam, fixed ?? data);
        try {
            if (!fixed)
                throw new Error();
            await face.load();
        }
        catch {
            throw new Error('браузер не смог прочитать шрифт (нужен .ttf, .otf, .woff или .woff2)');
        }
    }
    document.fonts.add(face);
    try {
        return await convert(fam, file.name.replace(/\.(ttf|otf|woff2?)$/i, ''), onProgress);
    }
    finally {
        document.fonts.delete(face);
    }
}
async function convert(fam, name, onProgress) {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const font = (fallback) => `${FONT_PX}px "${fam}", ${fallback}`;
    // x-высота шрифта: по «x» или по «н»
    ctx.font = font('sans-serif');
    let xh = 0;
    for (const probe of ['x', 'н', 'o', 'о']) {
        if (!hasGlyph(ctx, fam, probe))
            continue;
        const m = ctx.measureText(probe);
        xh = m.actualBoundingBoxAscent;
        if (probe === 'o' || probe === 'о')
            xh *= 0.97;
        if (xh > 5)
            break;
    }
    if (xh <= 5)
        xh = FONT_PX * 0.45;
    const k = CUSTOM_X_HEIGHT / xh;
    const glyphs = {};
    const chars = [...IMPORT_CHARS];
    let strokeW = 0;
    let spaceW = 0;
    ctx.font = font('sans-serif');
    spaceW = ctx.measureText(' ').width * k;
    for (let ci = 0; ci < chars.length; ci++) {
        const ch = chars[ci];
        if (ci % 12 === 0) {
            onProgress?.(ci, chars.length);
            await new Promise((r) => setTimeout(r, 0));
        }
        if (!hasGlyph(ctx, fam, ch))
            continue;
        ctx.font = font('sans-serif');
        const m = ctx.measureText(ch);
        const left = Math.ceil(Math.max(0, m.actualBoundingBoxLeft)) + 6;
        const W = Math.ceil(left + m.actualBoundingBoxRight + 8);
        const asc = Math.ceil(m.actualBoundingBoxAscent) + 6;
        const H = Math.ceil(asc + m.actualBoundingBoxDescent + 8);
        if (W < 3 || H < 3 || W > 2000 || H > 2000)
            continue;
        cv.width = W;
        cv.height = H;
        ctx.clearRect(0, 0, W, H);
        ctx.font = font('sans-serif');
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(ch, left, asc);
        const img = ctx.getImageData(0, 0, W, H).data;
        const bin = new Uint8Array(W * H);
        let filled = 0;
        for (let i = 0; i < W * H; i++)
            if (img[i * 4 + 3] > 110) {
                bin[i] = 1;
                filled++;
            }
        if (!filled)
            continue;
        const before = filled;
        // точки (ё, i, «:», «.») — отдельные мелкие пятна: заменяем коротким штрихом в центре
        const dots = extractDots(bin, W, H, xh * 0.36);
        thin(bin, W, H);
        pruneStairs(bin, W, H);
        let skel = 0;
        for (let i = 0; i < bin.length; i++)
            skel += bin[i];
        // средняя толщина штриха ≈ площадь / длина скелета
        if (skel > 10 && /[a-zа-я]/i.test(ch))
            strokeW = Math.max(strokeW, before / skel);
        const paths = trace(bin, W, H, Math.max(3, (before / Math.max(skel, 1)) * 0.9));
        for (const [cx, cy, r] of dots)
            paths.push([cx - r * 0.35, cy, cx + r * 0.35, cy]);
        if (!paths.length)
            continue;
        const strokes = [];
        for (const p of paths) {
            const sm = smooth(p);
            const simp = simplify(sm, 0.6);
            const out = [];
            for (let i = 0; i < simp.length; i += 2) {
                out.push(Math.round((simp[i] - left) * k * 10) / 10, Math.round((asc - simp[i + 1]) * k * 10) / 10);
            }
            if (out.length >= 4)
                strokes.push(out);
        }
        if (!strokes.length)
            continue;
        glyphs[ch] = [{ w: Math.round(m.width * k * 10) / 10, s: strokes }];
    }
    onProgress?.(chars.length, chars.length);
    if (Object.keys(glyphs).length < 5)
        throw new Error('в шрифте почти нет подходящих символов');
    void strokeW;
    return {
        id: 'custom-' + Date.now().toString(36),
        name,
        baseFontId: 'gost-a',
        glyphs,
        // ширина глифа = собственная ширина шрифта, поэтому межбуквенный интервал 0
        letterSpacing: 0,
        wordSpacing: Math.round(spaceW),
        updatedAt: Date.now(),
    };
}
/** Есть ли символ в шрифте: при отсутствии браузер подставит разные запасные шрифты. */
function hasGlyph(ctx, fam, ch) {
    ctx.font = `${FONT_PX}px "${fam}", monospace`;
    const a = ctx.measureText(ch);
    ctx.font = `${FONT_PX}px "${fam}", serif`;
    const b = ctx.measureText(ch);
    if (Math.abs(a.width - b.width) > 0.01)
        return false;
    if (Math.abs(a.actualBoundingBoxAscent - b.actualBoundingBoxAscent) > 0.01)
        return false;
    return a.width > 0 || a.actualBoundingBoxAscent > 0;
}
/** Утончение Zhang–Suen: оставляет скелет толщиной 1 пиксель. */
export function thin(img, W, H) {
    const del = [];
    let changed = true;
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : img[y * W + x]);
    while (changed) {
        changed = false;
        for (let pass = 0; pass < 2; pass++) {
            del.length = 0;
            for (let y = 0; y < H; y++)
                for (let x = 0; x < W; x++) {
                    if (!img[y * W + x])
                        continue;
                    const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
                    const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
                    const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
                    // b ≥ 3, а не 2 (поправка Лю — Ванга): иначе диагональ толщиной 2 пикселя стирается целиком —
                    // так пропадала верхняя ветка «к» в крупной клетке
                    if (b < 3 || b > 6)
                        continue;
                    const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
                    let a = 0;
                    for (let i = 0; i < 8; i++)
                        if (!seq[i] && seq[i + 1])
                            a++;
                    if (a !== 1)
                        continue;
                    if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8)
                        continue;
                    del.push(y * W + x);
                }
            if (del.length)
                changed = true;
            for (const i of del)
                img[i] = 0;
        }
    }
}
/** Найти мелкие связные пятна (размер ≤ maxSize), стереть их и вернуть центры [x, y, радиус]. */
export function extractDots(img, W, H, maxSize) {
    const seen = new Uint8Array(W * H);
    const out = [];
    const stack = [];
    for (let i = 0; i < img.length; i++) {
        if (!img[i] || seen[i])
            continue;
        const comp = [];
        stack.push(i);
        seen[i] = 1;
        let minX = W, minY = H, maxX = 0, maxY = 0;
        while (stack.length) {
            const c = stack.pop();
            comp.push(c);
            const x = c % W, y = (c / W) | 0;
            if (x < minX)
                minX = x;
            if (x > maxX)
                maxX = x;
            if (y < minY)
                minY = y;
            if (y > maxY)
                maxY = y;
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= H)
                        continue;
                    const n = ny * W + nx;
                    if (img[n] && !seen[n]) {
                        seen[n] = 1;
                        stack.push(n);
                    }
                }
        }
        const w = maxX - minX + 1, h = maxY - minY + 1;
        // пятно: маленькое и «круглое» (не тонкая чёрточка)
        if (Math.max(w, h) <= maxSize && Math.min(w, h) >= Math.max(w, h) * 0.3) {
            for (const c of comp)
                img[c] = 0;
            out.push([(minX + maxX) / 2, (minY + maxY) / 2, Math.max(w, h) / 2]);
        }
    }
    return out;
}
/** Убрать «ступеньки»: угловой пиксель, без которого линия остаётся связной (иначе ложные развилки). */
export function pruneStairs(img, W, H) {
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : img[y * W + x]);
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            if (!img[y * W + x])
                continue;
            const hs = [-1, 1].filter((d) => at(x + d, y));
            const vs = [-1, 1].filter((d) => at(x, y + d));
            if (hs.length !== 1 || vs.length !== 1)
                continue;
            const hx = x + hs[0], vy = y + vs[0];
            // все остальные соседи должны касаться h или v
            let ok = true;
            for (let dy = -1; dy <= 1 && ok; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if ((dx === 0 && dy === 0) || !at(nx, ny))
                        continue;
                    if ((nx === hx && ny === y) || (nx === x && ny === vy))
                        continue;
                    const nearH = Math.abs(nx - hx) <= 1 && Math.abs(ny - y) <= 1;
                    const nearV = Math.abs(nx - x) <= 1 && Math.abs(ny - vy) <= 1;
                    if (!nearH && !nearV) {
                        ok = false;
                        break;
                    }
                }
            if (ok)
                img[y * W + x] = 0;
        }
}
const NB = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
/** Скелет → ломаные. Короткие «усики» длиной меньше spur отбрасываются. */
export function trace(img, W, H, spur) {
    const deg = new Uint8Array(W * H);
    const neighbors = (i) => {
        const x = i % W, y = (i / W) | 0;
        const out = [];
        for (const [dx, dy] of NB) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && img[ny * W + nx])
                out.push(ny * W + nx);
        }
        return out;
    };
    for (let i = 0; i < img.length; i++)
        if (img[i])
            deg[i] = neighbors(i).length;
    const usedEdge = new Set();
    const edgeKey = (a, b) => (a < b ? a * img.length + b : b * img.length + a);
    const paths = [];
    const walk = (start, next) => {
        const pts = [start % W, (start / W) | 0];
        let prev = start;
        let cur = next;
        usedEdge.add(edgeKey(prev, cur));
        while (true) {
            pts.push(cur % W, (cur / W) | 0);
            if (deg[cur] !== 2)
                break;
            const nb = neighbors(cur).filter((n) => n !== prev && !usedEdge.has(edgeKey(cur, n)));
            if (!nb.length)
                break;
            // предпочитаем соседа по прямой (4-связность), чтобы не срезать углы
            nb.sort((a, b) => manhattan(cur, a, W) - manhattan(cur, b, W));
            prev = cur;
            cur = nb[0];
            usedEdge.add(edgeKey(prev, cur));
            if (cur === start) {
                pts.push(cur % W, (cur / W) | 0);
                break;
            }
        }
        paths.push({ pts, ends: [start, cur] });
    };
    // начинаем с концов и развилок
    for (let i = 0; i < img.length; i++) {
        if (!img[i] || deg[i] === 2)
            continue;
        for (const n of neighbors(i))
            if (!usedEdge.has(edgeKey(i, n)))
                walk(i, n);
    }
    // оставшиеся замкнутые петли (о, 0)
    for (let i = 0; i < img.length; i++) {
        if (!img[i])
            continue;
        for (const n of neighbors(i))
            if (!usedEdge.has(edgeKey(i, n)))
                walk(i, n);
    }
    // убираем мелкие усики (конец — развилка короче spur) и одиночные точки
    const len = (p) => {
        let l = 0;
        for (let i = 2; i < p.length; i += 2)
            l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
        return l;
    };
    const kept = paths.filter((p) => {
        const l = len(p.pts);
        const isSpur = (deg[p.ends[0]] === 1) !== (deg[p.ends[1]] === 1);
        if (isSpur && l < spur)
            return false;
        return l >= 1.5;
    });
    return mergeAtJunctions(kept.map((p) => p.pts));
}
function manhattan(a, b, W) {
    return Math.abs((a % W) - (b % W)) + Math.abs(((a / W) | 0) - ((b / W) | 0));
}
/** Склеить отрезки, которые сходятся в одной точке почти по прямой: меньше подъёмов ручки. */
function mergeAtJunctions(paths) {
    // у рисунка тысячи отрезков — перебор «каждый с каждым» там слишком долгий
    if (paths.length > 150)
        return mergeAtJunctionsFast(paths);
    const out = paths.map((p) => p.slice());
    let merged = true;
    const close = (ax, ay, bx, by) => Math.abs(ax - bx) <= 1.5 && Math.abs(ay - by) <= 1.5;
    while (merged) {
        merged = false;
        outer: for (let i = 0; i < out.length; i++) {
            for (let j = 0; j < out.length; j++) {
                if (i === j)
                    continue;
                const a = out[i], b = out[j];
                const ae = [a[a.length - 2], a[a.length - 1]];
                for (const rev of [false, true]) {
                    const bb = rev ? reverse(b) : b;
                    if (!close(ae[0], ae[1], bb[0], bb[1]))
                        continue;
                    // угол стыка: направление конца a и начала b
                    const n1 = Math.max(0, a.length - 10);
                    const d1 = [ae[0] - a[n1], ae[1] - a[n1 + 1]];
                    const m2 = Math.min(bb.length - 2, 8);
                    const d2 = [bb[m2] - bb[0], bb[m2 + 1] - bb[1]];
                    const cos = (d1[0] * d2[0] + d1[1] * d2[1]) / (Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1]) || 1);
                    if (cos < 0.5)
                        continue;
                    out[i] = a.concat(bb.slice(2));
                    out.splice(j, 1);
                    merged = true;
                    break outer;
                }
            }
        }
    }
    return out;
}
/** То же для больших рисунков: концы в сетке, каждый штрих продлеваем, пока есть продолжение почти по прямой. */
function mergeAtJunctionsFast(paths) {
    const alive = paths.map((p) => p.slice());
    const dead = new Uint8Array(alive.length);
    const grid = new Map();
    const key = (x, y) => Math.round(x / 2) * 100003 + Math.round(y / 2);
    const add = (i) => {
        const p = alive[i];
        for (const [x, y] of [[p[0], p[1]], [p[p.length - 2], p[p.length - 1]]]) {
            const k = key(x, y);
            const l = grid.get(k);
            if (l)
                l.push(i);
            else
                grid.set(k, [i]);
        }
    };
    alive.forEach((_, i) => add(i));
    const near = (x, y) => {
        const out = [];
        const cx = Math.round(x / 2), cy = Math.round(y / 2);
        for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
                for (const i of grid.get((cx + dx) * 100003 + cy + dy) ?? [])
                    out.push(i);
        return out;
    };
    const close = (ax, ay, bx, by) => Math.abs(ax - bx) <= 1.5 && Math.abs(ay - by) <= 1.5;
    for (let i = 0; i < alive.length; i++) {
        if (dead[i])
            continue;
        let grown = true;
        while (grown) {
            grown = false;
            const a = alive[i];
            const ex = a[a.length - 2], ey = a[a.length - 1];
            const n1 = Math.max(0, a.length - 10);
            const d1 = [ex - a[n1], ey - a[n1 + 1]];
            for (const j of near(ex, ey)) {
                if (j === i || dead[j])
                    continue;
                const b = alive[j];
                for (const rev of [false, true]) {
                    const bb = rev ? reverse(b) : b;
                    if (!close(ex, ey, bb[0], bb[1]))
                        continue;
                    const m2 = Math.min(bb.length - 2, 8);
                    const d2 = [bb[m2] - bb[0], bb[m2 + 1] - bb[1]];
                    const cos = (d1[0] * d2[0] + d1[1] * d2[1]) / (Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1]) || 1);
                    if (cos < 0.5)
                        continue;
                    alive[i] = a.concat(bb.slice(2));
                    dead[j] = 1;
                    add(i);
                    grown = true;
                    break;
                }
                if (grown)
                    break;
            }
        }
    }
    return alive.filter((_, i) => !dead[i]);
}
function reverse(p) {
    const r = [];
    for (let i = p.length - 2; i >= 0; i -= 2)
        r.push(p[i], p[i + 1]);
    return r;
}
/** Сглаживание скользящим средним (концы на месте): убирает «лесенку» пикселей. */
export function smooth(p) {
    const n = p.length / 2;
    if (n < 5)
        return p;
    const out = p.slice();
    for (let pass = 0; pass < 2; pass++) {
        const src = out.slice();
        for (let i = 1; i < n - 1; i++) {
            out[i * 2] = (src[i * 2 - 2] + 2 * src[i * 2] + src[i * 2 + 2]) / 4;
            out[i * 2 + 1] = (src[i * 2 - 1] + 2 * src[i * 2 + 1] + src[i * 2 + 3]) / 4;
        }
    }
    return out;
}
