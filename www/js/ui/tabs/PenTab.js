import { h } from "../dom.js";
import { app } from "../../app/state.js";
import { SPEED_PROFILES, feedOf } from "../../core/types.js";
import { Btn, Field, NumInput, Note, Section, Segmented, Toggle, bind } from "../components.js";
import { measurePenLift, printPattern, writeSetting } from "../../app/actions.js";
import { fmtTime } from "../../app/notify.js";
/** Куда уходит время текущей страницы: письмо / подъёмы ручки / переезды. */
function TimeBreakdown() {
    return (h("div", null, () => {
        const p = app.previewPlan.value;
        if (!p || !p.estSeconds)
            return h("div", { class: "muted small" }, "\u041D\u0435\u0442 \u0437\u0430\u0434\u0430\u043D\u0438\u044F.");
        const parts = [
            ['письмо', p.timeDraw ?? 0, 'var(--primary)'],
            ['подъёмы ручки', p.timePen ?? 0, 'var(--accent)'],
            ['переезды', p.timeTravel ?? 0, 'var(--travel)'],
        ];
        const sum = parts.reduce((a, x) => a + x[1], 0) || 1;
        return (h("div", { class: "tbreak" },
            h("div", { class: "tbreak-bar" }, parts.map(([, v, c]) => h("span", { style: `width:${((v / sum) * 100).toFixed(1)}%;background:${c}` }))),
            h("div", { class: "tbreak-legend" }, parts.map(([n, v, c]) => (h("span", null,
                h("i", { style: `background:${c}` }),
                n,
                " ",
                fmtTime(v),
                " (",
                Math.round((v / sum) * 100),
                "%)")))),
            h("div", { class: "muted small" },
                "\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u2248 ",
                fmtTime(p.estSeconds),
                ", \u043F\u043E\u0434\u044A\u0451\u043C\u043E\u0432 \u0440\u0443\u0447\u043A\u0438: ",
                p.penLifts,
                ".")));
    }));
}
export function PenTab() {
    const s = app.speed;
    const pen = app.pen;
    return (h("div", { class: "tab" },
        h(Section, { title: "\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u043F\u0438\u0441\u044C\u043C\u0430" },
            h("div", { class: "speed-cards" },
                ['turbo', 'draft', 'normal', 'neat'].map((k) => (h("button", { class: () => 'speed-card' + (s.value.profile === k ? ' on' : ''), onClick: () => s.patch({ profile: k }) },
                    h("b", null, SPEED_PROFILES[k].name),
                    h("span", null,
                        SPEED_PROFILES[k].feed,
                        " \u043C\u043C/\u043C\u0438\u043D"),
                    h("small", null, SPEED_PROFILES[k].hint)))),
                h("button", { class: () => 'speed-card' + (s.value.profile === 'custom' ? ' on' : ''), onClick: () => s.patch({ profile: 'custom' }) },
                    h("b", null, "\u0421\u0432\u043E\u044F"),
                    h("span", null,
                        () => s.value.customFeed,
                        " \u043C\u043C/\u043C\u0438\u043D"),
                    h("small", null, "\u043F\u043E\u0434\u043E\u0431\u0440\u0430\u0442\u044C \u0442\u0435\u0441\u0442\u043E\u043C"))),
            () => s.value.profile === 'custom' ? (h(Field, { label: "\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u043F\u0438\u0441\u044C\u043C\u0430" },
                h(NumInput, { value: bind(s, 'customFeed').get, onChange: bind(s, 'customFeed').set, min: 100, max: 12000, step: 100, unit: "\u043C\u043C/\u043C\u0438\u043D" }))) : null,
            () => {
                const lim = app.limits.value.rapid;
                return feedOf(s.value) > lim ? h(Note, { kind: "warn" },
                    "\u041F\u043B\u0430\u0442\u0430 \u0440\u0430\u0437\u0440\u0435\u0448\u0430\u0435\u0442 \u043D\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 ",
                    lim,
                    " \u043C\u043C/\u043C\u0438\u043D ($110/$111) \u2014 \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u0431\u0443\u0434\u0435\u0442 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0430.") : null;
            },
            h("div", { class: "muted small" }, "\u041F\u0440\u0435\u0434\u0435\u043B \u0437\u0430\u0434\u0430\u044E\u0442 \u043C\u0435\u0445\u0430\u043D\u0438\u043A\u0430 \u0438 \u0440\u0443\u0447\u043A\u0430: \u0433\u0435\u043B\u0435\u0432\u0430\u044F \u043F\u0438\u0448\u0435\u0442 \u043D\u0430 \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u0438, \u0448\u0430\u0440\u0438\u043A\u043E\u0432\u0430\u044F \u0442\u0435\u0440\u044F\u0435\u0442 \u043B\u0438\u043D\u0438\u044E. \u041D\u0430\u043F\u0435\u0447\u0430\u0442\u0430\u0439\u0442\u0435 \u043F\u043E\u043B\u043E\u0441\u0443 \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u0435\u0439 \u0438 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435, \u0433\u0434\u0435 \u043A\u0430\u0447\u0435\u0441\u0442\u0432\u043E \u0435\u0449\u0451 \u0443\u0441\u0442\u0440\u0430\u0438\u0432\u0430\u0435\u0442."),
            h(Btn, { small: true, onClick: () => printPattern('speed') }, "\u041D\u0430\u043F\u0435\u0447\u0430\u0442\u0430\u0442\u044C \u043F\u043E\u043B\u043E\u0441\u0443 \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u0435\u0439")),
        h(Section, { title: "\u0411\u044B\u0441\u0442\u0440\u0435\u0435" },
            h(TimeBreakdown, null),
            h(Field, { label: "\u041D\u0438\u0437\u043A\u0438\u0439 \u043F\u043E\u0434\u044A\u0451\u043C \u043C\u0435\u0436\u0434\u0443 \u0431\u0443\u043A\u0432\u0430\u043C\u0438", hint: "\u0432\u043D\u0443\u0442\u0440\u0438 \u0441\u0442\u0440\u043E\u043A\u0438 \u043D\u0430 \u043A\u043E\u0440\u043E\u0442\u043A\u0438\u0439 \u043F\u0435\u0440\u0435\u0435\u0437\u0434 \u0440\u0443\u0447\u043A\u0430 \u043F\u043E\u0434\u043D\u0438\u043C\u0430\u0435\u0442\u0441\u044F \u043D\u0435\u0432\u044B\u0441\u043E\u043A\u043E \u2014 \u044D\u0442\u043E \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u0432\u044B\u0438\u0433\u0440\u044B\u0448 \u043F\u043E \u0432\u0440\u0435\u043C\u0435\u043D\u0438; 0 \u2014 \u0432\u044B\u043A\u043B." },
                h(NumInput, { value: bind(pen, 'hopLift').get, onChange: (v) => pen.patch({ hopLift: v === 0 ? 0 : Math.max(0.3, v) }), min: 0, max: 5, step: 0.1, unit: "\u043C\u043C" })),
            h(Field, { label: "\u041A\u043E\u0440\u043E\u0442\u043A\u0438\u0439 \u043F\u0435\u0440\u0435\u0435\u0437\u0434 \u2014 \u0434\u043E" },
                h(NumInput, { value: bind(pen, 'hopDistance').get, onChange: bind(pen, 'hopDistance').set, min: 0, max: 50, step: 1, unit: "\u043C\u043C" })),
            h(Toggle, { value: bind(pen, 'zDownRapid').get, onChange: bind(pen, 'zDownRapid').set, label: "\u041E\u043F\u0443\u0441\u043A\u0430\u0442\u044C \u0440\u0443\u0447\u043A\u0443 \u043D\u0430 \u043F\u043E\u043B\u043D\u043E\u0439 \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u0438 (G0)", hint: "\u0411\u044B\u0441\u0442\u0440\u0435\u0435, \u043D\u043E \u0440\u0443\u0447\u043A\u0430 \u0441\u0438\u043B\u044C\u043D\u0435\u0435 \u0441\u0442\u0443\u043A\u0430\u0435\u0442; \u043D\u0430 \u043F\u0440\u0443\u0436\u0438\u043D\u0435 \u043E\u0431\u044B\u0447\u043D\u043E \u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u043E" }),
            () => {
                const m = app.machine;
                const j = m.settings.value.get(11);
                const jv = j === undefined ? NaN : parseFloat(j);
                return Number.isFinite(jv) && jv < 0.04 ? (h(Note, { kind: "info" },
                    "\u041F\u043E\u0432\u043E\u0440\u043E\u0442\u044B: \u0443 \u043F\u043B\u0430\u0442\u044B $11 = ",
                    jv,
                    " \u043C\u043C \u2014 \u043D\u0430 \u043A\u0430\u0436\u0434\u043E\u043C \u0438\u0437\u0433\u0438\u0431\u0435 \u0431\u0443\u043A\u0432\u044B \u043E\u043D\u0430 \u043F\u043E\u0447\u0442\u0438 \u043E\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u0435\u0442\u0441\u044F. \u0417\u043D\u0430\u0447\u0435\u043D\u0438\u0435 0,05 \u0437\u0430\u043C\u0435\u0442\u043D\u043E \u0443\u0441\u043A\u043E\u0440\u044F\u0435\u0442 \u043F\u0438\u0441\u044C\u043C\u043E \u0431\u0435\u0437 \u043F\u043E\u0442\u0435\u0440\u0438 \u0442\u043E\u0447\u043D\u043E\u0441\u0442\u0438 \u0434\u043B\u044F \u0440\u0443\u0447\u043A\u0438.",
                    ' ',
                    h(Btn, { small: true, kind: "primary", onClick: () => writeSetting(11, '0.050') }, "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C $11=0.05"))) : null;
            },
            h("div", { class: "muted small" }, "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430: \u00AB\u041D\u0430\u043F\u0435\u0447\u0430\u0442\u0430\u0442\u044C \u043F\u043E\u043B\u043E\u0441\u0443 \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u0435\u0439\u00BB \u0432\u044B\u0448\u0435 \u0438 \u00AB\u041F\u0440\u043E\u0431\u043D\u044B\u0439 \u0430\u0431\u0437\u0430\u0446\u00BB \u043D\u0430 \u0432\u043A\u043B\u0430\u0434\u043A\u0435 \u00AB\u041A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0430\u00BB. \u0415\u0441\u043B\u0438 \u0431\u0443\u043A\u0432\u044B \u0440\u0432\u0443\u0442\u0441\u044F \u0438\u043B\u0438 \u0440\u0443\u0447\u043A\u0430 \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u0442 \u043B\u0438\u043D\u0438\u044E \u2014 \u0441\u0431\u0430\u0432\u044C\u0442\u0435 \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u0438\u043B\u0438 \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u043E\u0431\u044B\u0447\u043D\u043E\u0435 \u043E\u043F\u0443\u0441\u043A\u0430\u043D\u0438\u0435.")),
        h(Section, { title: "\u0420\u0443\u0447\u043A\u0430 (\u043E\u0441\u044C Z)" },
            h(Field, { label: "\u041D\u0430\u0436\u0438\u043C", hint: "\u043D\u0430 \u0441\u043A\u043E\u043B\u044C\u043A\u043E \u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043D\u0438\u0436\u0435 \u043A\u0430\u0441\u0430\u043D\u0438\u044F; \u043F\u0440\u0443\u0436\u0438\u043D\u0430 \u0434\u0435\u0440\u0436\u0438\u0442 \u0440\u0443\u0447\u043A\u0443" },
                h(NumInput, { value: bind(pen, 'pressure').get, onChange: bind(pen, 'pressure').set, min: 0, max: 3, step: 0.05, unit: "\u043C\u043C" })),
            h(Field, { label: "\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u043E\u043F\u0443\u0441\u043A\u0430\u043D\u0438\u044F", hint: "\u043C\u044F\u0433\u0447\u0435 \u2014 \u043C\u0435\u043D\u044C\u0448\u0435 \u043A\u043B\u044F\u043A\u0441 \u0438 \u0441\u0442\u0443\u043A\u0430" },
                h(NumInput, { value: bind(pen, 'zDownFeed').get, onChange: bind(pen, 'zDownFeed').set, min: 50, max: 5000, step: 50, unit: "\u043C\u043C/\u043C\u0438\u043D" })),
            h(Field, { label: "\u041F\u0430\u0443\u0437\u0430 \u043F\u043E\u0441\u043B\u0435 \u043E\u043F\u0443\u0441\u043A\u0430\u043D\u0438\u044F", hint: "\u0447\u0442\u043E\u0431\u044B \u0447\u0435\u0440\u043D\u0438\u043B\u0430 \u0443\u0441\u043F\u0435\u043B\u0438 \u043F\u043E\u0439\u0442\u0438" },
                h(NumInput, { value: bind(pen, 'dwellMs').get, onChange: bind(pen, 'dwellMs').set, min: 0, max: 1000, step: 10, unit: "\u043C\u0441" })),
            h("div", { class: "row wrap" },
                h(Btn, { small: true, onClick: () => measurePenLift() }, "\u0417\u0430\u043C\u0435\u0440\u0438\u0442\u044C \u043F\u043E\u0434\u044A\u0451\u043C \u0440\u0443\u0447\u043A\u0438")),
            () => {
                const c = app.calib.value;
                return c.penSet ? (h("div", { class: "muted small" },
                    "\u0420\u0443\u0447\u043A\u0430 \u043F\u043E\u0434\u043D\u044F\u0442\u0430 \u043F\u0440\u0438 Z = ",
                    c.upZ,
                    ", \u043A\u0430\u0441\u0430\u043D\u0438\u0435 \u043F\u0440\u0438 Z = 0. \u041F\u0440\u0438 \u043F\u0438\u0441\u044C\u043C\u0435 Z = ",
                    (c.upZ >= 0 ? -1 : 1) * pen.value.pressure,
                    ".")) : (h(Note, { kind: "warn" }, "\u041F\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0440\u0443\u0447\u043A\u0438 \u0435\u0449\u0451 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u043E: \u0432\u043A\u043B\u0430\u0434\u043A\u0430 \u00AB\u041A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0430\u00BB, \u0448\u0430\u0433 1."));
            }),
        h(Section, { title: "\u041E\u043F\u0442\u0438\u043C\u0438\u0437\u0430\u0446\u0438\u044F" },
            h(Field, { label: "\u0425\u043E\u043B\u043E\u0441\u0442\u043E\u0439 \u0445\u043E\u0434", hint: "0 \u2014 \u043C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u043F\u043B\u0430\u0442\u044B (G0)" },
                h(NumInput, { value: bind(s, 'travelFeed').get, onChange: bind(s, 'travelFeed').set, min: 0, max: 12000, step: 500, unit: "\u043C\u043C/\u043C\u0438\u043D" })),
            h(Field, { label: "\u041D\u0435 \u043F\u043E\u0434\u043D\u0438\u043C\u0430\u0442\u044C \u0440\u0443\u0447\u043A\u0443, \u0435\u0441\u043B\u0438 \u0437\u0430\u0437\u043E\u0440 \u043C\u0435\u043D\u044C\u0448\u0435", hint: "\u0441\u043E\u0441\u0435\u0434\u043D\u0438\u0435 \u0448\u0442\u0440\u0438\u0445\u0438 \u043F\u0438\u0448\u0443\u0442\u0441\u044F \u043E\u0434\u043D\u0438\u043C \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0435\u043C" },
                h(NumInput, { value: bind(s, 'joinTolerance').get, onChange: bind(s, 'joinTolerance').set, min: 0, max: 1, step: 0.05, unit: "\u043C\u043C" })),
            h(Field, { label: "\u0423\u043F\u0440\u043E\u0449\u0435\u043D\u0438\u0435 \u043B\u0438\u043D\u0438\u0439", hint: "\u043C\u0435\u043D\u044C\u0448\u0435 \u043C\u0435\u043B\u043A\u0438\u0445 \u043E\u0442\u0440\u0435\u0437\u043A\u043E\u0432 \u2014 \u043F\u043B\u0430\u0442\u0430 \u043D\u0435 \u0442\u043E\u0440\u043C\u043E\u0437\u0438\u0442" },
                h(NumInput, { value: bind(s, 'simplify').get, onChange: bind(s, 'simplify').set, min: 0, max: 0.3, step: 0.01, unit: "\u043C\u043C" })),
            h(Field, { label: "\u041F\u043E\u0441\u043B\u0435 \u043F\u0435\u0447\u0430\u0442\u0438" },
                h(Segmented, { value: bind(s, 'park').get, onChange: bind(s, 'park').set, options: [{ value: 'zero', label: 'В угол (ноль)' }, { value: 'away', label: 'Вниз листа' }, { value: 'none', label: 'Остаться' }] })))));
}
