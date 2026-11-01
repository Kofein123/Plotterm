/** Стык с изломом больше этого угла видно глазом. */
export const JOIN_KINK = 25;
const N = 48;
/** Ломаная из всех штрихов буквы подряд → N точек, равномерно по длине. */
function resample(strokes) {
    const pts = strokes.flat();
    const n = pts.length / 2;
    if (n < 2)
        return null;
    const acc = [0];
    for (let i = 1; i < n; i++)
        acc.push(acc[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
    const total = acc[n - 1];
    if (total <= 0)
        return null;
    const out = [];
    let j = 1;
    for (let k = 0; k < N; k++) {
        const d = (total * k) / (N - 1);
        while (j < n - 1 && acc[j] < d)
            j++;
        const seg = acc[j] - acc[j - 1] || 1;
        const t = Math.min(1, Math.max(0, (d - acc[j - 1]) / seg));
        out.push([pts[j * 2 - 2] + (pts[j * 2] - pts[j * 2 - 2]) * t, pts[j * 2 - 1] + (pts[j * 2 + 1] - pts[j * 2 - 1]) * t]);
    }
    return out;
}
function centered(p) {
    let cx = 0, cy = 0;
    for (const [x, y] of p) {
        cx += x;
        cy += y;
    }
    cx /= p.length;
    cy /= p.length;
    return p.map(([x, y]) => [x - cx, y - cy]);
}
/** Среднее расстояние между точками (после совмещения центров), мм. */
function rawDistance(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++)
        s += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
    return s / a.length;
}
/** Расстояние Прокруста (сдвиг, поворот, масштаб): 0 — подобные фигуры, 1 — ничего общего. */
function shapeDistance(a, b) {
    let re = 0, im = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        const [ax, ay] = a[i], [bx, by] = b[i];
        re += ax * bx + ay * by;
        im += ax * by - ay * bx;
        na += ax * ax + ay * ay;
        nb += bx * bx + by * by;
    }
    if (na <= 0 || nb <= 0)
        return 0;
    return Math.sqrt(Math.max(0, 1 - (re * re + im * im) / (na * nb)));
}
/** Направление из точки i назад/вперёд на расстояние d по ломаной (единичный вектор). */
function direction(pts, i, d, forward) {
    const n = pts.length / 2;
    const x0 = pts[i * 2], y0 = pts[i * 2 + 1];
    for (let j = forward ? i + 1 : i - 1; j >= 0 && j < n; j += forward ? 1 : -1) {
        const dx = pts[j * 2] - x0, dy = pts[j * 2 + 1] - y0;
        const len = Math.hypot(dx, dy);
        if (len >= d || j === 0 || j === n - 1)
            return len > 1e-9 ? [(forward ? dx : -dx) / len, (forward ? dy : -dy) / len] : null;
    }
    return null;
}
export function measureQuality(res, paper, xHeightMm) {
    const trace = res.trace;
    const byChar = new Map();
    for (const g of trace?.glyphs ?? []) {
        if (!/\p{L}/u.test(g.ch))
            continue;
        const p = resample(g.strokes);
        if (!p)
            continue;
        const list = byChar.get(g.ch) ?? [];
        list.push(centered(p));
        byChar.set(g.ch, list);
    }
    let rawSum = 0, shapeSum = 0, groups = 0;
    for (const list of byChar.values()) {
        if (list.length < 2)
            continue;
        // соседние экземпляры (по порядку в тексте) — именно их сравнивает глаз; не больше 40 пар на букву
        let r = 0, sh = 0, pairs = 0;
        for (let i = 1; i < list.length && pairs < 40; i++, pairs++) {
            r += rawDistance(list[i - 1], list[i]);
            sh += shapeDistance(list[i - 1], list[i]);
        }
        rawSum += r / pairs / xHeightMm;
        shapeSum += sh / pairs;
        groups++;
    }
    const angles = [];
    const probe = Math.max(0.2, xHeightMm * 0.12);
    for (const run of trace?.runs ?? []) {
        for (const j of run.joints) {
            const a = direction(run.pts, j, probe, false);
            const b = direction(run.pts, j, probe, true);
            if (!a || !b)
                continue;
            const cos = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]));
            angles.push((Math.acos(cos) * 180) / Math.PI);
        }
    }
    let outside = 0;
    const tol = 1.5;
    for (const pg of res.pages) {
        const left = pg.mirrored ? paper.marginRight : paper.marginLeft;
        const right = paper.width - (pg.mirrored ? paper.marginLeft : paper.marginRight);
        for (const s of pg.strokes)
            for (let i = 0; i < s.pts.length; i += 2) {
                const u = s.pts[i], v = s.pts[i + 1];
                if (u < left - tol || u > right + tol || v < 0 || v > paper.height)
                    outside++;
            }
    }
    return {
        variety: groups ? rawSum / groups : 0,
        shapeVariety: groups ? shapeSum / groups : 0,
        repeatedChars: groups,
        joins: {
            count: angles.length,
            mean: angles.length ? angles.reduce((a, b) => a + b, 0) / angles.length : 0,
            max: angles.length ? Math.max(...angles) : 0,
            kinked: angles.length ? angles.filter((a) => a > JOIN_KINK).length / angles.length : 0,
        },
        outside,
        missing: res.missingChars,
    };
}
