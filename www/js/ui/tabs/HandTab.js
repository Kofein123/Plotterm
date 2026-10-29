// «Мой почерк»: рисуете буквы мышью или стилусом, по 3–5 вариантов каждой; недостающие берутся из базового шрифта.
import { h } from "../dom.js";
import { signal, effect, computed } from "../reactive.js";
import { app, saveCustomFont, deleteCustomFont } from "../../app/state.js";
import { BUILTIN_FONTS, CUSTOM_X_HEIGHT, resolveGlyph } from "../../fonts/fonts.js";
import { Btn, Field, Icon, NumInput, Note, Section, Select, Segmented } from "../components.js";
import { downloadText, pickFile, toast } from "../../app/notify.js";
import { importSvgFont } from "../../io/svgfont.js";
import { importOutlineFont } from "../../io/outlinefont.js";
import { GRID_CORNERS, templateSvg } from "../../io/template.js";
import { findMarks, readTemplate } from "../../io/templateImport.js";
import { imageFileToGray } from "../../io/image.js";
const GROUPS = {
    lower: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
    upper: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
    digits: '0123456789',
    punct: '.,:;!?-—()«»"\'/+=%№',
    kaz: 'әғқңөұүһіӘҒҚҢӨҰҮҺІ',
    latin: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
};
const GROUP_NAMES = [
    { value: 'lower', label: 'строчные' }, { value: 'upper', label: 'прописные' }, { value: 'digits', label: 'цифры' },
    { value: 'punct', label: 'знаки' }, { value: 'kaz', label: 'қазақ' }, { value: 'latin', label: 'latin' },
];
const editing = signal(null);
const group = signal('lower');
const ch = signal('а');
const strokes = signal([]);
const hasEditing = computed(() => editing.value !== null);
// геометрия холста редактора
const CW = 420, CH = 320;
const PX = 1.1; // пикселей на единицу шрифта (x-height = 100 ед.)
const BASE_Y = 220;
const LEFT_X = 90;
const toCanvas = (x, y) => [LEFT_X + x * PX, BASE_Y - y * PX];
const toUnits = (cx, cy) => [(cx - LEFT_X) / PX, (BASE_Y - cy) / PX];
function normalize(st, letterGap) {
    const all = st.flat();
    if (!all.length)
        return null;
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < all.length; i += 2) {
        minX = Math.min(minX, all[i]);
        maxX = Math.max(maxX, all[i]);
    }
    void letterGap;
    return {
        w: Math.round((maxX - minX) * 10) / 10,
        s: st.map((s) => s.map((v, i) => Math.round((i % 2 === 0 ? v - minX : v) * 10) / 10)),
    };
}
function glyphSvg(g, size = 44) {
    const pad = 10;
    const minY = -60, maxY = 160;
    const w = Math.max(g.w, 40) + pad * 2;
    const hgt = maxY - minY;
    const d = g.s
        .map((s) => {
        const pts = [];
        for (let i = 0; i < s.length; i += 2)
            pts.push(`${(s[i] + pad).toFixed(1)},${(maxY - s[i + 1]).toFixed(1)}`);
        return 'M' + pts.join(' L');
    })
        .join(' ');
    return (h("svg", { width: size * (w / hgt), height: size, viewBox: `0 0 ${w} ${hgt}` },
        h("line", { x1: "0", x2: w, y1: maxY, y2: maxY, stroke: "var(--grid)", "stroke-width": "2" }),
        h("path", { d: d, fill: "none", stroke: "var(--ink)", "stroke-width": "6", "stroke-linecap": "round", "stroke-linejoin": "round" })));
}
function newFont() {
    const name = prompt('Название шрифта (например: «Мой почерк»):', 'Мой почерк');
    if (!name)
        return;
    const rec = { id: 'custom-' + Date.now().toString(36), name, baseFontId: app.typo.peek().fontId.startsWith('custom') ? 'gost-a' : app.typo.peek().fontId, glyphs: {}, letterSpacing: 12, wordSpacing: 45, updatedAt: Date.now() };
    saveCustomFont(rec).then(() => {
        editing.value = structuredClone(rec);
        toast('Шрифт создан. Рисуйте буквы — каждую 3–5 раз, чтобы почерк был живым.', 'ok', 7000);
    });
}
async function persist() {
    const r = editing.peek();
    if (r)
        await saveCustomFont(r);
}
function saveVariant() {
    const r = editing.peek();
    if (!r)
        return;
    const g = normalize(strokes.peek(), r.letterSpacing);
    if (!g)
        return toast('Сначала нарисуйте букву.', 'warn');
    const list = r.glyphs[ch.peek()] ?? [];
    r.glyphs[ch.peek()] = [...list, g];
    editing.value = { ...r };
    strokes.value = [];
    persist();
    if ((r.glyphs[ch.peek()]?.length ?? 0) >= 3)
        nextChar();
}
function nextChar() {
    const chars = [...GROUPS[group.peek()]];
    const i = chars.indexOf(ch.peek());
    ch.value = chars[(i + 1) % chars.length];
    strokes.value = [];
}
function deleteVariant(i) {
    const r = editing.peek();
    if (!r)
        return;
    const list = (r.glyphs[ch.peek()] ?? []).slice();
    list.splice(i, 1);
    r.glyphs[ch.peek()] = list;
    if (!list.length)
        delete r.glyphs[ch.peek()];
    editing.value = { ...r };
    persist();
}
function Editor() {
    let canvas;
    let drawing = null;
    const redraw = () => {
        if (!canvas)
            return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = CW * dpr;
        canvas.height = CH * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const css = getComputedStyle(document.documentElement);
        ctx.fillStyle = css.getPropertyValue('--paper');
        ctx.fillRect(0, 0, CW, CH);
        const base = BUILTIN_FONTS.find((f) => f.id === editing.peek()?.baseFontId) ?? BUILTIN_FONTS[0];
        const k = CUSTOM_X_HEIGHT / base.xHeight;
        const lines = [
            [0, 'база', css.getPropertyValue('--ink')],
            [CUSTOM_X_HEIGHT, 'x', css.getPropertyValue('--grid-strong')],
            [base.capHeight * k, 'прописные', css.getPropertyValue('--grid')],
            [-base.descender * k, 'хвосты', css.getPropertyValue('--grid')],
        ];
        ctx.font = '11px system-ui, sans-serif';
        for (const [y, label, color] of lines) {
            const [, cy] = toCanvas(0, y);
            ctx.strokeStyle = color;
            ctx.lineWidth = y === 0 ? 1.5 : 1;
            ctx.setLineDash(y === 0 ? [] : [5, 4]);
            ctx.beginPath();
            ctx.moveTo(0, cy);
            ctx.lineTo(CW, cy);
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.fillText(label, 4, cy - 3);
        }
        ctx.setLineDash([]);
        // образец из базового шрифта
        const ref = resolveGlyph(base, ch.peek());
        if (!ref.missing) {
            ctx.strokeStyle = css.getPropertyValue('--ghost');
            ctx.lineWidth = 6;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            for (const s of ref.glyph.s) {
                for (let i = 0; i < s.length; i += 2) {
                    const [x, y] = toCanvas(s[i] * k + 20, s[i + 1] * k);
                    if (i === 0)
                        ctx.moveTo(x, y);
                    else
                        ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        }
        // нарисованное
        ctx.strokeStyle = css.getPropertyValue('--ink');
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (const s of [...strokes.peek(), ...(drawing ? [drawing] : [])]) {
            for (let i = 0; i < s.length; i += 2) {
                const [x, y] = toCanvas(s[i], s[i + 1]);
                if (i === 0)
                    ctx.moveTo(x, y);
                else
                    ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    };
    effect(() => {
        strokes.value;
        ch.value;
        editing.value;
        requestAnimationFrame(redraw);
    });
    const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        return toUnits(((e.clientX - r.left) / r.width) * CW, ((e.clientY - r.top) / r.height) * CH);
    };
    return (h("canvas", { class: "glyph-canvas", style: `aspect-ratio:${CW}/${CH}`, ref: (el) => { canvas = el; requestAnimationFrame(redraw); }, onPointerDown: (e) => {
            canvas.setPointerCapture(e.pointerId);
            drawing = [...pos(e)];
        }, onPointerMove: (e) => {
            if (!drawing)
                return;
            const [x, y] = pos(e);
            const lx = drawing[drawing.length - 2], ly = drawing[drawing.length - 1];
            if (Math.hypot(x - lx, y - ly) >= 1.5) {
                drawing.push(x, y);
                redraw();
            }
        }, onPointerUp: () => {
            if (drawing && drawing.length >= 2) {
                if (drawing.length === 2)
                    drawing.push(drawing[0] + 0.6, drawing[1]);
                strokes.value = [...strokes.peek(), drawing];
            }
            drawing = null;
        } }));
}
async function exportFont() {
    const r = editing.peek();
    if (!r)
        return;
    downloadText(`${r.name}.plotterm-font.json`, JSON.stringify(r), 'application/json');
}
export const importBusy = signal(null);
export async function importFont() {
    const f = await pickFile('.ttf,.otf,.woff,.woff2,.svg,.json,font/ttf,font/otf,font/woff,font/woff2');
    if (!f)
        return;
    try {
        let rec;
        const lower = f.name.toLowerCase();
        if (/\.(ttf|otf|woff2?)$/.test(lower)) {
            importBusy.value = 'Читаю шрифт…';
            rec = await importOutlineFont(f, (d, t) => (importBusy.value = `Перевожу буквы в линии: ${d} из ${t}`));
        }
        else if (lower.endsWith('.svg')) {
            rec = importSvgFont(await f.text(), f.name.replace(/\.svg$/i, ''));
        }
        else {
            rec = JSON.parse(await f.text());
            if (!rec.glyphs || !rec.name)
                throw new Error('это не файл шрифта Plotterm');
            rec.id = 'custom-' + Date.now().toString(36);
        }
        await saveCustomFont(rec);
        editing.value = structuredClone(rec);
        app.typo.patch({ fontId: rec.id, letterSpacing: 1, wordSpacing: 1, ...(/\.(ttf|otf|woff2?)$/.test(lower) ? { slant: 0 } : {}) });
        const cyr = [...'абвгдежзийклмнопрстуфхцчшщъыьэюя'].filter((c) => rec.glyphs[c]).length;
        toast(`Шрифт «${rec.name}» добавлен и выбран: ${Object.keys(rec.glyphs).length} символов` +
            (cyr < 32 ? `, кириллицы ${cyr}/32 — недостающие буквы возьмутся из ГОСТ.` : ', вся кириллица на месте.'), cyr < 20 ? 'warn' : 'ok', 9000);
    }
    catch (e) {
        toast('Не удалось импортировать: ' + (e?.message ?? e), 'err');
    }
    finally {
        importBusy.value = null;
    }
}
/** какой лист-шаблон печатаем и читаем: 1 — кириллица, 2 — латиница и формулы */
const sheetNo = signal(1);
function downloadTemplate() {
    downloadText(`plotterm-list-shablon-${sheetNo.peek()}.svg`, templateSvg(sheetNo.peek()), 'image/svg+xml');
    toast('Распечатайте лист в масштабе 100 % («реальный размер»), заполните ручкой и сфотографируйте целиком сверху.', 'info', 9000);
}
/** Фото заполненного листа-шаблона → варианты букв в шрифт, который сейчас открыт (или в новый). */
/** Метки не попали в кадр: человек сам отмечает на фото четыре угла таблицы. */
const cornerPick = signal(null);
const CORNER_NAMES = ['левый верхний угол таблицы', 'правый верхний', 'правый нижний (под последней полной строкой)', 'левый нижний'];
export async function importTemplatePhoto() {
    const f = await pickFile('image/*');
    if (!f)
        return;
    try {
        importBusy.value = 'Читаю фото листа…';
        const gray = await imageFileToGray(f);
        importBusy.value = 'Ищу метки и снимаю буквы…';
        await new Promise((r) => setTimeout(r, 0));
        const marks = findMarks(gray);
        if (!marks) {
            cornerPick.value = { gray, sheet: sheetNo.peek(), pts: [] };
            toast('Чёрные метки не видны — отметьте на фото четыре угла таблицы с буквами.', 'info', 9000);
            return;
        }
        await applyTemplate(readTemplate(gray, marks, undefined, sheetNo.peek()));
    }
    catch (e) {
        toast('Не получилось прочитать лист: ' + (e?.message ?? e), 'err');
    }
    finally {
        importBusy.value = null;
    }
}
async function applyTemplate(res) {
    if (res.filled < 3)
        throw new Error('на листе почти нет букв — проверьте, что фото резкое и без бликов');
    let rec = editing.peek();
    if (!rec) {
        rec = { id: 'custom-' + Date.now().toString(36), name: 'Мой почерк', baseFontId: 'gost-b', glyphs: {}, letterSpacing: 12, wordSpacing: 110, updatedAt: Date.now() };
    }
    const glyphs = { ...rec.glyphs };
    for (const [ch, vs] of Object.entries(res.glyphs))
        glyphs[ch] = [...(glyphs[ch] ?? []), ...vs];
    rec = { ...rec, glyphs };
    await saveCustomFont(rec);
    editing.value = structuredClone(rec);
    app.typo.patch({ fontId: rec.id });
    toast(`С листа снято ${res.filled} букв, шрифт «${rec.name}» выбран. Каждый новый лист добавляет варианты.`, 'ok', 9000);
}
async function finishCorners() {
    const p = cornerPick.peek();
    if (!p || p.pts.length < 4)
        return;
    try {
        importBusy.value = 'Снимаю буквы…';
        await new Promise((r) => setTimeout(r, 0));
        await applyTemplate(readTemplate(p.gray, p.pts, GRID_CORNERS, p.sheet));
        cornerPick.value = null;
    }
    catch (e) {
        toast('Не получилось прочитать лист: ' + (e?.message ?? e), 'err');
    }
    finally {
        importBusy.value = null;
    }
}
function CornerPicker() {
    const p = cornerPick.peek();
    const k = Math.min(1, 1400 / Math.max(p.gray.w, p.gray.h));
    const w = Math.round(p.gray.w * k), hh = Math.round(p.gray.h * k);
    let canvas;
    const draw = () => {
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(w, hh);
        for (let y = 0; y < hh; y++)
            for (let x = 0; x < w; x++) {
                const v = p.gray.data[Math.floor(y / k) * p.gray.w + Math.floor(x / k)];
                const i = (y * w + x) * 4;
                img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
                img.data[i + 3] = 255;
            }
        ctx.putImageData(img, 0, 0);
        const pts = cornerPick.value?.pts ?? [];
        ctx.strokeStyle = '#e5484d';
        ctx.fillStyle = '#e5484d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
        if (pts.length === 4)
            ctx.closePath();
        ctx.stroke();
        for (const [x, y] of pts) {
            ctx.beginPath();
            ctx.arc(x * k, y * k, 6, 0, Math.PI * 2);
            ctx.fill();
        }
    };
    effect(() => { cornerPick.value; if (canvas)
        draw(); });
    return (h("div", { class: "corner-pick" },
        h(Note, { kind: "info" }, () => {
            const n = cornerPick.value?.pts.length ?? 0;
            return n < 4 ? `Нажмите ${n + 1}-й угол: ${CORNER_NAMES[n]}.` : 'Углы отмечены — можно снимать буквы.';
        }),
        h("canvas", { class: "corner-canvas", width: w, height: hh, ref: (el) => { canvas = el; requestAnimationFrame(draw); }, onPointerDown: (e) => {
                const cur = cornerPick.peek();
                if (!cur || cur.pts.length >= 4)
                    return;
                const r = canvas.getBoundingClientRect();
                const x = ((e.clientX - r.left) / r.width) * w / k, y = ((e.clientY - r.top) / r.height) * hh / k;
                cornerPick.value = { ...cur, pts: [...cur.pts, [x, y]] };
            } }),
        h("div", { class: "row wrap" },
            h(Btn, { small: true, kind: "primary", onClick: finishCorners, disabled: () => (cornerPick.value?.pts.length ?? 0) < 4 || !!importBusy.value }, "\u0421\u043D\u044F\u0442\u044C \u0431\u0443\u043A\u0432\u044B"),
            h(Btn, { small: true, onClick: () => { const c = cornerPick.peek(); if (c)
                    cornerPick.value = { ...c, pts: c.pts.slice(0, -1) }; }, disabled: () => !cornerPick.value?.pts.length }, "\u0423\u0431\u0440\u0430\u0442\u044C \u0442\u043E\u0447\u043A\u0443"),
            h(Btn, { small: true, kind: "ghost", onClick: () => { cornerPick.value = null; } }, "\u041E\u0442\u043C\u0435\u043D\u0430"))));
}
export function HandTab() {
    return (h("div", { class: "tab" },
        h(Section, { title: "\u041C\u043E\u0439 \u043F\u043E\u0447\u0435\u0440\u043A", aside: h(Btn, { small: true, onClick: newFont }, "\u041D\u0430\u0440\u0438\u0441\u043E\u0432\u0430\u0442\u044C \u043D\u043E\u0432\u044B\u0439") },
            () => (importBusy.value ? h(Note, { kind: "info" }, importBusy.value) : null),
            h("div", { class: "muted small" }, "\u041E\u0431\u044B\u0447\u043D\u044B\u0439 \u0448\u0440\u0438\u0444\u0442 (.ttf/.otf/.woff, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 \u0441\u0434\u0435\u043B\u0430\u043D\u043D\u044B\u0439 \u0438\u0437 \u0432\u0430\u0448\u0435\u0433\u043E \u043F\u043E\u0447\u0435\u0440\u043A\u0430 \u0432 Calligraphr) \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0430 \u0441\u0430\u043C\u0430 \u043F\u0435\u0440\u0435\u0432\u0435\u0434\u0451\u0442 \u0432 \u043B\u0438\u043D\u0438\u044E \u043F\u043E \u0446\u0435\u043D\u0442\u0440\u0443 \u0448\u0442\u0440\u0438\u0445\u0430 \u2014 \u043F\u043B\u043E\u0442\u0442\u0435\u0440 \u043F\u0438\u0448\u0435\u0442 \u043E\u0434\u043D\u043E\u0439 \u043B\u0438\u043D\u0438\u0435\u0439, \u0431\u0435\u0437 \u043E\u0431\u0432\u043E\u0434\u043A\u0438 \u043A\u043E\u043D\u0442\u0443\u0440\u0430."),
            h("div", { class: "muted small" }, "\u0415\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0441\u043F\u043E\u0441\u043E\u0431, \u0447\u0442\u043E\u0431\u044B \u043A\u043E\u043D\u0441\u043F\u0435\u043A\u0442 \u0432\u044B\u0433\u043B\u044F\u0434\u0435\u043B \u043D\u0430\u043F\u0438\u0441\u0430\u043D\u043D\u044B\u043C \u0432\u0430\u043C\u0438: \u043D\u0430\u0440\u0438\u0441\u0443\u0439\u0442\u0435 \u0431\u0443\u043A\u0432\u044B \u043C\u044B\u0448\u044C\u044E \u0438\u043B\u0438 \u0441\u0442\u0438\u043B\u0443\u0441\u043E\u043C, \u043A\u0430\u0436\u0434\u0443\u044E 3\u20135 \u0440\u0430\u0437 \u2014 \u043F\u0440\u0438 \u043F\u0435\u0447\u0430\u0442\u0438 \u0432\u0430\u0440\u0438\u0430\u043D\u0442\u044B \u0447\u0435\u0440\u0435\u0434\u0443\u044E\u0442\u0441\u044F. \u041D\u0435\u0434\u043E\u0441\u0442\u0430\u044E\u0449\u0438\u0435 \u0441\u0438\u043C\u0432\u043E\u043B\u044B \u0432\u043E\u0437\u044C\u043C\u0443\u0442\u0441\u044F \u0438\u0437 \u0431\u0430\u0437\u043E\u0432\u043E\u0433\u043E \u0448\u0440\u0438\u0444\u0442\u0430."),
            () => app.customFonts.value.length ? (h("div", { class: "font-list" }, app.customFonts.value.map((f) => (h("span", { class: () => 'font-item' + (editing.value?.id === f.id ? ' on' : '') },
                h("button", { class: "chip", onClick: () => { editing.value = structuredClone(f); strokes.value = []; } },
                    f.name,
                    " \u00B7 ",
                    Object.keys(f.glyphs).length,
                    " \u0441\u0438\u043C\u0432."),
                h("button", { class: "chip", title: "\u041F\u0438\u0441\u0430\u0442\u044C \u044D\u0442\u0438\u043C \u0448\u0440\u0438\u0444\u0442\u043E\u043C", onClick: () => app.typo.patch({ fontId: f.id }) }, () => (app.typo.value.fontId === f.id ? '✓ выбран' : 'выбрать')),
                h("button", { class: "icon-btn", title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0448\u0440\u0438\u0444\u0442", onClick: () => { if (confirm(`Удалить шрифт «${f.name}»?`)) {
                        deleteCustomFont(f.id);
                        if (editing.peek()?.id === f.id)
                            editing.value = null;
                    } } },
                    h(Icon, { name: "trash", size: 14 }))))))) : null,
            h("div", { class: "row wrap" },
                h(Btn, { small: true, kind: "primary", onClick: importFont, disabled: () => !!importBusy.value, title: ".ttf, .otf, .woff \u2014 \u043B\u044E\u0431\u043E\u0439 \u0448\u0440\u0438\u0444\u0442; .svg \u2014 \u043E\u0434\u043D\u043E\u043B\u0438\u043D\u0435\u0439\u043D\u044B\u0439 (Hershey Text, EMS); .json \u2014 \u044D\u043A\u0441\u043F\u043E\u0440\u0442 Plotterm" },
                    h(Icon, { name: "upload", size: 14 }),
                    " \u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0448\u0440\u0438\u0444\u0442 (.ttf .otf .woff)"),
                () => (editing.value ? h(Btn, { small: true, kind: "ghost", onClick: exportFont },
                    h(Icon, { name: "download", size: 14 }),
                    " \u042D\u043A\u0441\u043F\u043E\u0440\u0442") : null)),
            h("div", { class: "muted small" }, "\u041F\u0440\u043E\u0449\u0435 \u0432\u0441\u0435\u0433\u043E \u2014 \u043B\u0438\u0441\u0442-\u0448\u0430\u0431\u043B\u043E\u043D: \u0440\u0430\u0441\u043F\u0435\u0447\u0430\u0442\u0430\u0442\u044C, \u043D\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u043F\u043E \u0431\u0443\u043A\u0432\u0435 \u0432 \u043A\u043B\u0435\u0442\u043A\u0435 \u0441\u0432\u043E\u0435\u0439 \u0440\u0443\u0447\u043A\u043E\u0439, \u0441\u0444\u043E\u0442\u043E\u0433\u0440\u0430\u0444\u0438\u0440\u043E\u0432\u0430\u0442\u044C. \u041A\u0430\u0436\u0434\u044B\u0439 \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u043D\u044B\u0439 \u043B\u0438\u0441\u0442 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u0442 \u0435\u0449\u0451 \u043E\u0434\u0438\u043D \u0432\u0430\u0440\u0438\u0430\u043D\u0442 \u043A\u0430\u0436\u0434\u043E\u0439 \u0431\u0443\u043A\u0432\u044B."),
            h(Segmented, { small: true, value: () => sheetNo.value, onChange: (v) => { sheetNo.value = v; }, options: [{ value: 1, label: 'Лист 1 · кириллица' }, { value: 2, label: 'Лист 2 · латиница, формулы' }] }),
            h("div", { class: "row wrap" },
                h(Btn, { small: true, onClick: downloadTemplate },
                    h(Icon, { name: "download", size: 14 }),
                    " \u041B\u0438\u0441\u0442-\u0448\u0430\u0431\u043B\u043E\u043D \u04104"),
                h(Btn, { small: true, kind: "primary", onClick: importTemplatePhoto, disabled: () => !!importBusy.value, title: "JPEG \u0438\u043B\u0438 PNG; \u043B\u0438\u0441\u0442 \u0446\u0435\u043B\u0438\u043A\u043E\u043C, \u0447\u0435\u0442\u044B\u0440\u0435 \u0447\u0451\u0440\u043D\u044B\u0435 \u043C\u0435\u0442\u043A\u0438 \u043F\u043E \u0443\u0433\u043B\u0430\u043C \u0434\u043E\u043B\u0436\u043D\u044B \u0431\u044B\u0442\u044C \u0432\u0438\u0434\u043D\u044B" },
                    h(Icon, { name: "upload", size: 14 }),
                    " \u0424\u043E\u0442\u043E \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u043D\u043E\u0433\u043E \u043B\u0438\u0441\u0442\u0430")),
            () => (cornerPick.value ? h(CornerPicker, null) : null)),
        () => hasEditing.value ? (h(Section, { title: () => `Рисуем: «${editing.value?.name ?? ''}»` },
            h(Segmented, { small: true, value: () => group.value, onChange: (v) => { group.value = v; ch.value = [...GROUPS[v]][0]; strokes.value = []; }, options: GROUP_NAMES }),
            h("div", { class: "char-grid" }, () => [...GROUPS[group.value]].map((c) => {
                const n = editing.value?.glyphs[c]?.length ?? 0;
                return (h("button", { class: () => 'char' + (ch.value === c ? ' on' : '') + (n ? ' has' : ''), onClick: () => { ch.value = c; strokes.value = []; } },
                    c,
                    n ? h("sup", null, n) : null));
            })),
            h("div", { class: "editor-head" },
                h("span", { class: "big-char" }, () => ch.value),
                h("span", { class: "muted small" }, "\u0421\u0435\u0440\u044B\u0439 \u2014 \u043E\u0431\u0440\u0430\u0437\u0435\u0446. \u0420\u0438\u0441\u0443\u0439\u0442\u0435 \u043F\u043E\u0432\u0435\u0440\u0445, \u0431\u0443\u043A\u0432\u0430 \u0441\u0442\u043E\u0438\u0442 \u043D\u0430 \u0431\u0430\u0437\u043E\u0432\u043E\u0439 \u043B\u0438\u043D\u0438\u0438.")),
            h(Editor, null),
            h("div", { class: "row wrap" },
                h(Btn, { small: true, onClick: () => (strokes.value = strokes.peek().slice(0, -1)) },
                    h(Icon, { name: "undo", size: 14 }),
                    " \u0428\u0442\u0440\u0438\u0445"),
                h(Btn, { small: true, onClick: () => (strokes.value = []) }, "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C"),
                h(Btn, { small: true, kind: "primary", onClick: saveVariant }, "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0432\u0430\u0440\u0438\u0430\u043D\u0442"),
                h(Btn, { small: true, kind: "ghost", onClick: nextChar }, "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0430\u044F \u2192")),
            h("div", { class: "variants" }, () => (editing.value?.glyphs[ch.value] ?? []).map((g, i) => (h("span", { class: "variant" },
                glyphSvg(g),
                h("button", { class: "icon-btn", title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u0430\u0440\u0438\u0430\u043D\u0442", onClick: () => deleteVariant(i) },
                    h(Icon, { name: "trash", size: 12 })))))),
            h("div", { class: "grid2" },
                h(Field, { label: "\u041C\u0435\u0436\u0434\u0443 \u0431\u0443\u043A\u0432\u0430\u043C\u0438", hint: "\u0435\u0434\u0438\u043D\u0438\u0446 (x-\u0432\u044B\u0441\u043E\u0442\u0430 = 100)" },
                    h(NumInput, { value: () => editing.value?.letterSpacing ?? 12, onChange: (v) => { const r = editing.peek(); editing.value = { ...r, letterSpacing: v }; persist(); }, min: -20, max: 80, step: 1 })),
                h(Field, { label: "\u041F\u0440\u043E\u0431\u0435\u043B" },
                    h(NumInput, { value: () => editing.value?.wordSpacing ?? 45, onChange: (v) => { const r = editing.peek(); editing.value = { ...r, wordSpacing: v }; persist(); }, min: 10, max: 200, step: 1 })),
                h(Field, { label: "\u0411\u0430\u0437\u043E\u0432\u044B\u0439 \u0448\u0440\u0438\u0444\u0442", hint: "\u0434\u043B\u044F \u043D\u0435\u0434\u043E\u0441\u0442\u0430\u044E\u0449\u0438\u0445 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432" },
                    h(Select, { value: () => editing.value?.baseFontId ?? 'gost-a', onChange: (v) => { const r = editing.peek(); editing.value = { ...r, baseFontId: v }; persist(); }, options: BUILTIN_FONTS.map((f) => ({ value: f.id, label: f.name })) }))),
            () => {
                const r = editing.value;
                const need = [...(GROUPS.lower + GROUPS.upper)].filter((c) => !(r.glyphs[c]?.length));
                return need.length ? (h(Note, { kind: "info" },
                    "\u0415\u0449\u0451 \u043D\u0435 \u043D\u0430\u0440\u0438\u0441\u043E\u0432\u0430\u043D\u043E: ",
                    need.length,
                    " \u0431\u0443\u043A\u0432. \u0418\u0445 \u0432\u043E\u0437\u044C\u043C\u0451\u0442 \u0431\u0430\u0437\u043E\u0432\u044B\u0439 \u0448\u0440\u0438\u0444\u0442 \u2014 \u0441\u043C\u0435\u0448\u0435\u043D\u0438\u0435 \u0441\u0442\u0438\u043B\u0435\u0439 \u0431\u0443\u0434\u0435\u0442 \u0437\u0430\u043C\u0435\u0442\u043D\u043E.")) : (h(Note, { kind: "ok" }, "\u0412\u0441\u0435 \u0440\u0443\u0441\u0441\u043A\u0438\u0435 \u0431\u0443\u043A\u0432\u044B \u043D\u0430\u0440\u0438\u0441\u043E\u0432\u0430\u043D\u044B."));
            })) : null));
}
