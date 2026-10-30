// Связное письмо: соединительные штрихи между буквами внутри слова.
// Главный штрих глифа идёт от точки входа `i` к точке выхода `o` (единицы шрифта).
// Соединение — кубическая кривая Эрмита: выходит из буквы по направлению её главного штриха
// и входит в следующую по направлению её начала, поэтому на стыке нет излома.
/** Направление (единичный вектор) у начала (`atEnd` = false) или у конца ломаной, усреднённое на длине `d`. */
export function strokeTangent(pts, atEnd, d) {
    const n = pts.length / 2;
    if (n < 2)
        return null;
    const i0 = atEnd ? n - 1 : 0;
    const x0 = pts[i0 * 2], y0 = pts[i0 * 2 + 1];
    let best = null;
    for (let j = atEnd ? n - 2 : 1; j >= 0 && j < n; j += atEnd ? -1 : 1) {
        const dx = pts[j * 2] - x0, dy = pts[j * 2 + 1] - y0;
        const len = Math.hypot(dx, dy);
        if (len > 1e-9)
            best = atEnd ? [-dx / len, -dy / len] : [dx / len, dy / len];
        if (len >= d)
            break;
    }
    return best;
}
/** Письмо идёт вправо: касательная, смотрящая назад, подтягивается к горизонтали, иначе связка даст петлю. */
function forward(t) {
    if (t[0] >= 0)
        return t;
    const x = t[0] * 0.3 + 0.7, y = t[1] * 0.5;
    const l = Math.hypot(x, y);
    return [x / l, y / l];
}
/**
 * Точки соединительной кривой (без крайних — они уже есть в самих буквах).
 * `tOut` — направление письма в конце предыдущей буквы, `tIn` — в начале следующей (y вниз, как на листе).
 */
export function connector(from, to, tOut, tIn, steps = 8) {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const a = forward(tOut), b = forward(tIn);
    const L = dist * 0.4;
    const c0x = from.x + a[0] * L, c0y = from.y + a[1] * L;
    const c1x = to.x - b[0] * L, c1y = to.y - b[1] * L;
    const out = [];
    for (let k = 1; k < steps; k++) {
        const t = k / steps;
        const m = 1 - t;
        out.push(m * m * m * from.x + 3 * m * m * t * c0x + 3 * m * t * t * c1x + t * t * t * to.x, m * m * m * from.y + 3 * m * m * t * c0y + 3 * m * t * t * c1y + t * t * t * to.y);
    }
    return out;
}
/** Индекс (в плоском массиве), с которого начинать ломаную, чтобы срезать с начала длину `d`; хотя бы две точки остаются. */
export function trimStart(pts, d) {
    let acc = 0;
    for (let i = 2; i < pts.length - 2; i += 2) {
        acc += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
        if (acc >= d)
            return i;
    }
    return 0;
}
/** Длина массива после среза с конца длины `d`; хотя бы две точки остаются. */
export function trimEnd(pts, d) {
    let acc = 0;
    for (let i = pts.length - 4; i >= 2; i -= 2) {
        acc += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
        if (acc >= d)
            return i + 2;
    }
    return pts.length;
}
