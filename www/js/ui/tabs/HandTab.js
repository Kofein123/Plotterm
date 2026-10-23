// «Мой почерк»: рисуете буквы мышью или стилусом, по 3–5 вариантов каждой; недостающие берутся из базового шрифта.
import { h } from "../dom.js";
import { signal, effect, computed } from "../reactive.js";
import { app, saveCustomFont, deleteCustomFont } from "../../app/state.js";
import { BUILTIN_FONTS, CUSTOM_X_HEIGHT, resolveGlyph } from "../../fonts/fonts.js";
import { Btn, Field, Icon, NumInput, Note, Section, Select, Segmented } from "../components.js";
import { downloadText, pickFile, toast } from "../../app/notify.js";
import { importSvgFont } from "../../io/svgfont.js";
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
async function importFont() {
    const f = await pickFile('.json,.svg');
    if (!f)
        return;
    try {
        let rec;
        if (f.name.toLowerCase().endsWith('.svg')) {
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
        toast(`Шрифт «${rec.name}» добавлен: ${Object.keys(rec.glyphs).length} символов.`, 'ok');
    }
    catch (e) {
        toast('Не удалось импортировать: ' + (e?.message ?? e), 'err');
    }
}
export function HandTab() {
    return (h("div", { class: "tab" },
        h(Section, { title: "\u041C\u043E\u0439 \u043F\u043E\u0447\u0435\u0440\u043A", aside: h(Btn, { small: true, kind: "primary", onClick: newFont }, "\u041D\u043E\u0432\u044B\u0439") },
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
                h(Btn, { small: true, kind: "ghost", onClick: importFont, title: "\u0424\u0430\u0439\u043B .json \u043E\u0442 Plotterm \u0438\u043B\u0438 \u043E\u0434\u043D\u043E\u043B\u0438\u043D\u0435\u0439\u043D\u044B\u0439 SVG-\u0448\u0440\u0438\u0444\u0442 (Hershey Text, EMS)" },
                    h(Icon, { name: "upload", size: 14 }),
                    " \u0418\u043C\u043F\u043E\u0440\u0442 \u0448\u0440\u0438\u0444\u0442\u0430"),
                () => (editing.value ? h(Btn, { small: true, kind: "ghost", onClick: exportFont },
                    h(Icon, { name: "download", size: 14 }),
                    " \u042D\u043A\u0441\u043F\u043E\u0440\u0442") : null))),
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
