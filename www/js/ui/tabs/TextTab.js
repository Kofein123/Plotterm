import { h } from "../dom.js";
import { app, SAMPLE_TEXT, saveImages } from "../../app/state.js";
import { docxToDocument, missingImages, pdfToDocument } from "../../io/document.js";
import { vectorize } from "../../io/vectorize.js";
import { imageFileToGray } from "../../io/image.js";
import { Btn, Icon, Note, Section } from "../components.js";
import { readTextFile, svgToStrokes } from "../../io/importers.js";
import { pickFile, toast, fmtTime } from "../../app/notify.js";
async function importText() {
    const f = await pickFile('.pdf,.docx,.txt,.md,.markdown,text/plain,application/pdf');
    if (!f)
        return;
    const name = f.name.toLowerCase();
    try {
        if (name.endsWith('.pdf') || name.endsWith('.docx')) {
            toast(`Читаю «${f.name}»: текст и рисунки…`, 'info', 4000);
            const buf = await f.arrayBuffer();
            const d = name.endsWith('.pdf') ? await pdfToDocument(buf, (m) => toast(m, 'info', 1500)) : await docxToDocument(buf);
            await saveImages(d.images.map((im) => ({ ...im, id: im.id })));
            app.text.value = d.text;
            app.source.value = { kind: 'text' };
            app.currentPage.value = 0;
            const marked = [...d.text.matchAll(/\(img:[\w-]+ (место|карандаш)\)/g)];
            toast(`Загружено: ${f.name} · рисунков ${d.images.length}` +
                (marked.length ? ` (из них ${marked.filter((m) => m[1] === 'место').length} — место под распечатку, ${marked.filter((m) => m[1] === 'карандаш').length} — карандашом)` : '') +
                '. Проверьте текст и страницы в предпросмотре.', 'ok', 8000);
            return;
        }
        const t = await readTextFile(f);
        app.text.value = t;
        app.source.value = { kind: 'text' };
        toast(`Загружено: ${f.name}`, 'ok');
    }
    catch (e) {
        toast('Не удалось прочитать файл: ' + (e?.message ?? e), 'err');
    }
}
/** Картинка (фото схемы, скриншот) → линии; в текст вставляется строка-рисунок. */
async function insertPicture(insert) {
    const f = await pickFile('image/*');
    if (!f)
        return;
    try {
        const g = await imageFileToGray(f, 1800);
        const d = vectorize(g);
        if (!d.paths.length)
            return toast('На картинке не нашлось линий.', 'warn');
        const id = 'r' + Date.now().toString(36);
        await saveImages([{ id, name: f.name, ...d }]);
        insert(`\n![](img:${id} 70%)\n`);
        toast(`Рисунок «${f.name}»: ${d.paths.length} линий. В строке можно поменять ширину (70 %) и добавить «карандаш» или «место».`, 'ok', 8000);
    }
    catch (e) {
        toast('Не удалось открыть картинку: ' + (e?.message ?? e), 'err');
    }
}
export async function importSvg() {
    const f = await pickFile('.svg,image/svg+xml');
    if (!f)
        return;
    try {
        const p = app.paper.peek();
        const strokes = svgToStrokes(await f.text(), {
            width: 0, left: p.marginLeft, top: p.marginTop,
            maxWidth: p.width - p.marginLeft - p.marginRight, maxHeight: p.height - p.marginTop - p.marginBottom,
        });
        if (!strokes.length)
            return toast('В SVG не нашлось линий.', 'warn');
        app.source.value = { kind: 'drawing', name: f.name, strokes };
        app.currentPage.value = 0;
        toast(`Рисунок «${f.name}»: ${strokes.length} линий, вписан в поля листа.`, 'ok');
    }
    catch (e) {
        toast('Не удалось открыть SVG: ' + (e?.message ?? e), 'err');
    }
}
export async function importGcode() {
    const f = await pickFile('.gcode,.nc,.ngc,.txt,.tap');
    if (!f)
        return;
    const lines = (await f.text()).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^%/.test(l));
    app.source.value = { kind: 'gcode', name: f.name, lines };
    app.currentPage.value = 0;
    toast(`G-код «${f.name}»: ${lines.length} строк. Будет отправлен как есть — проверьте предпросмотр.`, 'warn', 8000);
}
function applyProfile(p) {
    app.typo.value = { ...p.typo };
    app.paper.value = { ...p.paper };
    app.speed.value = { ...p.speed };
    app.pen.value = { ...p.pen };
    toast(`Профиль «${p.name}» применён.`, 'ok');
}
function saveProfile() {
    const name = prompt('Название профиля (например: «Физика, клетка»):');
    if (!name)
        return;
    const p = { name, typo: { ...app.typo.peek() }, paper: { ...app.paper.peek() }, speed: { ...app.speed.peek() }, pen: { ...app.pen.peek() } };
    app.profiles.value = [...app.profiles.peek().filter((x) => x.name !== name), p];
    toast(`Профиль «${name}» сохранён.`, 'ok');
}
export function TextTab() {
    let ta;
    const insert = (s) => {
        const a = ta.selectionStart, b = ta.selectionEnd;
        const v = ta.value;
        ta.value = v.slice(0, a) + s + v.slice(b);
        ta.selectionStart = ta.selectionEnd = a + s.length;
        app.text.value = ta.value;
        ta.focus();
    };
    return (h("div", { class: "tab" },
        () => app.source.value.kind !== 'text' ? (h(Note, { kind: "warn" },
            "\u0421\u0435\u0439\u0447\u0430\u0441 \u043D\u0430 \u043B\u0438\u0441\u0442\u0435 ",
            app.source.value.kind === 'drawing' ? 'рисунок' : 'G-код',
            " \u00AB",
            app.source.value.name,
            "\u00BB.",
            ' ',
            h("a", { href: "#", onClick: (e) => { e.preventDefault(); app.source.value = { kind: 'text' }; } }, "\u0412\u0435\u0440\u043D\u0443\u0442\u044C\u0441\u044F \u043A \u0442\u0435\u043A\u0441\u0442\u0443"))) : null,
        h(Section, { title: "\u0422\u0435\u043A\u0441\u0442 \u043A\u043E\u043D\u0441\u043F\u0435\u043A\u0442\u0430", aside: h("span", { class: "row" },
                h(Btn, { small: true, kind: "ghost", onClick: () => importText(), title: "PDF, Word (.docx), .txt, .md \u2014 \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u0440\u0438\u0441\u0443\u043D\u043A\u0430\u043C\u0438" },
                    h(Icon, { name: "upload", size: 14 }),
                    " \u0424\u0430\u0439\u043B \u043B\u0435\u043A\u0446\u0438\u0438")) },
            h("textarea", { class: "text-input", ref: (el) => (ta = el), spellcheck: true, lang: "ru", placeholder: "\u0412\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u0438\u043B\u0438 \u043D\u0430\u043F\u0435\u0447\u0430\u0442\u0430\u0439\u0442\u0435 \u0442\u0435\u043A\u0441\u0442\u2026", value: () => app.text.value, onInput: (e) => {
                    app.text.value = e.target.value;
                    if (app.source.peek().kind !== 'text')
                        app.source.value = { kind: 'text' };
                } }),
            h("div", { class: "text-tools" },
                h("button", { class: "chip", title: "\u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A \u043F\u043E \u0446\u0435\u043D\u0442\u0440\u0443", onClick: () => insert('# ') }, "# \u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A"),
                h("button", { class: "chip", title: "\u0421\u0442\u0435\u043F\u0435\u043D\u044C", onClick: () => insert('^{}') }, "x\u00B2"),
                h("button", { class: "chip", title: "\u0418\u043D\u0434\u0435\u043A\u0441", onClick: () => insert('_{}') }, "x\u2081"),
                h("button", { class: "chip", title: "\u041A\u043E\u0440\u0435\u043D\u044C", onClick: () => insert('√') }, "\u221A"),
                h("button", { class: "chip", title: "\u041F\u043E\u0434\u0447\u0435\u0440\u043A\u043D\u0443\u0442\u044C", onClick: () => insert('____') }, "\u043F\u043E\u0434\u0447\u0435\u0440\u043A\u043D\u0443\u0442\u044C"),
                h("button", { class: "chip", title: "\u041D\u043E\u0432\u0430\u044F \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430", onClick: () => insert('\n===\n') }, "\u043D\u043E\u0432\u0430\u044F \u0441\u0442\u0440."),
                h("button", { class: "chip", title: "\u0420\u0438\u0441\u0443\u043D\u043E\u043A \u0438\u0437 \u0444\u043E\u0442\u043E \u0438\u043B\u0438 \u043A\u0430\u0440\u0442\u0438\u043D\u043A\u0438: \u043F\u043B\u043E\u0442\u0442\u0435\u0440 \u043D\u0430\u0440\u0438\u0441\u0443\u0435\u0442 \u0435\u0433\u043E \u043B\u0438\u043D\u0438\u044F\u043C\u0438", onClick: () => insertPicture(insert) }, "+ \u0440\u0438\u0441\u0443\u043D\u043E\u043A")),
            h("div", { class: "text-stats muted" }, () => {
                const l = app.layout.value;
                const n = l.pages.length;
                return `${l.chars} знаков · ${n} стр. · ≈ ${fmtTime(app.totalEstimate.value)}`;
            }),
            () => {
                const miss = missingImages(app.text.value, app.images.value);
                return miss.length ? h(Note, { kind: "warn" },
                    "\u041D\u0435\u0442 \u0440\u0438\u0441\u0443\u043D\u043A\u043E\u0432: ",
                    miss.join(', '),
                    " \u2014 \u043D\u0430 \u0438\u0445 \u043C\u0435\u0441\u0442\u0435 \u043E\u0441\u0442\u0430\u043D\u0435\u0442\u0441\u044F \u043F\u0443\u0441\u0442\u043E\u0435 \u043C\u0435\u0441\u0442\u043E. \u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0444\u0430\u0439\u043B \u043B\u0435\u043A\u0446\u0438\u0438 \u0437\u0430\u043D\u043E\u0432\u043E \u043D\u0430 \u044D\u0442\u043E\u043C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435.") : null;
            },
            h("div", { class: "muted small" },
                "\u0420\u0438\u0441\u0443\u043D\u043E\u043A \u2014 \u0441\u0442\u0440\u043E\u043A\u0430 ",
                h("code", null, "![\u043F\u043E\u0434\u043F\u0438\u0441\u044C](img:\u2026)"),
                ": \u0434\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u00AB50%\u00BB, \u0447\u0442\u043E\u0431\u044B \u0441\u0434\u0435\u043B\u0430\u0442\u044C \u0443\u0436\u0435, \u00AB\u043A\u0430\u0440\u0430\u043D\u0434\u0430\u0448\u00BB \u2014 \u043D\u0430\u0440\u0438\u0441\u043E\u0432\u0430\u0442\u044C \u043A\u0430\u0440\u0430\u043D\u0434\u0430\u0448\u043E\u043C \u043F\u043E\u0441\u043B\u0435 \u0442\u0435\u043A\u0441\u0442\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B (\u043F\u043B\u043E\u0442\u0442\u0435\u0440 \u043F\u043E\u043F\u0440\u043E\u0441\u0438\u0442 \u0441\u043C\u0435\u043D\u0438\u0442\u044C \u0440\u0443\u0447\u043A\u0443), \u00AB\u043C\u0435\u0441\u0442\u043E\u00BB \u2014 \u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u043C\u0435\u0441\u0442\u043E \u043F\u043E\u0434 \u0440\u0430\u0441\u043F\u0435\u0447\u0430\u0442\u043A\u0443."),
            () => app.layout.value.missingChars.length ? (h(Note, { kind: "warn" },
                "\u0412 \u0448\u0440\u0438\u0444\u0442\u0435 \u043D\u0435\u0442 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432: ",
                app.layout.value.missingChars.join(' '),
                " \u2014 \u043E\u043D\u0438 \u0437\u0430\u043C\u0435\u043D\u0435\u043D\u044B.")) : null,
            h("div", { class: "muted small" }, "\u041E\u0440\u0444\u043E\u0433\u0440\u0430\u0444\u0438\u044E \u043F\u043E\u0434\u0447\u0451\u0440\u043A\u0438\u0432\u0430\u0435\u0442 \u0431\u0440\u0430\u0443\u0437\u0435\u0440 (\u043A\u0440\u0430\u0441\u043D\u0430\u044F \u0432\u043E\u043B\u043D\u0430) \u2014 \u0438\u0441\u043F\u0440\u0430\u0432\u044C\u0442\u0435 \u0434\u043E \u043F\u0435\u0447\u0430\u0442\u0438, \u0447\u0442\u043E\u0431\u044B \u043D\u0435 \u0442\u0440\u0430\u0442\u0438\u0442\u044C \u043B\u0438\u0441\u0442.")),
        h(Section, { title: "\u041F\u0440\u043E\u0444\u0438\u043B\u0438 \u043F\u043E\u0434 \u043F\u0440\u0435\u0434\u043C\u0435\u0442", aside: h(Btn, { small: true, kind: "ghost", onClick: saveProfile }, "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0438\u0435") }, () => app.profiles.value.length ? (h("div", { class: "profiles" }, app.profiles.value.map((p) => (h("span", { class: "profile" },
            h("button", { class: "chip", onClick: () => applyProfile(p), title: "\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C: \u0448\u0440\u0438\u0444\u0442, \u0431\u0443\u043C\u0430\u0433\u0430, \u0440\u0443\u0447\u043A\u0430, \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u044C" }, p.name),
            h("button", { class: "icon-btn", title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C", onClick: () => { if (confirm(`Удалить профиль «${p.name}»?`))
                    app.profiles.value = app.profiles.peek().filter((x) => x !== p); } },
                h(Icon, { name: "trash", size: 14 }))))))) : (h("div", { class: "muted small" }, "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0435 \u0448\u0440\u0438\u0444\u0442, \u0431\u0443\u043C\u0430\u0433\u0443, \u0440\u0443\u0447\u043A\u0443 \u0438 \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u043E\u0434\u043D\u043E\u0439 \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \u2014 \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 \u00AB\u0424\u0438\u0437\u0438\u043A\u0430, \u043A\u043B\u0435\u0442\u043A\u0430, 4 \u043C\u043C\u00BB \u2014 \u0438 \u0432\u044B\u0431\u0438\u0440\u0430\u0439\u0442\u0435 \u0432 \u043E\u0434\u0438\u043D \u043A\u043B\u0438\u043A."))),
        h(Section, { title: "\u0414\u0440\u0443\u0433\u043E\u0435 \u043D\u0430 \u043B\u0438\u0441\u0442" },
            h("div", { class: "row wrap" },
                h(Btn, { small: true, onClick: () => importSvg() },
                    h(Icon, { name: "upload", size: 14 }),
                    " \u0420\u0438\u0441\u0443\u043D\u043E\u043A SVG"),
                h(Btn, { small: true, onClick: () => importGcode() },
                    h(Icon, { name: "upload", size: 14 }),
                    " \u0413\u043E\u0442\u043E\u0432\u044B\u0439 G-\u043A\u043E\u0434"),
                h(Btn, { small: true, kind: "ghost", onClick: () => { if (confirm('Вернуть пример текста?'))
                        app.text.value = SAMPLE_TEXT; } }, "\u041F\u0440\u0438\u043C\u0435\u0440 \u0442\u0435\u043A\u0441\u0442\u0430")))));
}
