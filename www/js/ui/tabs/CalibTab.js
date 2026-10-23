import { h } from "../dom.js";
import { signal } from "../reactive.js";
import { app } from "../../app/state.js";
import { calibPenTouch, calibPenUp, calibZero, calibCorner, calibSkew, calibSkewReset, calibGridOrigin, calibResetAll, traceSheet, printPattern, writeSetting, backupSettings, penUp, penDown, } from "../../app/actions.js";
import { Btn, Field, Icon, NumInput, Note, Section } from "../components.js";
import { Jog } from "../Jog.js";
function Step(props) {
    return (h("div", { class: () => 'step' + (props.done() ? ' done' : '') },
        h("div", { class: "step-num" }, () => (props.done() ? h(Icon, { name: "check", size: 16 }) : String(props.n))),
        h("div", { class: "step-body" },
            h("b", null, props.title),
            props.children)));
}
const measuredX = signal(100);
const measuredY = signal(100);
export function CalibTab() {
    const c = app.calib;
    const conn = () => app.machine.conn.value === 'connected';
    return (h("div", { class: "tab" },
        () => (!conn() ? h(Note, { kind: "warn" }, "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u043F\u043B\u043E\u0442\u0442\u0435\u0440 (\u0438\u043B\u0438 \u0441\u0438\u043C\u0443\u043B\u044F\u0442\u043E\u0440), \u0447\u0442\u043E\u0431\u044B \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u0430\u0442\u044C.") : null),
        () => c.value.stale ? (h(Note, { kind: "warn" }, "\u041F\u043B\u0430\u0442\u0430 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0436\u0430\u043B\u0430\u0441\u044C \u0438\u043B\u0438 \u043A\u0430\u0440\u0435\u0442\u043A\u0443 \u0441\u0434\u0432\u0438\u0433\u0430\u043B\u0438 \u2014 \u043D\u043E\u043B\u044C \u043C\u043E\u0433 \u0441\u0431\u0438\u0442\u044C\u0441\u044F. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u0448\u0430\u0433\u0438 2 \u0438 3 (\u0448\u0430\u0433 1 \u0442\u043E\u0436\u0435, \u0435\u0441\u043B\u0438 \u0440\u0443\u0447\u043A\u0443 \u0442\u0440\u043E\u0433\u0430\u043B\u0438).")) : null,
        h(Section, { title: "\u041C\u0430\u0441\u0442\u0435\u0440 \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0438 \u2014 \u043E\u043A\u043E\u043B\u043E \u043C\u0438\u043D\u0443\u0442\u044B" },
            h("div", { class: "muted small" }, "\u0423 \u043F\u043B\u043E\u0442\u0442\u0435\u0440\u0430 \u043D\u0435\u0442 \u043A\u043E\u043D\u0446\u0435\u0432\u0438\u043A\u043E\u0432, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u043F\u043E\u0441\u043B\u0435 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F \u043E\u043D \u043D\u0435 \u0437\u043D\u0430\u0435\u0442, \u0433\u0434\u0435 \u043A\u0430\u0440\u0435\u0442\u043A\u0430. \u041F\u043E\u043A\u0430\u0436\u0438\u0442\u0435 \u0435\u043C\u0443 \u0440\u0443\u0447\u043A\u0443 \u0438 \u043B\u0438\u0441\u0442 \u2014 \u0438 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0430 \u043D\u0435 \u0434\u0430\u0441\u0442 \u043A\u0430\u0440\u0435\u0442\u043A\u0435 \u0432\u044B\u0439\u0442\u0438 \u0437\u0430 \u043A\u0440\u0430\u0439."),
            h(Step, { n: 1, title: "\u0420\u0443\u0447\u043A\u0430: \u0433\u0434\u0435 \u043A\u0430\u0441\u0430\u0435\u0442\u0441\u044F \u0438 \u0433\u0434\u0435 \u043F\u043E\u0434\u043D\u044F\u0442\u0430", done: () => c.value.penSet },
                h("div", { class: "muted small" }, "\u041A\u043D\u043E\u043F\u043A\u0430\u043C\u0438 Z+/Z\u2212 \u043E\u043F\u0443\u0441\u0442\u0438\u0442\u0435 \u0440\u0443\u0447\u043A\u0443 \u0434\u043E \u043A\u0430\u0441\u0430\u043D\u0438\u044F \u0431\u0443\u043C\u0430\u0433\u0438 \u2192 \u00AB\u041A\u0430\u0441\u0430\u0435\u0442\u0441\u044F\u00BB. \u041F\u043E\u0442\u043E\u043C \u043F\u043E\u0434\u043D\u0438\u043C\u0438\u0442\u0435 \u043D\u0430 1\u20133 \u043C\u043C \u2192 \u00AB\u041F\u043E\u0434\u043D\u044F\u0442\u0430\u00BB."),
                h("div", { class: "row wrap" },
                    h(Btn, { small: true, kind: "primary", disabled: () => !conn(), onClick: () => calibPenTouch() }, "\u0420\u0443\u0447\u043A\u0430 \u043A\u0430\u0441\u0430\u0435\u0442\u0441\u044F"),
                    h(Btn, { small: true, kind: "primary", disabled: () => !conn(), onClick: () => calibPenUp() }, "\u0420\u0443\u0447\u043A\u0430 \u043F\u043E\u0434\u043D\u044F\u0442\u0430")),
                h(Field, { label: "\u041D\u0430\u0436\u0438\u043C \u043F\u043E\u0441\u043B\u0435 \u043A\u0430\u0441\u0430\u043D\u0438\u044F", hint: "0,3\u20130,5 \u043C\u043C \u043E\u0431\u044B\u0447\u043D\u043E \u0445\u0432\u0430\u0442\u0430\u0435\u0442" },
                    h(NumInput, { value: () => app.pen.value.pressure, onChange: (v) => app.pen.patch({ pressure: v }), min: 0, max: 3, step: 0.05, unit: "\u043C\u043C" })),
                () => c.value.penSet ? (h("div", { class: "row" },
                    h(Btn, { small: true, onClick: () => penDown() }, "\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C: \u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C"),
                    h(Btn, { small: true, onClick: () => penUp() }, "\u043F\u043E\u0434\u043D\u044F\u0442\u044C"))) : null),
            h(Step, { n: 2, title: "\u041D\u043E\u043B\u044C \u2014 \u043B\u0435\u0432\u044B\u0439 \u0432\u0435\u0440\u0445\u043D\u0438\u0439 \u0443\u0433\u043E\u043B \u043B\u0438\u0441\u0442\u0430", done: () => c.value.zeroSet && !c.value.stale },
                h("div", { class: "muted small" }, "\u0421\u0442\u0440\u0435\u043B\u043A\u0430\u043C\u0438 \u043F\u043E\u0434\u0432\u0435\u0434\u0438\u0442\u0435 \u0440\u0443\u0447\u043A\u0443 \u043A \u043B\u0435\u0432\u043E\u043C\u0443 \u0432\u0435\u0440\u0445\u043D\u0435\u043C\u0443 \u0443\u0433\u043B\u0443 \u043E\u0431\u043B\u0430\u0441\u0442\u0438 \u043F\u0438\u0441\u044C\u043C\u0430 \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \u00AB\u0417\u0434\u0435\u0441\u044C \u043D\u043E\u043B\u044C\u00BB."),
                h(Btn, { small: true, kind: "primary", disabled: () => !conn(), onClick: () => calibZero() }, "\u0417\u0434\u0435\u0441\u044C \u043D\u043E\u043B\u044C")),
            h(Step, { n: 3, title: "\u041A\u0440\u0430\u0439 \u2014 \u043F\u0440\u043E\u0442\u0438\u0432\u043E\u043F\u043E\u043B\u043E\u0436\u043D\u044B\u0439 \u0443\u0433\u043E\u043B", done: () => c.value.cornerSet && !c.value.stale },
                h("div", { class: "muted small" }, "\u041E\u0442\u0432\u0435\u0434\u0438\u0442\u0435 \u043A\u0430\u0440\u0435\u0442\u043A\u0443 \u0432 \u043F\u0440\u0430\u0432\u044B\u0439 \u043D\u0438\u0436\u043D\u0438\u0439 \u0443\u0433\u043E\u043B \u043B\u0438\u0441\u0442\u0430 \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \u00AB\u0417\u0434\u0435\u0441\u044C \u043A\u0440\u0430\u0439\u00BB. \u041D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043E\u0441\u0435\u0439 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0430 \u043F\u043E\u0439\u043C\u0451\u0442 \u0441\u0430\u043C\u0430."),
                h(Btn, { small: true, kind: "primary", disabled: () => !conn() || !c.value.zeroSet, onClick: () => calibCorner() }, "\u0417\u0434\u0435\u0441\u044C \u043A\u0440\u0430\u0439"),
                () => {
                    const f = app.frame.value;
                    return f.ready ? h("div", { class: "ok-text small" },
                        "\u041B\u0438\u0441\u0442 ",
                        f.width.toFixed(1),
                        " \u00D7 ",
                        f.height.toFixed(1),
                        " \u043C\u043C",
                        f.theta ? `, перекос ${((f.theta * 180) / Math.PI).toFixed(2)}°` : '') : null;
                }),
            h("div", { class: "card-inline" },
                h(Jog, { compact: true }))),
        h(Section, { title: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0438 \u0434\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F" },
            h("div", { class: "row wrap" },
                h(Btn, { small: true, disabled: () => !app.frame.value.ready, onClick: () => traceSheet() },
                    h(Icon, { name: "frame", size: 14 }),
                    " \u041E\u0431\u0432\u0435\u0441\u0442\u0438 \u043B\u0438\u0441\u0442")),
            h(Field, { label: "\u041F\u0435\u0440\u0435\u043A\u043E\u0441 \u043B\u0438\u0441\u0442\u0430", hint: "\u0442\u043E\u0447\u043A\u0430 \u0434\u0430\u043B\u044C\u0448\u0435 \u043F\u043E \u0432\u0435\u0440\u0445\u043D\u0435\u043C\u0443 \u043A\u0440\u0430\u044E \u2014 \u0442\u0435\u043A\u0441\u0442 \u043F\u043E\u0432\u0435\u0440\u043D\u0451\u0442\u0441\u044F \u043F\u043E\u0434 \u043B\u0438\u0441\u0442", wide: true },
                h("span", { class: "row" },
                    h(Btn, { small: true, disabled: () => !conn() || !c.value.zeroSet, onClick: () => calibSkew() }, "\u0422\u043E\u0447\u043A\u0430 \u043D\u0430 \u0432\u0435\u0440\u0445\u043D\u0435\u043C \u043A\u0440\u0430\u0435"),
                    () => (c.value.skewPoint ? h(Btn, { small: true, kind: "ghost", onClick: () => calibSkewReset() }, "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C") : null))),
            h(Field, { label: "\u041B\u0438\u043D\u0438\u044F \u0441\u0435\u0442\u043A\u0438 / \u043B\u0438\u043D\u0435\u0439\u043A\u0438", hint: "\u043F\u043E\u0434\u0432\u0435\u0434\u0438\u0442\u0435 \u0440\u0443\u0447\u043A\u0443 \u043A \u043B\u044E\u0431\u043E\u0439 \u043B\u0438\u043D\u0438\u0438 (\u0434\u043B\u044F \u043A\u043B\u0435\u0442\u043A\u0438 \u2014 \u043A \u0443\u0437\u043B\u0443) \u2014 \u0441\u0442\u0440\u043E\u043A\u0438 \u0432\u0441\u0442\u0430\u043D\u0443\u0442 \u043D\u0430 \u043B\u0438\u043D\u0438\u0438", wide: true },
                h("span", { class: "row" },
                    h(Btn, { small: true, disabled: () => !conn() || !app.frame.value.ready, onClick: () => calibGridOrigin() }, "\u0417\u0434\u0435\u0441\u044C \u043B\u0438\u043D\u0438\u044F"),
                    () => (c.value.gridOrigin ? h(Btn, { small: true, kind: "ghost", onClick: () => c.patch({ gridOrigin: null }) }, "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C") : null))),
            h(Btn, { small: true, kind: "ghost", onClick: () => calibResetAll() }, "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0443")),
        h(Section, { title: "\u0422\u0435\u0441\u0442\u043E\u0432\u044B\u0435 \u0443\u0437\u043E\u0440\u044B" },
            h("div", { class: "row wrap" },
                h(Btn, { small: true, onClick: () => printPattern('square') }, "\u041A\u0432\u0430\u0434\u0440\u0430\u0442 100 \u043C\u043C"),
                h(Btn, { small: true, onClick: () => printPattern('cross') }, "\u041A\u0440\u0435\u0441\u0442"),
                h(Btn, { small: true, onClick: () => printPattern('grid') }, "\u0421\u0435\u0442\u043A\u0430"),
                h(Btn, { small: true, onClick: () => printPattern('speed') }, "\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u0438"),
                h(Btn, { small: true, onClick: () => printPattern('paragraph') }, "\u041F\u0440\u043E\u0431\u043D\u044B\u0439 \u0430\u0431\u0437\u0430\u0446"))),
        h(Section, { title: "\u041C\u0430\u0441\u0448\u0442\u0430\u0431 (\u043E\u0434\u0438\u043D \u0440\u0430\u0437)" },
            h("div", { class: "muted small" }, "\u041D\u0430\u043F\u0435\u0447\u0430\u0442\u0430\u0439\u0442\u0435 \u043A\u0432\u0430\u0434\u0440\u0430\u0442 100 \u043C\u043C, \u0438\u0437\u043C\u0435\u0440\u044C\u0442\u0435 \u043B\u0438\u043D\u0435\u0439\u043A\u043E\u0439 \u0441\u0442\u043E\u0440\u043E\u043D\u044B \u0438 \u0432\u0432\u0435\u0434\u0438\u0442\u0435. \u041F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0430 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0438\u0442 \u043D\u043E\u0432\u044B\u0435 $100 \u0438 $101."),
            h("div", { class: "grid2" },
                h(Field, { label: "\u0418\u0437\u043C\u0435\u0440\u0435\u043D\u043E \u043F\u043E X" },
                    h(NumInput, { value: () => measuredX.value, onChange: (v) => (measuredX.value = v), min: 50, max: 150, step: 0.1, unit: "\u043C\u043C" })),
                h(Field, { label: "\u0418\u0437\u043C\u0435\u0440\u0435\u043D\u043E \u043F\u043E Y" },
                    h(NumInput, { value: () => measuredY.value, onChange: (v) => (measuredY.value = v), min: 50, max: 150, step: 0.1, unit: "\u043C\u043C" }))),
            () => {
                const m = app.machine;
                const sx = m.settingNum(100, 80);
                const sy = m.settingNum(101, 80);
                void m.settings.value;
                const nx = (sx * 100) / measuredX.value;
                const ny = (sy * 100) / measuredY.value;
                const same = Math.abs(measuredX.value - 100) < 0.05 && Math.abs(measuredY.value - 100) < 0.05;
                return same ? (h("div", { class: "muted small" },
                    "\u0421\u0435\u0439\u0447\u0430\u0441 $100 = ",
                    sx,
                    ", $101 = ",
                    sy,
                    ".")) : (h("div", { class: "row wrap" },
                    h("span", { class: "small" },
                        "\u041D\u043E\u0432\u044B\u0435: $100 = ",
                        h("b", null, nx.toFixed(3)),
                        ", $101 = ",
                        h("b", null, ny.toFixed(3))),
                    h(Btn, { small: true, kind: "primary", disabled: () => !conn(), onClick: async () => { await writeSetting(100, nx.toFixed(3)); await writeSetting(101, ny.toFixed(3)); } }, "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0432 \u043F\u043B\u0430\u0442\u0443")));
            },
            h(Btn, { small: true, kind: "ghost", disabled: () => !conn(), onClick: () => backupSettings() },
                h(Icon, { name: "download", size: 14 }),
                " \u041A\u043E\u043F\u0438\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A $$")),
        h(Section, { title: "\u041A\u043E\u043D\u0446\u0435\u0432\u0438\u043A\u0438" },
            h("div", { class: "muted small" },
                "\u0425\u043E\u043C\u0438\u043D\u0433 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D ($22=0), \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u043D\u043E\u043B\u044C \u0437\u0430\u0434\u0430\u0451\u0442\u0441\u044F \u0432\u0440\u0443\u0447\u043D\u0443\u044E. \u0412 \u0441\u0442\u0430\u0442\u0443\u0441\u0435 \u043F\u043B\u0430\u0442\u044B ",
                () => (app.machine.pins.value ? `видно Pn:${app.machine.pins.value}` : 'входы концевиков сейчас не активны'),
                "\u2014 \u0435\u0441\u043B\u0438 \u043D\u0430 \u043F\u043B\u0430\u0442\u0435 \u0435\u0441\u0442\u044C \u0440\u0430\u0437\u044A\u0451\u043C\u044B X/Y limit, \u043C\u043E\u0436\u043D\u043E \u043F\u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u043C\u0438\u043A\u0440\u043E\u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u0442\u0435\u043B\u0438 \u0438 \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u00AB\u0434\u043E\u043C\u043E\u0439\u00BB \u043E\u0434\u043D\u043E\u0439 \u043A\u043D\u043E\u043F\u043A\u043E\u0439 ($22=1)."))));
}
