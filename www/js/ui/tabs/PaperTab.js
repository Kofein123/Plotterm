import { h } from "../dom.js";
import { app, PAPER_PRESETS } from "../../app/state.js";
import { Field, NumInput, Note, Section, Segmented, Toggle, bind } from "../components.js";
export function PaperTab() {
    const p = app.paper;
    const tpl = () => p.value.template;
    const choose = (k) => {
        if (k === 'custom')
            p.patch({ template: 'custom' });
        else
            p.patch(PAPER_PRESETS[k].p);
    };
    return (h("div", { class: "tab" },
        h(Section, { title: "\u0411\u0443\u043C\u0430\u0433\u0430" },
            h("div", { class: "paper-cards" }, ['a4', 'grid', 'ruled', 'custom'].map((k) => (h("button", { class: () => 'paper-card' + (tpl() === k ? ' on' : ''), onClick: () => choose(k) },
                h("span", { class: 'paper-thumb thumb-' + k }),
                h("b", null, k === 'custom' ? 'Свой шаблон' : PAPER_PRESETS[k].name),
                h("small", null, k === 'custom' ? 'любой размер и шаг' : PAPER_PRESETS[k].hint))))),
            h("div", { class: "grid2" },
                h(Field, { label: "\u0428\u0438\u0440\u0438\u043D\u0430" },
                    h(NumInput, { value: bind(p, 'width').get, onChange: bind(p, 'width').set, min: 20, max: 400, unit: "\u043C\u043C" })),
                h(Field, { label: "\u0412\u044B\u0441\u043E\u0442\u0430" },
                    h(NumInput, { value: bind(p, 'height').get, onChange: bind(p, 'height').set, min: 20, max: 400, unit: "\u043C\u043C" }))),
            () => {
                const f = app.frame.value;
                const pp = p.value;
                return f.ready && (pp.width > f.width + 2 || pp.height > f.height + 2) ? (h(Note, { kind: "warn" },
                    "\u041B\u0438\u0441\u0442 \u0431\u043E\u043B\u044C\u0448\u0435 \u043E\u0442\u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u0439 \u043E\u0431\u043B\u0430\u0441\u0442\u0438 (",
                    f.width.toFixed(0),
                    "\u00D7",
                    f.height.toFixed(0),
                    " \u043C\u043C) \u2014 \u0442\u0435\u043A\u0441\u0442 \u0443 \u043A\u0440\u0430\u044F \u043D\u0435 \u043D\u0430\u043F\u0435\u0447\u0430\u0442\u0430\u0435\u0442\u0441\u044F.")) : null;
            }),
        h(Section, { title: "\u0421\u0442\u0440\u043E\u043A\u0438" },
            () => tpl() === 'grid' ? (h("div", { class: "grid2" },
                h(Field, { label: "\u041A\u043B\u0435\u0442\u043A\u0430" },
                    h(NumInput, { value: bind(p, 'cell').get, onChange: bind(p, 'cell').set, min: 2, max: 15, step: 0.1, unit: "\u043C\u043C" })),
                h(Field, { label: "\u0421\u0442\u0440\u043E\u043A\u0430 \u0447\u0435\u0440\u0435\u0437", hint: "\u043A\u043B\u0435\u0442\u043E\u043A \u043C\u0435\u0436\u0434\u0443 \u0441\u0442\u0440\u043E\u043A\u0430\u043C\u0438" },
                    h(Segmented, { value: bind(p, 'gridLineCells').get, onChange: bind(p, 'gridLineCells').set, options: [1, 2, 3].map((n) => ({ value: n, label: String(n) })) })))) : tpl() === 'ruled' ? (h(Field, { label: "\u0428\u0430\u0433 \u043B\u0438\u043D\u0435\u0435\u043A" },
                h(NumInput, { value: bind(p, 'rulePitch').get, onChange: bind(p, 'rulePitch').set, min: 4, max: 20, step: 0.1, unit: "\u043C\u043C" }))) : (h(Field, { label: "\u041C\u0435\u0436\u0441\u0442\u0440\u043E\u0447\u043D\u044B\u0439 \u0448\u0430\u0433" },
                h(NumInput, { value: bind(p, 'blankLineStep').get, onChange: bind(p, 'blankLineStep').set, min: 3, max: 30, step: 0.5, unit: "\u043C\u043C" }))),
            () => tpl() === 'grid' || tpl() === 'ruled' ? (h("div", { class: "muted small" }, app.calib.value.gridOrigin
                ? '✓ Линии сетки привязаны (калибровка → «Линия сетки»): буквы встанут на линии.'
                : 'Чтобы буквы стояли точно на линиях, на вкладке «Калибровка» укажите одну линию сетки.')) : null),
        h(Section, { title: "\u041F\u043E\u043B\u044F" },
            h("div", { class: "grid2" },
                h(Field, { label: "\u0421\u0432\u0435\u0440\u0445\u0443" },
                    h(NumInput, { value: bind(p, 'marginTop').get, onChange: bind(p, 'marginTop').set, min: 0, max: 100, unit: "\u043C\u043C" })),
                h(Field, { label: "\u0421\u043D\u0438\u0437\u0443" },
                    h(NumInput, { value: bind(p, 'marginBottom').get, onChange: bind(p, 'marginBottom').set, min: 0, max: 100, unit: "\u043C\u043C" })),
                h(Field, { label: "\u0421\u043B\u0435\u0432\u0430" },
                    h(NumInput, { value: bind(p, 'marginLeft').get, onChange: bind(p, 'marginLeft').set, min: 0, max: 100, unit: "\u043C\u043C" })),
                h(Field, { label: "\u0421\u043F\u0440\u0430\u0432\u0430" },
                    h(NumInput, { value: bind(p, 'marginRight').get, onChange: bind(p, 'marginRight').set, min: 0, max: 100, unit: "\u043C\u043C" }))),
            h(Field, { label: "\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u0442\u0435\u0442\u0440\u0430\u0434\u0438", hint: "\u043D\u0430 \u043B\u0435\u0432\u043E\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u043F\u043E\u043B\u044F \u0437\u0435\u0440\u043A\u0430\u043B\u044F\u0442\u0441\u044F" },
                h(Segmented, { value: bind(p, 'side').get, onChange: bind(p, 'side').set, options: [{ value: 'right', label: 'Правая' }, { value: 'left', label: 'Левая' }, { value: 'alternate', label: 'Чередовать' }] })),
            h(Toggle, { value: bind(p, 'rotate180').get, onChange: bind(p, 'rotate180').set, label: "\u041F\u043E\u0432\u0435\u0440\u043D\u0443\u0442\u044C \u043D\u0430 180\u00B0 (\u043E\u0431\u043E\u0440\u043E\u0442 \u043B\u0438\u0441\u0442\u0430)", hint: "\u0414\u043B\u044F \u043E\u0431\u0440\u0430\u0442\u043D\u043E\u0439 \u0441\u0442\u043E\u0440\u043E\u043D\u044B: \u043B\u0438\u0441\u0442 \u043A\u043B\u0430\u0434\u0451\u0442\u0441\u044F \u0440\u0430\u0437\u0432\u0451\u0440\u043D\u0443\u0442\u044B\u043C, \u0442\u0435\u043A\u0441\u0442 \u043F\u0435\u0447\u0430\u0442\u0430\u0435\u0442\u0441\u044F \u0432\u0432\u0435\u0440\u0445 \u043D\u043E\u0433\u0430\u043C\u0438 \u043E\u0442\u043D\u043E\u0441\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u0441\u0442\u0430\u043D\u043A\u0430" })),
        h(Section, { title: "\u0414\u043E\u043F\u0438\u0441\u0430\u0442\u044C \u043D\u0430 \u043D\u0430\u0447\u0430\u0442\u043E\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435" },
            h(Field, { label: "\u041D\u0430\u0447\u0430\u0442\u044C \u0441 \u0441\u0442\u0440\u043E\u043A\u0438 \u2116", hint: "\u043F\u0435\u0440\u0432\u044B\u0435 \u0441\u0442\u0440\u043E\u043A\u0438 \u043F\u0435\u0440\u0432\u043E\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \u043E\u0441\u0442\u0430\u043D\u0443\u0442\u0441\u044F \u043F\u0443\u0441\u0442\u044B\u043C\u0438" },
                h(NumInput, { value: bind(p, 'startLine').get, onChange: (v) => p.patch({ startLine: Math.max(1, Math.round(v)) }), min: 1, max: 200, step: 1 })),
            () => {
                const pg = app.layout.value.pages[0];
                return pg ? h("div", { class: "muted small" },
                    "\u041D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 ",
                    pg.totalLines,
                    " \u0441\u0442\u0440\u043E\u043A.") : null;
            })));
}
