// Связное письмо: соединительные штрихи между буквами внутри слова.
export function connector(from, to, high, steps = 8) {
    const dx = to.x - from.x;
    const c0x = from.x + dx * 0.45;
    const c0y = from.y - (high ? Math.abs(from.y) * 0.22 : -Math.abs(dx) * 0.12);
    const c1x = to.x - dx * 0.45;
    const c1y = to.y + (high ? Math.abs(from.y) * 0.26 : Math.abs(dx) * 0.14);
    const out = [];
    for (let k = 1; k < steps; k++) {
        const t = k / steps;
        const m = 1 - t;
        out.push(m * m * m * from.x + 3 * m * m * t * c0x + 3 * m * t * t * c1x + t * t * t * to.x, m * m * m * from.y + 3 * m * m * t * c0y + 3 * m * t * t * c1y + t * t * t * to.y);
    }
    return out;
}
/** Выход считается высоким, если он выше трети высоты строчной буквы. */
export function isHighExit(outY, xHeight) {
    return outY > xHeight * 0.34;
}
