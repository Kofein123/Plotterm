// Предпросмотр листа: шаблон бумаги, штрихи, порядок печати, положение пера, границы.
import { h } from "./dom.js";
import { signal, effect, onCleanup } from "./reactive.js";
import { app } from "../app/state.js";
import { simInk, printFromStroke } from "../app/actions.js";
import { workToPaper } from "../core/calibration.js";
import { polyDist2 } from "../core/geometry.js";
import { Btn, Icon } from "./components.js";
import { fmtTime } from "../app/notify.js";
const view = signal({ scale: 3, ox: 40, oy: 40 });
let fitted = false;
export const pickMode = signal(false);
export const picked = signal(null);
/** План, который сейчас показываем: задание (если идёт) или предпросмотр текущей страницы. */
export function shownPlan() {
    const st = app.job.status.value;
    const jp = app.job.pages[app.job.pageIdx.value];
    if (st !== 'idle' && jp)
        return jp.plan;
    return app.previewPlan.value;
}
function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000';
}
export function Preview() {
    let canvas;
    let wrap;
    const size = signal({ w: 800, h: 600 });
    let raf = 0;
    let colors = {};
    const readColors = () => {
        colors = {
            desk: cssVar('--desk'), paper: cssVar('--paper'), grid: cssVar('--grid'), margin: cssVar('--margin-line'),
            ink: cssVar('--ink'), done: cssVar('--ink-done'), pending: cssVar('--ink-pending'), current: cssVar('--accent'),
            bad: cssVar('--danger'), travel: cssVar('--travel'), frame: cssVar('--ok'), pen: cssVar('--danger'), sim: cssVar('--ink-sim'),
        };
    };
    const fit = () => {
        const p = app.paper.peek();
        const f = app.frame.peek();
        const W = Math.max(p.width, f.ready ? f.width : 0);
        const H = Math.max(p.height, f.ready ? f.height : 0);
        const { w, h: hh } = size.peek();
        // сверху место под панель страниц, снизу — под легенду
        const top = 58, bottom = 48;
        const scale = Math.max(0.5, Math.min((w - 40) / W, (hh - top - bottom) / H));
        view.value = { scale, ox: (w - W * scale) / 2, oy: top + (hh - top - bottom - H * scale) / 2 };
    };
    const draw = () => {
        raf = 0;
        if (!canvas)
            return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const { w, h: hh } = size.peek();
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(hh * dpr);
        }
        const { scale, ox, oy } = view.peek();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = colors.desk;
        ctx.fillRect(0, 0, w, hh);
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
        const px = 1 / scale; // 1 экранный пиксель в мм
        const p = app.paper.peek();
        const f = app.frame.peek();
        const rot = p.rotate180;
        const tu = (u) => (rot ? p.width - u : u);
        const tv = (v) => (rot ? p.height - v : v);
        // лист
        ctx.shadowColor = 'rgba(0,0,0,0.18)';
        ctx.shadowBlur = 12 * px * scale;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = colors.paper;
        ctx.fillRect(0, 0, p.width, p.height);
        ctx.shadowColor = 'transparent';
        // разлиновка
        const layoutPage = app.layout.peek().pages[app.currentPage.peek()];
        const mirrored = layoutPage?.mirrored ?? (p.side === 'left');
        ctx.lineWidth = Math.max(0.12, px);
        ctx.strokeStyle = colors.grid;
        ctx.beginPath();
        const go = app.calib.peek().gridOrigin;
        if (p.template === 'grid') {
            const c = Math.max(1, p.cell);
            const offU = go ? ((go[0] % c) + c) % c : 0;
            const offV = go ? ((go[1] % c) + c) % c : 0;
            for (let u = offU; u <= p.width; u += c) {
                ctx.moveTo(tu(u), 0);
                ctx.lineTo(tu(u), p.height);
            }
            for (let v = offV; v <= p.height; v += c) {
                ctx.moveTo(0, tv(v));
                ctx.lineTo(p.width, tv(v));
            }
        }
        else if (p.template === 'ruled') {
            const s = Math.max(2, p.rulePitch);
            const off = go ? ((go[1] % s) + s) % s : 0;
            for (let v = off; v <= p.height; v += s) {
                ctx.moveTo(0, tv(v));
                ctx.lineTo(p.width, tv(v));
            }
        }
        else if (layoutPage && app.source.peek().kind === 'text') {
            ctx.setLineDash([1, 2]);
            for (const b of layoutPage.baselines) {
                ctx.moveTo(tu(p.marginLeft * 0), tv(b));
                ctx.lineTo(tu(p.width), tv(b));
            }
        }
        ctx.stroke();
        ctx.setLineDash([]);
        // поля
        ctx.strokeStyle = colors.margin;
        ctx.lineWidth = Math.max(0.2, px * 1.2);
        ctx.beginPath();
        const mL = mirrored ? p.marginRight : p.marginLeft;
        const mR = mirrored ? p.marginLeft : p.marginRight;
        if (p.template !== 'a4') {
            const mu = mirrored ? mL : p.width - mR;
            ctx.moveTo(tu(mu), 0);
            ctx.lineTo(tu(mu), p.height);
        }
        else {
            ctx.setLineDash([2, 2]);
            ctx.rect(Math.min(tu(mL), tu(p.width - mR)), Math.min(tv(p.marginTop), tv(p.height - p.marginBottom)), p.width - mL - mR, p.height - p.marginTop - p.marginBottom);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        // откалиброванная область
        if (f.ready) {
            ctx.strokeStyle = colors.frame;
            ctx.lineWidth = Math.max(0.25, px * 1.5);
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(0, 0, f.width, f.height);
            ctx.setLineDash([]);
        }
        // штрихи
        const plan = shownPlan();
        const job = app.job;
        const jobActive = job.status.peek() !== 'idle' && job.plan === plan;
        const cur = jobActive ? job.currentStroke.peek() : -1;
        const bad = new Set(plan?.outOfBounds ?? []);
        const lw = Math.max(0.3, px * 1.2);
        if (plan) {
            if (app.prefs.peek().showTravel && plan.strokes.length > 1) {
                ctx.strokeStyle = colors.travel;
                ctx.lineWidth = Math.max(0.1, px * 0.8);
                ctx.setLineDash([1.2, 1.2]);
                ctx.beginPath();
                for (let i = 1; i < plan.strokes.length; i++) {
                    const a = plan.strokes[i - 1];
                    const b = plan.strokes[i];
                    ctx.moveTo(a[a.length - 2], a[a.length - 1]);
                    ctx.lineTo(b[0], b[1]);
                }
                ctx.stroke();
                ctx.setLineDash([]);
            }
            const groups = [
                [jobActive ? colors.pending : colors.ink, (i) => !bad.has(i) && (!jobActive || i > cur)],
                [colors.done, (i) => !bad.has(i) && jobActive && i < cur],
                [colors.current, (i) => !bad.has(i) && jobActive && i === cur],
                [colors.bad, (i) => bad.has(i)],
            ];
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const [color, test] of groups) {
                ctx.strokeStyle = color;
                ctx.lineWidth = color === colors.current ? lw * 2 : color === colors.bad ? lw * 1.6 : lw;
                ctx.beginPath();
                plan.strokes.forEach((s, i) => {
                    if (!test(i))
                        return;
                    ctx.moveTo(s[0], s[1]);
                    for (let j = 2; j < s.length; j += 2)
                        ctx.lineTo(s[j], s[j + 1]);
                });
                ctx.stroke();
            }
        }
        // след симулятора
        if (simInk.segs.length && app.machine.conn.peek() === 'connected') {
            ctx.strokeStyle = colors.sim;
            ctx.lineWidth = Math.max(0.35, px * 1.6);
            ctx.beginPath();
            const s = simInk.segs;
            for (let i = 0; i < s.length; i += 4) {
                ctx.moveTo(s[i], s[i + 1]);
                ctx.lineTo(s[i + 2], s[i + 3]);
            }
            ctx.stroke();
        }
        // место продолжения / выбранная точка
        const rp = job.resumePoint.peek();
        const mark = (si, color) => {
            const s = plan?.strokes[si];
            if (!s)
                return;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(s[0], s[1], Math.max(1, px * 5), 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = lw * 2.4;
            ctx.moveTo(s[0], s[1]);
            for (let j = 2; j < s.length; j += 2)
                ctx.lineTo(s[j], s[j + 1]);
            ctx.stroke();
        };
        if (rp && job.plan === plan && job.pageIdx.peek() === rp.page)
            mark(rp.stroke, colors.current);
        const pk = picked.peek();
        if (pk !== null)
            mark(pk, colors.current);
        // перо
        if (app.machine.conn.peek() === 'connected' && app.calib.peek().zeroSet) {
            const wp = app.machine.wpos.peek();
            const [u, v] = workToPaper(f, wp[0], wp[1]);
            const down = app.isPenDown(wp[2]);
            const r = Math.max(1.2, px * 7);
            ctx.lineWidth = Math.max(0.3, px * 2);
            ctx.strokeStyle = colors.pen;
            ctx.beginPath();
            ctx.arc(u, v, r, 0, Math.PI * 2);
            ctx.moveTo(u - r * 1.8, v);
            ctx.lineTo(u - r * 0.5, v);
            ctx.moveTo(u + r * 0.5, v);
            ctx.lineTo(u + r * 1.8, v);
            ctx.moveTo(u, v - r * 1.8);
            ctx.lineTo(u, v - r * 0.5);
            ctx.moveTo(u, v + r * 0.5);
            ctx.lineTo(u, v + r * 1.8);
            ctx.stroke();
            if (down) {
                ctx.fillStyle = colors.pen;
                ctx.beginPath();
                ctx.arc(u, v, r * 0.45, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    };
    const schedule = () => {
        if (!raf)
            raf = requestAnimationFrame(draw);
    };
    // перерисовка при изменениях
    effect(() => {
        shownPlan();
        app.job.currentStroke.value;
        app.job.resumePoint.value;
        app.machine.wpos.value;
        app.machine.conn.value;
        simInk.version.value;
        app.paper.value;
        app.calib.value;
        app.prefs.value;
        app.layout.value;
        app.currentPage.value;
        picked.value;
        view.value;
        size.value;
        schedule();
    });
    // при смене формата листа — вписать заново
    effect(() => {
        const p = app.paper.value;
        const f = app.frame.value;
        void p.width;
        void p.height;
        void f.width;
        void f.height;
        void f.ready;
        if (fitted)
            fit();
    });
    const onWheel = (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const v = view.peek();
        const k = Math.exp(-e.deltaY * 0.0015);
        const scale = Math.max(0.3, Math.min(80, v.scale * k));
        const kk = scale / v.scale;
        view.value = { scale, ox: mx - (mx - v.ox) * kk, oy: my - (my - v.oy) * kk };
    };
    let drag = null;
    const onDown = (e) => {
        canvas.setPointerCapture(e.pointerId);
        const v = view.peek();
        drag = { x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy, moved: false };
    };
    const onMove = (e) => {
        if (!drag)
            return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3)
            drag.moved = true;
        if (drag.moved)
            view.value = { ...view.peek(), ox: drag.ox + dx, oy: drag.oy + dy };
    };
    const onUp = (e) => {
        const d = drag;
        drag = null;
        if (!d || d.moved || !pickMode.peek())
            return;
        const r = canvas.getBoundingClientRect();
        const v = view.peek();
        const u = (e.clientX - r.left - v.ox) / v.scale;
        const vv = (e.clientY - r.top - v.oy) / v.scale;
        const plan = shownPlan();
        if (!plan)
            return;
        let best = -1;
        let bd = Infinity;
        plan.strokes.forEach((s, i) => {
            const dd = polyDist2(s, u, vv);
            if (dd < bd) {
                bd = dd;
                best = i;
            }
        });
        if (best >= 0 && bd < 25)
            picked.value = best;
    };
    const mountCanvas = (el) => {
        canvas = el;
        readColors();
        const ro = new ResizeObserver(() => {
            const r = wrap.getBoundingClientRect();
            size.value = { w: Math.max(100, r.width), h: Math.max(100, r.height) };
            if (!fitted) {
                fit();
                fitted = true;
            }
        });
        queueMicrotask(() => ro.observe(wrap));
        const mq = matchMedia('(prefers-color-scheme: dark)');
        const onScheme = () => { readColors(); schedule(); };
        mq.addEventListener('change', onScheme);
        el.addEventListener('wheel', onWheel, { passive: false });
        onCleanup(() => { ro.disconnect(); mq.removeEventListener('change', onScheme); });
    };
    const pages = () => app.pageCount.value;
    const plan = () => shownPlan();
    return (h("div", { class: "preview", ref: (el) => (wrap = el) },
        h("canvas", { ref: mountCanvas, class: () => (pickMode.value ? 'picking' : ''), onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onDblClick: () => fit() }),
        h("div", { class: "preview-top" },
            h("div", { class: "pager" },
                h("button", { class: "icon-btn", title: "\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0430\u044F \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430", disabled: () => app.currentPage.value <= 0 || app.job.active, onClick: () => (app.currentPage.value = Math.max(0, app.currentPage.peek() - 1)) },
                    h(Icon, { name: "left", size: 16 })),
                h("span", { class: "pager-label" }, () => (pages() ? `Страница ${Math.min(app.currentPage.value + 1, pages())} из ${pages()}` : 'Пусто')),
                h("button", { class: "icon-btn", title: "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0430\u044F \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430", disabled: () => app.currentPage.value >= pages() - 1 || app.job.active, onClick: () => (app.currentPage.value = Math.min(pages() - 1, app.currentPage.peek() + 1)) },
                    h(Icon, { name: "right", size: 16 }))),
            h("div", { class: "preview-tools" },
                h("button", { class: () => 'chip' + (app.prefs.value.showTravel ? ' on' : ''), title: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0445\u043E\u043B\u043E\u0441\u0442\u044B\u0435 \u0445\u043E\u0434\u044B (\u0440\u0443\u0447\u043A\u0430 \u043F\u043E\u0434\u043D\u044F\u0442\u0430)", onClick: () => app.prefs.patch({ showTravel: !app.prefs.peek().showTravel }) }, "\u0425\u043E\u043B\u043E\u0441\u0442\u043E\u0439 \u0445\u043E\u0434"),
                h("button", { class: () => 'chip' + (pickMode.value ? ' on' : ''), title: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u043C\u0435\u0441\u0442\u043E \u043D\u0430 \u043B\u0438\u0441\u0442\u0435 \u0438 \u0434\u043E\u043F\u0435\u0447\u0430\u0442\u0430\u0442\u044C \u0441 \u043D\u0435\u0433\u043E (\u0435\u0441\u043B\u0438 \u0440\u0443\u0447\u043A\u0430 \u0441\u0431\u0438\u043B\u0430\u0441\u044C \u0438\u043B\u0438 \u043A\u043E\u043D\u0447\u0438\u043B\u0430\u0441\u044C)", onClick: () => {
                        pickMode.value = !pickMode.peek();
                        if (!pickMode.peek())
                            picked.value = null;
                    } }, "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C \u0441\u2026"),
                h("button", { class: "icon-btn", title: "\u0412\u043F\u0438\u0441\u0430\u0442\u044C \u043B\u0438\u0441\u0442 (\u0434\u0432\u043E\u0439\u043D\u043E\u0439 \u0449\u0435\u043B\u0447\u043E\u043A)", onClick: () => fit() },
                    h(Icon, { name: "zoom", size: 16 })))),
        () => pickMode.value ? (h("div", { class: "pick-bar" }, () => picked.value === null ? (h("span", null, "\u0429\u0451\u043B\u043A\u043D\u0438\u0442\u0435 \u043F\u043E \u0431\u0443\u043A\u0432\u0435 \u043D\u0430 \u043B\u0438\u0441\u0442\u0435, \u0441 \u043A\u043E\u0442\u043E\u0440\u043E\u0439 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C \u043F\u0435\u0447\u0430\u0442\u044C.")) : (h("span", { class: "row" },
            h("span", null,
                "\u0412\u044B\u0431\u0440\u0430\u043D \u0448\u0442\u0440\u0438\u0445 ",
                picked.value + 1,
                " (\u0441\u0442\u0440\u043E\u043A\u0430 ",
                plan()?.strokeLine[picked.value] ?? '—',
                ")."),
            h(Btn, { kind: "primary", small: true, disabled: () => app.job.active, onClick: () => {
                    const k = picked.peek();
                    pickMode.value = false;
                    picked.value = null;
                    if (k !== null)
                        printFromStroke(k);
                } }, "\u041F\u0435\u0447\u0430\u0442\u0430\u0442\u044C \u043E\u0442\u0441\u044E\u0434\u0430"))))) : null,
        h("div", { class: "preview-legend" }, () => {
            const pl = plan();
            if (!pl)
                return h("span", null, "\u041D\u0435\u0442 \u0437\u0430\u0434\u0430\u043D\u0438\u044F");
            return (h("span", { class: "legend-items" },
                h("span", { title: "\u0428\u0442\u0440\u0438\u0445\u043E\u0432 (\u043F\u043E\u0434\u044A\u0451\u043C\u043E\u0432 \u0440\u0443\u0447\u043A\u0438)" },
                    "\u2195 ",
                    pl.penLifts),
                h("span", { title: "\u0414\u043B\u0438\u043D\u0430 \u043B\u0438\u043D\u0438\u0439" },
                    "\u270E ",
                    (pl.drawLength / 1000).toFixed(2),
                    " \u043C"),
                h("span", { title: "\u041E\u0446\u0435\u043D\u043A\u0430 \u0432\u0440\u0435\u043C\u0435\u043D\u0438 \u044D\u0442\u043E\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B" },
                    "\u23F1 ",
                    fmtTime(pl.estSeconds)),
                pl.outOfBounds.length ? h("span", { class: "legend-bad" },
                    "\u0437\u0430 \u043A\u0440\u0430\u0435\u043C: ",
                    pl.outOfBounds.length) : null));
        })));
}
