import { h } from "../dom.js";
import { app } from "../../app/state.js";
import { Field, NumInput, Section, Segmented, Select, Slider, Toggle, bind, Icon } from "../components.js";
export function FontTab() {
    const t = app.typo;
    const fontId = bind(t, 'fontId');
    return (h("div", { class: "tab" },
        h(Section, { title: "\u0428\u0440\u0438\u0444\u0442" },
            h(Field, { label: "\u041F\u043E\u0447\u0435\u0440\u043A", wide: true },
                h(Select, { value: fontId.get, onChange: fontId.set, options: () => app.fonts.value.map((f) => ({ value: f.id, label: f.name + (f.builtin ? '' : ' — мой почерк') })) })),
            h("div", { class: "muted small" }, "\u041F\u043B\u043E\u0442\u0442\u0435\u0440 \u0440\u0438\u0441\u0443\u0435\u0442 \u043B\u0438\u043D\u0438\u0435\u0439, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u043D\u0443\u0436\u043D\u044B \u043E\u0434\u043D\u043E\u043B\u0438\u043D\u0435\u0439\u043D\u044B\u0435 \u0448\u0440\u0438\u0444\u0442\u044B. \u0412\u0441\u0442\u0440\u043E\u0435\u043D\u044B \u0413\u041E\u0421\u0422 \u0410 \u0438 \u0411 (\u043A\u0438\u0440\u0438\u043B\u043B\u0438\u0446\u0430, \u043B\u0430\u0442\u0438\u043D\u0438\u0446\u0430, \u043A\u0430\u0437\u0430\u0445\u0441\u043A\u0438\u0435 \u0431\u0443\u043A\u0432\u044B). \u0421\u0432\u043E\u0439 \u043F\u043E\u0447\u0435\u0440\u043A \u2014 \u043D\u0430 \u0432\u043A\u043B\u0430\u0434\u043A\u0435 \u00AB\u041C\u043E\u0439 \u043F\u043E\u0447\u0435\u0440\u043A\u00BB."),
            h(Field, { label: "\u0412\u044B\u0441\u043E\u0442\u0430 \u0441\u0442\u0440\u043E\u0447\u043D\u043E\u0439 \u0431\u0443\u043A\u0432\u044B", hint: "2\u20136 \u043C\u043C; \u0432 \u0442\u0435\u0442\u0440\u0430\u0434\u0438 \u043E\u0431\u044B\u0447\u043D\u043E 2,5\u20133,5" },
                h(Slider, { min: 1.5, max: 7, step: 0.1, value: bind(t, 'xHeight').get, onInput: bind(t, 'xHeight').set, format: (v) => v.toFixed(1) + ' мм' })),
            h(Field, { label: "\u041D\u0430\u043A\u043B\u043E\u043D" },
                h(Slider, { min: -10, max: 30, step: 1, value: bind(t, 'slant').get, onInput: bind(t, 'slant').set, format: (v) => v + '°' })),
            h(Field, { label: "\u041C\u0435\u0436\u0434\u0443 \u0431\u0443\u043A\u0432\u0430\u043C\u0438" },
                h(Slider, { min: 0.3, max: 2.5, step: 0.05, value: bind(t, 'letterSpacing').get, onInput: bind(t, 'letterSpacing').set, format: (v) => '×' + v.toFixed(2) })),
            h(Field, { label: "\u041C\u0435\u0436\u0434\u0443 \u0441\u043B\u043E\u0432\u0430\u043C\u0438" },
                h(Slider, { min: 0.4, max: 3, step: 0.05, value: bind(t, 'wordSpacing').get, onInput: bind(t, 'wordSpacing').set, format: (v) => '×' + v.toFixed(2) }))),
        h(Section, { title: "\u0410\u0431\u0437\u0430\u0446\u044B" },
            h(Field, { label: "\u0412\u044B\u0440\u0430\u0432\u043D\u0438\u0432\u0430\u043D\u0438\u0435" },
                h(Segmented, { value: bind(t, 'align').get, onChange: bind(t, 'align').set, options: [{ value: 'left', label: 'По левому краю' }, { value: 'justify', label: 'По ширине' }] })),
            h(Field, { label: "\u041A\u0440\u0430\u0441\u043D\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430" },
                h(NumInput, { value: bind(t, 'indent').get, onChange: bind(t, 'indent').set, min: 0, max: 40, step: 1, unit: "\u043C\u043C" })),
            h(Toggle, { value: bind(t, 'hyphenate').get, onChange: bind(t, 'hyphenate').set, label: "\u041F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442\u044C \u0441\u043B\u043E\u0432\u0430 \u043F\u043E \u0441\u043B\u043E\u0433\u0430\u043C" })),
        h(Section, { title: "\u0416\u0438\u0432\u043E\u0441\u0442\u044C \u043F\u043E\u0447\u0435\u0440\u043A\u0430" },
            h(Field, { label: "\u0416\u0438\u0432\u043E\u0441\u0442\u044C", hint: "0 \u2014 \u0440\u043E\u0432\u043D\u043E \u043A\u0430\u043A \u043F\u043E \u043B\u0438\u043D\u0435\u0439\u043A\u0435, 10 \u2014 \u0437\u0430\u043C\u0435\u0442\u043D\u043E \u00AB\u043E\u0442 \u0440\u0443\u043A\u0438\u00BB" },
                h(Slider, { min: 0, max: 10, step: 1, value: bind(t, 'liveliness').get, onInput: bind(t, 'liveliness').set })),
            h(Field, { label: "\u0417\u0435\u0440\u043D\u043E", hint: "\u0442\u043E\u0442 \u0436\u0435 \u0442\u0435\u043A\u0441\u0442 \u0441 \u0442\u0435\u043C \u0436\u0435 \u0437\u0435\u0440\u043D\u043E\u043C \u0432\u044B\u0433\u043B\u044F\u0434\u0438\u0442 \u043E\u0434\u0438\u043D\u0430\u043A\u043E\u0432\u043E" },
                h("span", { class: "row" },
                    h(NumInput, { value: bind(t, 'seed').get, onChange: (v) => t.patch({ seed: Math.round(v) }), min: 0, step: 1, width: 90 }),
                    h("button", { class: "icon-btn", title: "\u0414\u0440\u0443\u0433\u043E\u0435 \u0437\u0435\u0440\u043D\u043E", onClick: () => t.patch({ seed: Math.floor(Math.random() * 100000) }) },
                        h(Icon, { name: "dice", size: 16 })))))));
}
