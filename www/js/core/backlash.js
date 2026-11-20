// Тест люфта: пары чёрточек, к которым ручка подъезжает с разных сторон. Из-за люфта вторая чёрточка
// встаёт со сдвигом; в паре номер k она смещена назад на k·STEP мм. Где пара сошлась в одну линию —
// там сдвиг равен люфту. Печатается без поправки на люфт.
import { fmt } from "./plan.js";
import { paperToWork, penZ } from "./calibration.js";
export const BACKLASH_STEP = 0.25;
export const BACKLASH_PAIRS = 9;
/** где на листе печатается тест (мм от левого верхнего угла) */
const U0 = 15, PITCH = 8, V_U = 15, V_V = 50;
/** Люфт по номеру сошедшейся пары. */
export const backlashOf = (pair) => Math.max(0, pair) * BACKLASH_STEP;
/**
 * G-код теста. digit(ch) — штрихи цифры высотой 1 (y вниз, x от 0), для подписей номеров пар.
 * Верхний ряд — люфт поперёк листа (вертикальные чёрточки), нижний — вдоль высоты листа (горизонтальные).
 */
export function backlashTestGcode(frame, calib, pen, feed, digit) {
    const z = penZ(calib, pen.pressure);
    const out = ['; Plotterm: тест люфта', 'G21 G90', `G0 Z${fmt(z.up)}`];
    const go = (u, v) => {
        const [x, y] = paperToWork(frame, u, v);
        out.push(`G0 X${fmt(x)} Y${fmt(y)}`);
    };
    const line = (pts) => {
        go(pts[0], pts[1]);
        out.push(`G1 Z${fmt(z.down)} F${Math.round(Math.max(50, pen.zDownFeed))}`);
        if (pen.dwellMs > 0)
            out.push(`G4 P${fmt(pen.dwellMs / 1000)}`);
        for (let i = 2; i < pts.length; i += 2) {
            const [x, y] = paperToWork(frame, pts[i], pts[i + 1]);
            out.push(`G1 X${fmt(x)} Y${fmt(y)} F${Math.round(feed)}`);
        }
        out.push(`G0 Z${fmt(z.up)}`);
    };
    const label = (k, u, v) => {
        for (const st of digit(String(k)))
            line(st.map((c, i) => (i % 2 === 0 ? u + c * 2.5 : v + c * 2.5)));
    };
    for (let k = 0; k < BACKLASH_PAIRS; k++) {
        const u = U0 + k * PITCH, off = k * BACKLASH_STEP;
        // поперёк: верхняя чёрточка — подъезд слева, нижняя — справа и на k·шаг левее
        go(u - 3, V_U);
        line([u, V_U, u, V_U + 6]);
        go(u + 3, V_U + 7);
        line([u - off, V_U + 7, u - off, V_U + 13]);
        label(k, u - 0.8, V_U + 15);
        // вдоль высоты: левая чёрточка — подъезд сверху, правая — снизу и на k·шаг выше
        go(u - 3, V_V - 3);
        line([u - 3, V_V, u, V_V]);
        go(u + 0.5, V_V + 3);
        line([u + 0.5, V_V - off, u + 3.5, V_V - off]);
        label(k, u - 0.8, V_V + 3);
    }
    out.push(`G0 Z${fmt(z.up)}`);
    return out;
}
