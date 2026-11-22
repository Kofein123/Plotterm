import { h } from "../dom.js";
import { app, PAPER_PRESETS } from "../../app/state.js";
import { Btn, Field, NumInput, Note, Section, Segmented, Toggle, bind } from "../components.js";
import { flipPageSide, syncPaperToFrame, traceMargins } from "../../app/actions.js";
export function PaperTab() {
    const p = app.paper;
    const tpl = () => p.value.template;
    const choose = (k) => {
        if (k === 'custom')
            p.patch({ template: 'custom' });
        else
            p.patch(PAPER_PRESETS[k].p);
        // размер — с настоящего листа, если он откалиброван целиком (шаблон меняет только разлиновку и поля)
        const f = app.frame.peek();
        if (f.width >= 100 && f.height >= 100)
            syncPaperToFrame();
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
            h(Toggle, { value: () => p.value.autoFit !== false, onChange: (v) => p.patch({ autoFit: v }), label: "\u041F\u043E\u0434\u0433\u043E\u043D\u044F\u0442\u044C \u0442\u0435\u043A\u0441\u0442 \u043F\u043E\u0434 \u043B\u0438\u0441\u0442", hint: "\u041F\u043E\u0441\u043B\u0435 \u0448\u0430\u0433\u0430 3 \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0438 \u0431\u0443\u043A\u0432\u044B, \u043F\u043E\u043B\u044F \u0438 \u0440\u0430\u0437\u043B\u0438\u043D\u043E\u0432\u043A\u0430 \u043C\u0435\u043D\u044F\u044E\u0442\u0441\u044F \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u0440\u0430\u0437\u043C\u0435\u0440\u043E\u043C \u043B\u0438\u0441\u0442\u0430, \u0447\u0442\u043E\u0431\u044B \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u043F\u043E\u043C\u0435\u0449\u0430\u043B\u043E\u0441\u044C \u0441\u0442\u043E\u043B\u044C\u043A\u043E \u0436\u0435" }),
            () => {
                const f = app.frame.value;
                const pp = p.value;
                if (!f.ready)
                    return h("div", { class: "muted small" }, "\u041F\u0440\u043E\u0439\u0434\u0438\u0442\u0435 \u0448\u0430\u0433\u0438 2\u20133 \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0438 \u2014 \u0440\u0430\u0437\u043C\u0435\u0440 \u0432\u043E\u0437\u044C\u043C\u0451\u0442\u0441\u044F \u0441 \u043D\u0430\u0441\u0442\u043E\u044F\u0449\u0435\u0433\u043E \u043B\u0438\u0441\u0442\u0430.");
                return Math.abs(pp.width - f.width) > 1 || Math.abs(pp.height - f.height) > 1 ? (h(Note, { kind: "warn" },
                    "\u041F\u043E \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0435 \u043B\u0438\u0441\u0442 ",
                    f.width.toFixed(1),
                    "\u00D7",
                    f.height.toFixed(1),
                    " \u043C\u043C, \u0430 \u0437\u0434\u0435\u0441\u044C ",
                    pp.width,
                    "\u00D7",
                    pp.height,
                    ". \u041F\u043E\u043B\u044F \u043E\u0442\u0441\u0447\u0438\u0442\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u043E\u0442 \u043A\u0440\u0430\u0451\u0432 \u043B\u0438\u0441\u0442\u0430, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u043D\u0430 \u0431\u0443\u043C\u0430\u0433\u0435 \u0442\u0435\u043A\u0441\u0442 \u0441\u0434\u0432\u0438\u043D\u0435\u0442\u0441\u044F \u0438\u043B\u0438 \u0443\u0439\u0434\u0451\u0442 \u0437\u0430 \u043A\u0440\u0430\u0439.",
                    f.width < 100 || f.height < 100 ? ' Похоже, шаг 3 сделан не в углу листа: повторите шаги 2–3 — ноль точно в левом верхнем углу листа, край в правом нижнем.' : '',
                    h("div", { class: "row", style: "margin-top:6px" },
                        h(Btn, { small: true, kind: "primary", onClick: () => syncPaperToFrame() }, "\u0412\u0437\u044F\u0442\u044C \u0440\u0430\u0437\u043C\u0435\u0440 \u0441 \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0438")))) : (h("div", { class: "muted small" }, "\u2713 \u0420\u0430\u0437\u043C\u0435\u0440 \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u0435\u0442 \u0441 \u043E\u0442\u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u043C \u043B\u0438\u0441\u0442\u043E\u043C."));
            }),
        h(Section, { title: "\u0421\u0442\u0440\u043E\u043A\u0438" },
            () => tpl() === 'grid' ? (h("div", { class: "grid2" },
                h(Field, { label: "\u041A\u043B\u0435\u0442\u043A\u0430" },
                    h(NumInput, { value: bind(p, 'cell').get, onChange: bind(p, 'cell').set, min: 2, max: 15, step: 0.1, unit: "\u043C\u043C" })),
                h(Field, { label: "\u0421\u0442\u0440\u043E\u043A\u0430 \u0447\u0435\u0440\u0435\u0437", hint: "\u043A\u043B\u0435\u0442\u043E\u043A \u043C\u0435\u0436\u0434\u0443 \u0441\u0442\u0440\u043E\u043A\u0430\u043C\u0438: 1 \u2014 \u0432\u0434\u0432\u043E\u0435 \u043F\u043B\u043E\u0442\u043D\u0435\u0435 \u0438 \u0432\u0434\u0432\u043E\u0435 \u043C\u0435\u043D\u044C\u0448\u0435 \u043B\u0438\u0441\u0442\u043E\u0432" },
                    h(Segmented, { value: bind(p, 'gridLineCells').get, onChange: bind(p, 'gridLineCells').set, options: [1, 2, 3].map((n) => ({ value: n, label: String(n) })) })))) : tpl() === 'ruled' ? (h(Field, { label: "\u0428\u0430\u0433 \u043B\u0438\u043D\u0435\u0435\u043A" },
                h(NumInput, { value: bind(p, 'rulePitch').get, onChange: bind(p, 'rulePitch').set, min: 4, max: 20, step: 0.1, unit: "\u043C\u043C" }))) : (h(Field, { label: "\u041C\u0435\u0436\u0441\u0442\u0440\u043E\u0447\u043D\u044B\u0439 \u0448\u0430\u0433" },
                h(NumInput, { value: bind(p, 'blankLineStep').get, onChange: bind(p, 'blankLineStep').set, min: 3, max: 30, step: 0.5, unit: "\u043C\u043C" }))),
            () => {
                const pg = app.layout.value.pages[0];
                return pg ? (h("div", { class: "muted small" },
                    pg.totalLines,
                    " \u0441\u0442\u0440\u043E\u043A \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435, \u0432\u0441\u0435\u0433\u043E ",
                    app.pageCount.value,
                    " \u0441\u0442\u0440. \u041F\u043B\u043E\u0442\u043D\u0435\u0435 \u2014 \u043C\u0435\u043D\u044C\u0448\u0438\u0439 \u0448\u0430\u0433 \u0441\u0442\u0440\u043E\u043A, \u0431\u0443\u043A\u0432\u0430 \u043F\u043E\u043C\u0435\u043D\u044C\u0448\u0435 (\u00AB\u041F\u043E\u0447\u0435\u0440\u043A\u00BB \u2192 \u0432\u044B\u0441\u043E\u0442\u0430 \u0441\u0442\u0440\u043E\u0447\u043D\u043E\u0439) \u0438 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043D\u0430\u044F \u043F\u0443\u0441\u0442\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430 \u043C\u0435\u0436\u0434\u0443 \u0430\u0431\u0437\u0430\u0446\u0430\u043C\u0438.")) : null;
            },
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
            h(Toggle, { value: () => !!p.value.spread, onChange: (v) => {
                    const cur = p.peek();
                    const f = app.frame.peek();
                    // если лист откалиброван, его ширина И ЕСТЬ весь разворот — тогда ничего не удваиваем,
                    // просто делим его пополам; иначе ширина задана для одной страницы
                    const measured = f.ready && f.width >= 100 && Math.abs(f.width - cur.width) <= 2;
                    const width = measured ? cur.width : v ? Math.round(cur.width * 2) : Math.max(50, Math.round(cur.width / 2));
                    p.patch({ spread: v, width });
                }, label: "\u0422\u0435\u0442\u0440\u0430\u0434\u044C \u043B\u0435\u0436\u0438\u0442 \u0440\u0430\u0437\u0432\u043E\u0440\u043E\u0442\u043E\u043C (\u0434\u0432\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B)", hint: "\u041F\u043B\u043E\u0442\u0442\u0435\u0440 \u043D\u0430\u043F\u0438\u0448\u0435\u0442 \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u043B\u0435\u0432\u0443\u044E \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443, \u043F\u043E\u0442\u043E\u043C \u043F\u0440\u0430\u0432\u0443\u044E, \u0438 \u043F\u043E\u043F\u0440\u043E\u0441\u0438\u0442 \u043F\u0435\u0440\u0435\u0432\u0435\u0440\u043D\u0443\u0442\u044C \u043B\u0438\u0441\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u043E\u0431\u0435\u0438\u0445. \u041D\u043E\u043B\u044C \u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u0432 \u043B\u0435\u0432\u044B\u0439 \u0432\u0435\u0440\u0445\u043D\u0438\u0439 \u0443\u0433\u043E\u043B \u0432\u0441\u0435\u0433\u043E \u0440\u0430\u0437\u0432\u043E\u0440\u043E\u0442\u0430, \u043A\u0440\u0430\u0439 \u2014 \u0432 \u043F\u0440\u0430\u0432\u044B\u0439 \u043D\u0438\u0436\u043D\u0438\u0439" }),
            () => {
                const pp = p.value;
                if (!pp.spread)
                    return null;
                const f = app.frame.value;
                const half = (pp.width / 2).toFixed(1);
                if (f.ready && f.height > f.width * 1.1)
                    return (h(Note, { kind: "warn" },
                        "\u041F\u043E \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0435 \u043B\u0438\u0441\u0442 ",
                        f.width.toFixed(1),
                        " \u00D7 ",
                        f.height.toFixed(1),
                        " \u043C\u043C \u2014 \u043E\u043D \u0432\u044B\u0448\u0435, \u0447\u0435\u043C \u0448\u0438\u0440\u0435, \u0442\u043E \u0435\u0441\u0442\u044C \u0438\u0437\u043C\u0435\u0440\u0435\u043D\u0430 \u043E\u0434\u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430, \u0430 \u043D\u0435 \u0440\u0430\u0437\u0432\u043E\u0440\u043E\u0442. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u0448\u0430\u0433 3: \u00AB\u0417\u0434\u0435\u0441\u044C \u043A\u0440\u0430\u0439\u00BB \u0441\u0442\u0430\u0432\u0438\u0442\u0441\u044F \u0432 \u043F\u0440\u0430\u0432\u044B\u0439 \u043D\u0438\u0436\u043D\u0438\u0439 \u0443\u0433\u043E\u043B \u041F\u0420\u0410\u0412\u041E\u0419 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B, \u0442\u043E\u0433\u0434\u0430 \u0448\u0438\u0440\u0438\u043D\u0430 \u0441\u0442\u0430\u043D\u0435\u0442 \u043F\u0440\u0438\u043C\u0435\u0440\u043D\u043E \u0432\u0434\u0432\u043E\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 \u0432\u044B\u0441\u043E\u0442\u044B \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B."));
                return f.ready && Math.abs(f.width - pp.width) > 2 ? (h(Note, { kind: "warn" },
                    "\u0428\u0438\u0440\u0438\u043D\u0430 \u0440\u0430\u0437\u0432\u043E\u0440\u043E\u0442\u0430 \u0432 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0435 ",
                    pp.width,
                    " \u043C\u043C, \u0430 \u043F\u043E \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0435 \u043B\u0438\u0441\u0442 ",
                    f.width.toFixed(1),
                    " \u043C\u043C. \u041D\u043E\u043B\u044C \u0438 \u043A\u0440\u0430\u0439 \u0434\u043E\u043B\u0436\u043D\u044B \u0441\u0442\u043E\u044F\u0442\u044C \u043F\u043E \u0443\u0433\u043B\u0430\u043C \u0412\u0421\u0415\u0413\u041E \u0440\u0430\u0437\u0432\u043E\u0440\u043E\u0442\u0430: \u043D\u043E\u043B\u044C \u2014 \u043B\u0435\u0432\u044B\u0439 \u0432\u0435\u0440\u0445\u043D\u0438\u0439 \u0443\u0433\u043E\u043B \u043B\u0435\u0432\u043E\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B, \u043A\u0440\u0430\u0439 \u2014 \u043F\u0440\u0430\u0432\u044B\u0439 \u043D\u0438\u0436\u043D\u0438\u0439 \u0443\u0433\u043E\u043B \u043F\u0440\u0430\u0432\u043E\u0439.",
                    h("div", { class: "row", style: "margin-top:6px" },
                        h(Btn, { small: true, kind: "primary", onClick: () => syncPaperToFrame() }, "\u0412\u0437\u044F\u0442\u044C \u0440\u0430\u0437\u043C\u0435\u0440 \u0441 \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0438")))) : (h("div", { class: "muted small" },
                    "\u0420\u0430\u0437\u0432\u043E\u0440\u043E\u0442 ",
                    pp.width,
                    " \u043C\u043C: \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u2014 \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u0430 \u043F\u043E ",
                    half,
                    " \u043C\u043C. \u0427\u0451\u0442\u043D\u044B\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \u043F\u0438\u0448\u0443\u0442\u0441\u044F \u0441\u043B\u0435\u0432\u0430, \u043D\u0435\u0447\u0451\u0442\u043D\u044B\u0435 \u0441\u043F\u0440\u0430\u0432\u0430."));
            },
            h(Field, { label: "\u041A\u0440\u0430\u0441\u043D\u0430\u044F \u043B\u0438\u043D\u0438\u044F (\u0448\u0438\u0440\u043E\u043A\u043E\u0435 \u043F\u043E\u043B\u0435)", hint: "\u043F\u0440\u0430\u0432\u0430\u044F \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u0442\u0435\u0442\u0440\u0430\u0434\u0438 \u2014 \u043B\u0438\u043D\u0438\u044F \u0441\u043F\u0440\u0430\u0432\u0430, \u043B\u0435\u0432\u0430\u044F \u2014 \u0441\u043B\u0435\u0432\u0430; \u00AB\u0427\u0435\u0440\u0435\u0434\u043E\u0432\u0430\u0442\u044C\u00BB \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442 \u0435\u0451 \u0441\u0430\u043C\u0430 \u0447\u0435\u0440\u0435\u0437 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443" },
                h(Segmented, { value: bind(p, 'side').get, onChange: (v) => {
                        // «Нет» — тетрадь без красной линии: поля с обеих сторон одинаковые, по узкому
                        if (v !== 'none')
                            return p.patch({ side: v });
                        const cur = p.peek();
                        // поля одинаковые по узкому, но не впритык к краю: иначе буквы уезжают за лист
                        const narrow = Math.max(5, Math.min(cur.marginLeft, cur.marginRight));
                        p.patch({ side: v, marginLeft: narrow, marginRight: narrow });
                    }, options: [{ value: 'right', label: 'Справа' }, { value: 'left', label: 'Слева' }, { value: 'alternate', label: 'Чередовать' }, { value: 'none', label: 'Нет' }] })),
            h("div", { class: "row wrap" },
                h(Btn, { small: true, kind: "ghost", onClick: () => flipPageSide(), title: "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0448\u0438\u0440\u043E\u043A\u043E\u0435 \u043F\u043E\u043B\u0435 \u0441 \u043A\u0440\u0430\u0441\u043D\u043E\u0439 \u043B\u0438\u043D\u0438\u0435\u0439 \u043D\u0430 \u0434\u0440\u0443\u0433\u0443\u044E \u0441\u0442\u043E\u0440\u043E\u043D\u0443" }, "\u21C6 \u041B\u0438\u043D\u0438\u044E \u043D\u0430 \u0434\u0440\u0443\u0433\u0443\u044E \u0441\u0442\u043E\u0440\u043E\u043D\u0443"),
                () => {
                    const pp = p.value;
                    if (pp.spread)
                        return h("span", { class: "muted small" }, "\u0420\u0430\u0437\u0432\u043E\u0440\u043E\u0442: \u043A\u0440\u0430\u0441\u043D\u0430\u044F \u043B\u0438\u043D\u0438\u044F \u0441\u0442\u043E\u0438\u0442 \u0443 \u0432\u043D\u0435\u0448\u043D\u0435\u0433\u043E \u043A\u0440\u0430\u044F \u043A\u0430\u0436\u0434\u043E\u0439 \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u044B.");
                    if (pp.side === 'none')
                        return h("span", { class: "muted small" }, "\u0422\u0435\u0442\u0440\u0430\u0434\u044C \u0431\u0435\u0437 \u043A\u0440\u0430\u0441\u043D\u043E\u0439 \u043B\u0438\u043D\u0438\u0438: \u043F\u043E\u043B\u044F \u0441\u043B\u0435\u0432\u0430 \u0438 \u0441\u043F\u0440\u0430\u0432\u0430 \u043E\u0434\u0438\u043D\u0430\u043A\u043E\u0432\u044B\u0435, \u0442\u0435\u043A\u0441\u0442 \u0438\u0434\u0451\u0442 \u0432\u043E \u0432\u0441\u044E \u0448\u0438\u0440\u0438\u043D\u0443.");
                    const pi = app.currentPage.value;
                    const m = app.layout.value.pages[pi]?.mirrored ?? (pp.side === 'left' || (pp.side === 'alternate' && (pp.leftFirst ? pi % 2 === 0 : pi % 2 === 1)));
                    return h("span", { class: "muted small" },
                        "\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 ",
                        pi + 1,
                        " \u043A\u0440\u0430\u0441\u043D\u0430\u044F \u043B\u0438\u043D\u0438\u044F ",
                        m ? 'слева' : 'справа',
                        ".");
                }),
            () => p.value.side === 'alternate' && !p.value.spread ? (h(Toggle, { value: () => !!p.value.leftFirst, onChange: (v) => p.patch({ leftFirst: v }), label: "\u041D\u0430\u0447\u0430\u0442\u044C \u0441 \u043B\u0435\u0432\u043E\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B", hint: "\u0415\u0441\u043B\u0438 \u043F\u0435\u0440\u0432\u0430\u044F \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u0442\u0435\u0442\u0440\u0430\u0434\u0438 \u2014 \u043B\u0435\u0432\u0430\u044F: \u043B\u0438\u043D\u0438\u044F \u043F\u043E\u0439\u0434\u0451\u0442 \u0441\u043B\u0435\u0432\u0430, \u0441\u043F\u0440\u0430\u0432\u0430, \u0441\u043B\u0435\u0432\u0430\u2026" })) : null,
            h("div", { class: "row wrap" },
                h(Btn, { small: true, kind: "ghost", onClick: () => traceMargins(), disabled: () => app.machine.conn.value !== 'connected' || app.job.active, title: "\u0420\u0443\u0447\u043A\u0430 \u043F\u043E\u0434\u043D\u044F\u0442\u0430: \u043A\u0430\u0440\u0435\u0442\u043A\u0430 \u043F\u0440\u043E\u0435\u0434\u0435\u0442 \u043F\u043E \u0433\u0440\u0430\u043D\u0438\u0446\u0435 \u043F\u043E\u043B\u0435\u0439" }, "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u043F\u043E\u043B\u044F \u043D\u0430 \u043B\u0438\u0441\u0442\u0435"),
                h("span", { class: "muted small" }, "\u043A\u0430\u0440\u0435\u0442\u043A\u0430 \u0441 \u043F\u043E\u0434\u043D\u044F\u0442\u043E\u0439 \u0440\u0443\u0447\u043A\u043E\u0439 \u043F\u0440\u043E\u0435\u0434\u0435\u0442 \u043F\u043E \u0433\u0440\u0430\u043D\u0438\u0446\u0435 \u043F\u043E\u043B\u0435\u0439 \u2014 \u0432\u0438\u0434\u043D\u043E, \u0433\u0434\u0435 \u0431\u0443\u0434\u0435\u0442 \u0442\u0435\u043A\u0441\u0442")),
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
