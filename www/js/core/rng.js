/** Детерминированный генератор случайных чисел (mulberry32): одно зерно — один и тот же результат. */
export function rng(seed) {
    let a = seed >>> 0 || 0x9e3779b9;
    const next = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        /** равномерно в [-1, 1] */
        sym: () => next() * 2 - 1,
        range: (a0, b0) => a0 + (b0 - a0) * next(),
        int: (n) => Math.floor(next() * n),
    };
}
