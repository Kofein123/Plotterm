// Планировщик: штрихи страницы → порядок → G-код с подъёмом/опусканием ручки по Z.
import { dropTiny, polyLength, reversePts, simplify } from "./geometry.js";
import { paperToWork, penZ } from "./calibration.js";
import { feedOf } from "./types.js";
export const DEFAULT_LIMITS = { rapid: 12000, accel: 6000, zRate: 3000, zAccel: 500 };
export function fmt(n) {
    const s = (Math.round(n * 100) / 100).toFixed(2);
    const t = s.replace(/\.?0+$/, '');
    return t === '-0' ? '0' : t;
}
/** Порядок штрихов: строка за строкой, внутри строки — ближайший сосед с возможным разворотом. */
export function orderStrokes(strokes, reorder) {
    if (!reorder)
        return strokes.map((s) => ({ ...s }));
    const groups = new Map();
    for (const s of strokes) {
        if (!groups.has(s.line))
            groups.set(s.line, []);
        groups.get(s.line).push(s);
    }
    const keys = [...groups.keys()].sort((a, b) => (a === 0 ? 1e9 : a) - (b === 0 ? 1e9 : b));
    const out = [];
    let cx = 0, cy = 0;
    for (const k of keys) {
        const rest = groups.get(k).slice();
        // начинаем строку с самого левого штриха
        if (out.length === 0 || k !== 0) {
            let bi = 0, bv = Infinity;
            rest.forEach((s, i) => {
                const m = Math.min(s.pts[0], s.pts[s.pts.length - 2]);
                if (m < bv) {
                    bv = m;
                    bi = i;
                }
            });
            const s = rest.splice(bi, 1)[0];
            const rev = s.pts[s.pts.length - 2] < s.pts[0] - 0.01;
            const pts = rev ? reversePts(s.pts) : s.pts;
            out.push({ pts, line: s.line });
            cx = pts[pts.length - 2];
            cy = pts[pts.length - 1];
        }
        while (rest.length) {
            let bi = 0, bd = Infinity, brev = false;
            for (let i = 0; i < rest.length; i++) {
                const p = rest[i].pts;
                const ds = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
                const de = (p[p.length - 2] - cx) ** 2 + (p[p.length - 1] - cy) ** 2;
                if (ds < bd) {
                    bd = ds;
                    bi = i;
                    brev = false;
                }
                if (de < bd) {
                    bd = de;
                    bi = i;
                    brev = true;
                }
            }
            const s = rest.splice(bi, 1)[0];
            const pts = brev ? reversePts(s.pts) : s.pts;
            out.push({ pts, line: s.line });
            cx = pts[pts.length - 2];
            cy = pts[pts.length - 1];
        }
    }
    return out;
}
export function buildPlan(inp) {
    const { frame, speed, pen, limits } = inp;
    // 1. поворот страницы и упрощение
    const prepared = inp.strokes
        .map((s) => {
        let pts = s.pts;
        if (inp.rotate180) {
            pts = pts.map((v, i) => (i % 2 === 0 ? inp.pageW - v : inp.pageH - v));
        }
        pts = dropTiny(simplify(pts, speed.simplify), 0.05);
        return { pts, line: s.line };
    })
        .map((s) => (s.pts.length === 2 ? { pts: [s.pts[0], s.pts[1], s.pts[0] + 0.05, s.pts[1]], line: s.line } : s))
        .filter((s) => s.pts.length >= 4);
    // 2. порядок и склейка
    const ordered = orderStrokes(prepared, inp.reorder);
    const joined = [];
    for (const s of ordered) {
        const last = joined[joined.length - 1];
        if (last && speed.joinTolerance > 0) {
            const lx = last.pts[last.pts.length - 2], ly = last.pts[last.pts.length - 1];
            if (Math.hypot(s.pts[0] - lx, s.pts[1] - ly) <= speed.joinTolerance && last.line === s.line) {
                last.pts = last.pts.concat(s.pts.slice(2));
                continue;
            }
        }
        joined.push({ pts: s.pts.slice(), line: s.line });
    }
    // 3. проверка границ листа
    const outOfBounds = [];
    const tol = 0.3;
    joined.forEach((s, i) => {
        for (let j = 0; j < s.pts.length; j += 2) {
            const u = s.pts[j], v = s.pts[j + 1];
            if (u < -tol || v < -tol || u > frame.width + tol || v > frame.height + tol) {
                outOfBounds.push(i);
                break;
            }
        }
    });
    // 4. G-код
    const z = penZ(inp.calib, pen.pressure);
    const feed = Math.min(feedOf(speed), limits.rapid);
    const zFeed = Math.max(50, Math.min(pen.zDownFeed, limits.zRate));
    const gcode = [];
    const lineStrokeArr = [];
    const strokeStart = [];
    const emit = (l, si) => {
        gcode.push(l);
        lineStrokeArr.push(si);
    };
    emit(`; Plotterm: ${inp.title}${inp.dryRun ? ' (сухой прогон)' : ''}`, -1);
    emit('G21 G90', -1);
    emit(`G0 Z${fmt(z.up)}`, -1);
    let drawLength = 0;
    let travelLength = 0;
    let px = 0, py = 0;
    let first = true;
    const strokeTime = [];
    let t = 0;
    const vDraw = feed / 60;
    const vTravel = (speed.travelFeed > 0 ? Math.min(speed.travelFeed, limits.rapid) : limits.rapid) / 60;
    const a = Math.max(100, limits.accel);
    const zTravel = Math.abs(z.up - z.down);
    const zTime = zTravel / (Math.min(limits.zRate, 3000) / 60) + 2 * Math.sqrt(zTravel / Math.max(50, limits.zAccel));
    const zDownTime = zTravel / (zFeed / 60) + Math.sqrt(zTravel / Math.max(50, limits.zAccel));
    joined.forEach((s, si) => {
        strokeTime.push(t);
        strokeStart.push(gcode.length);
        const [x0, y0] = paperToWork(frame, s.pts[0], s.pts[1]);
        const travel = first ? 0 : Math.hypot(s.pts[0] - px, s.pts[1] - py);
        travelLength += travel;
        t += travel / vTravel + (travel > 0 ? 2 * Math.sqrt(travel / a) : 0);
        if (speed.travelFeed > 0)
            emit(`G1 X${fmt(x0)} Y${fmt(y0)} F${Math.round(Math.min(speed.travelFeed, limits.rapid))}`, si);
        else
            emit(`G0 X${fmt(x0)} Y${fmt(y0)}`, si);
        if (!inp.dryRun) {
            emit(`G1 Z${fmt(z.down)} F${Math.round(zFeed)}`, si);
            if (pen.dwellMs > 0)
                emit(`G4 P${fmt(pen.dwellMs / 1000)}`, si);
        }
        t += zDownTime + pen.dwellMs / 1000;
        let lx = fmt(x0), ly = fmt(y0);
        let firstMove = true;
        let prevAngle = null;
        for (let j = 2; j < s.pts.length; j += 2) {
            const [x, y] = paperToWork(frame, s.pts[j], s.pts[j + 1]);
            const fx = fmt(x), fy = fmt(y);
            if (fx === lx && fy === ly)
                continue;
            let cmd = firstMove ? 'G1 ' : '';
            if (fx !== lx)
                cmd += 'X' + fx;
            if (fy !== ly)
                cmd += 'Y' + fy;
            if (firstMove)
                cmd += ` F${Math.round(feed)}`;
            emit(cmd, si);
            firstMove = false;
            const seg = Math.hypot(s.pts[j] - s.pts[j - 2], s.pts[j + 1] - s.pts[j - 1]);
            drawLength += seg;
            t += seg / vDraw;
            const ang = Math.atan2(s.pts[j + 1] - s.pts[j - 1], s.pts[j] - s.pts[j - 2]);
            if (prevAngle !== null) {
                let d = Math.abs(ang - prevAngle);
                if (d > Math.PI)
                    d = 2 * Math.PI - d;
                // торможение на поворотах: примерно v/a на резкий угол
                t += (vDraw / a) * (d / Math.PI) * 1.2;
            }
            prevAngle = ang;
            lx = fx;
            ly = fy;
        }
        t += 2 * (vDraw / a);
        emit(`G0 Z${fmt(z.up)}`, si);
        t += zTime / 2;
        px = s.pts[s.pts.length - 2];
        py = s.pts[s.pts.length - 1];
        first = false;
    });
    emit(`G0 Z${fmt(z.up)}`, -1);
    if (speed.park === 'zero')
        emit('G0 X0 Y0', -1);
    else if (speed.park === 'away') {
        const [x, y] = paperToWork(frame, 0, frame.height);
        emit(`G0 X${fmt(x)} Y${fmt(y)}`, -1);
    }
    const factor = inp.timeFactor && inp.timeFactor > 0.3 && inp.timeFactor < 3 ? inp.timeFactor : 1;
    return {
        strokes: joined.map((s) => s.pts),
        strokeLine: joined.map((s) => s.line),
        gcode,
        strokeStart,
        lineStroke: Int32Array.from(lineStrokeArr),
        outOfBounds,
        drawLength,
        travelLength,
        penLifts: joined.length,
        estSeconds: t * factor,
        strokeTime: strokeTime.map((x) => x * factor),
    };
}
/** Длина ломаных (для статистики). */
export function totalLength(strokes) {
    return strokes.reduce((a, s) => a + polyLength(s), 0);
}
