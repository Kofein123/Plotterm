// Ручное перемещение: XY стрелками, Z (ручка) вверх/вниз, шаг, положение.
import { h } from "./dom.js";
import { app } from "../app/state.js";
import { jogStep, jogZ, jogContinuousStart, jogContinuousStop, penUp, penDown, goZero, clampJog } from "../app/actions.js";
import { workToPaper } from "../core/calibration.js";
import { Icon, Segmented, Toggle } from "./components.js";
const STEPS = [0.1, 1, 10, 0];
function JogBtn(props) {
    let holdTimer = null;
    let continuous = false;
    const down = (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const step = app.prefs.peek().jogStep;
        if (step === 0) {
            continuous = true;
            jogContinuousStart(props.du, props.dv);
            return;
        }
        jogStep(props.du * step, props.dv * step);
        // удержание кнопки > 0,5 с — непрерывное движение
        holdTimer = setTimeout(() => {
            continuous = true;
            jogContinuousStart(props.du, props.dv);
        }, 500);
    };
    const up = () => {
        if (holdTimer)
            clearTimeout(holdTimer);
        holdTimer = null;
        if (continuous)
            jogContinuousStop();
        continuous = false;
    };
    return (h("button", { class: "jog-btn", title: props.title, onPointerDown: down, onPointerUp: up, onPointerCancel: up },
        h(Icon, { name: props.icon, size: 20 })));
}
export function Jog(props) {
    const m = app.machine;
    const paperPos = () => {
        const w = m.wpos.value;
        const f = app.frame.value;
        return workToPaper(f, w[0], w[1]);
    };
    return (h("div", { class: 'jog' + (props.compact ? ' jog-compact' : '') },
        h("div", { class: "jog-grid" },
            h("span", null),
            h(JogBtn, { du: 0, dv: -1, icon: "up", title: "\u0412\u0432\u0435\u0440\u0445 \u043F\u043E \u043B\u0438\u0441\u0442\u0443 (\u2191)" }),
            h("span", null),
            h(JogBtn, { du: -1, dv: 0, icon: "left", title: "\u0412\u043B\u0435\u0432\u043E (\u2190)" }),
            h("button", { class: "jog-btn jog-home", title: "\u041A \u043D\u0443\u043B\u044E (\u0443\u0433\u043E\u043B \u043B\u0438\u0441\u0442\u0430), \u0440\u0443\u0447\u043A\u0430 \u0432\u0432\u0435\u0440\u0445", onClick: () => goZero() },
                h(Icon, { name: "home", size: 18 })),
            h(JogBtn, { du: 1, dv: 0, icon: "right", title: "\u0412\u043F\u0440\u0430\u0432\u043E (\u2192)" }),
            h("span", null),
            h(JogBtn, { du: 0, dv: 1, icon: "down", title: "\u0412\u043D\u0438\u0437 \u043F\u043E \u043B\u0438\u0441\u0442\u0443 (\u2193)" }),
            h("span", null)),
        h("div", { class: "jog-z" },
            h("span", { class: "jog-z-label" }, "Z \u0440\u0443\u0447\u043A\u0438"),
            h("button", { class: "jog-btn", title: "Z+ \u043D\u0430 \u0448\u0430\u0433 (PageUp)", onClick: () => jogZ(app.prefs.peek().zStep) }, "Z+"),
            h("button", { class: "jog-btn", title: "Z\u2212 \u043D\u0430 \u0448\u0430\u0433 (PageDown)", onClick: () => jogZ(-app.prefs.peek().zStep) }, "Z\u2212"),
            h(Segmented, { small: true, value: () => app.prefs.value.zStep, onChange: (v) => app.prefs.patch({ zStep: v }), options: [{ value: 0.1, label: '0.1' }, { value: 0.5, label: '0.5' }, { value: 2, label: '2' }] })),
        h("div", { class: "jog-pen" },
            h("button", { class: "btn btn-small", disabled: () => !app.calib.value.penSet, onClick: () => penUp(), title: "\u041F\u043E\u0434\u043D\u044F\u0442\u044C \u0440\u0443\u0447\u043A\u0443 \u0432 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u043E\u0435 \u043F\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u0435" }, "\u0420\u0443\u0447\u043A\u0430 \u2191"),
            h("button", { class: "btn btn-small", disabled: () => !app.calib.value.penSet, onClick: () => penDown(), title: "\u041E\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0440\u0443\u0447\u043A\u0443 \u043D\u0430 \u0431\u0443\u043C\u0430\u0433\u0443 \u0441 \u043D\u0430\u0436\u0438\u043C\u043E\u043C" }, "\u0420\u0443\u0447\u043A\u0430 \u2193")),
        h("div", { class: "jog-step" },
            h("span", { class: "muted" }, "\u0428\u0430\u0433 XY"),
            h(Segmented, { small: true, value: () => app.prefs.value.jogStep, onChange: (v) => app.prefs.patch({ jogStep: v }), options: STEPS.map((s) => ({ value: s, label: s === 0 ? '∞' : String(s), title: s === 0 ? 'непрерывно, пока держите' : s + ' мм' })) })),
        h("div", { class: "pos" },
            h("div", { class: "pos-row" },
                h("span", null, "X"),
                h("b", null, () => m.wpos.value[0].toFixed(2)),
                h("span", null, "Y"),
                h("b", null, () => m.wpos.value[1].toFixed(2)),
                h("span", null, "Z"),
                h("b", null, () => m.wpos.value[2].toFixed(2))),
            () => app.frame.value.ready ? (h("div", { class: "pos-paper", title: "\u041F\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u043D\u0430 \u043B\u0438\u0441\u0442\u0435 \u043E\u0442 \u043B\u0435\u0432\u043E\u0433\u043E \u0432\u0435\u0440\u0445\u043D\u0435\u0433\u043E \u0443\u0433\u043B\u0430, \u043C\u043C" },
                "\u043D\u0430 \u043B\u0438\u0441\u0442\u0435 ",
                () => `${paperPos()[0].toFixed(1)} × ${paperPos()[1].toFixed(1)}`,
                " \u00B7",
                ' ',
                () => (app.isPenDown(m.wpos.value[2]) ? 'ручка внизу' : 'ручка вверху'))) : null),
        () => app.calib.value.cornerSet ? (h(Toggle, { value: () => clampJog.value, onChange: (v) => (clampJog.value = v), label: "\u041D\u0435 \u0432\u044B\u0435\u0437\u0436\u0430\u0442\u044C \u0437\u0430 \u043B\u0438\u0441\u0442", hint: "\u041F\u043E\u0441\u043B\u0435 \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0438 \u043A\u0430\u0440\u0435\u0442\u043A\u0430 \u043D\u0435 \u0443\u0439\u0434\u0451\u0442 \u0437\u0430 \u0433\u0440\u0430\u043D\u0438\u0446\u044B \u043B\u0438\u0441\u0442\u0430" })) : (h("div", { class: "muted small" }, "\u0414\u043E \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0438 \u0441\u0442\u0440\u0435\u043B\u043A\u0438 \u0434\u0432\u0438\u0433\u0430\u044E\u0442 \u043E\u0441\u0438 \u0441\u0442\u0430\u043D\u043A\u0430 \u043D\u0430\u043F\u0440\u044F\u043C\u0443\u044E \u2014 \u043E\u0441\u0442\u043E\u0440\u043E\u0436\u043D\u043E \u0443 \u043A\u0440\u0430\u0451\u0432."))));
}
