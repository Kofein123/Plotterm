// Базовые элементы интерфейса.
import { h, Fragment } from "./dom.js";
void Fragment;
export function Field(props) {
    return (h("label", { class: 'field' + (props.wide ? ' field-wide' : '') },
        h("span", { class: "field-label" }, props.label),
        h("span", { class: "field-control" }, props.children),
        props.hint ? h("span", { class: "field-hint" }, props.hint) : null));
}
export function NumInput(props) {
    return (h("span", { class: "num" },
        h("input", { type: "number", inputmode: "decimal", value: () => String(round(props.value(), 3)), min: props.min, max: props.max, step: props.step ?? 'any', disabled: props.disabled, style: props.width ? `width:${props.width}px` : undefined, onChange: (e) => {
                const v = parseFloat(e.target.value.replace(',', '.'));
                if (!Number.isFinite(v))
                    return;
                let x = v;
                if (props.min !== undefined)
                    x = Math.max(props.min, x);
                if (props.max !== undefined)
                    x = Math.min(props.max, x);
                props.onChange(x);
                e.target.value = String(round(x, 3));
            } }),
        props.unit ? h("span", { class: "unit" }, props.unit) : null));
}
export function Slider(props) {
    return (h("span", { class: "slider" },
        h("input", { type: "range", min: props.min, max: props.max, step: props.step ?? 1, value: () => String(props.value()), onInput: (e) => props.onInput(parseFloat(e.target.value)) }),
        h("span", { class: "slider-value" }, () => (props.format ? props.format(props.value()) : String(props.value())))));
}
export function Select(props) {
    const opts = () => (typeof props.options === 'function' ? props.options() : props.options);
    return (h("select", { onChange: (e) => {
            const raw = e.target.value;
            const found = opts().find((o) => String(o.value) === raw);
            if (found)
                props.onChange(found.value);
        }, ref: (el) => {
            // перерисовка опций и выбор значения
            queueMicrotask(() => (el.value = String(props.value())));
        } }, () => {
        const cur = String(props.value());
        return opts().map((o) => (h("option", { value: String(o.value), selected: String(o.value) === cur }, o.label)));
    }));
}
export function Segmented(props) {
    return (h("span", { class: 'seg' + (props.small ? ' seg-small' : ''), role: "radiogroup" }, props.options.map((o) => (h("button", { type: "button", role: "radio", title: o.title, class: () => (props.value() === o.value ? 'on' : ''), "aria-checked": () => String(props.value() === o.value), onClick: () => props.onChange(o.value) }, o.label)))));
}
export function Toggle(props) {
    return (h("label", { class: "toggle", title: props.hint },
        h("input", { type: "checkbox", checked: props.value, onChange: (e) => props.onChange(e.target.checked) }),
        h("span", { class: "toggle-track", "aria-hidden": "true" },
            h("span", { class: "toggle-thumb" })),
        h("span", null, props.label)));
}
export function Btn(props) {
    return (h("button", { type: "button", class: `btn btn-${props.kind ?? 'default'}${props.small ? ' btn-small' : ''}${props.class ? ' ' + props.class : ''}`, disabled: props.disabled, title: props.title, onClick: props.onClick }, props.children));
}
export function Section(props) {
    return (h("section", { class: "section" },
        h("header", { class: "section-head" },
            h("h3", null, props.title),
            props.aside ?? null),
        h("div", { class: "section-body" }, props.children)));
}
export function Note(props) {
    return h("div", { class: 'note note-' + (props.kind ?? 'info') }, props.children);
}
/** Получить/записать поле объекта в сигнале. */
export function bind(sig, key) {
    return {
        get: () => sig.value[key],
        set: (v) => sig.patch({ [key]: v }),
    };
}
export function round(v, d = 2) {
    const k = 10 ** d;
    return Math.round(v * k) / k;
}
export function Icon(props) {
    const s = props.size ?? 18;
    const paths = {
        plug: 'M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5',
        print: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
        pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
        play: 'M6 4l14 8-14 8z',
        stop: 'M5 5h14v14H5z',
        up: 'M12 19V5M5 12l7-7 7 7',
        down: 'M12 5v14M5 12l7 7 7-7',
        left: 'M19 12H5M12 5l-7 7 7 7',
        right: 'M5 12h14M12 5l7 7-7 7',
        home: 'M3 11l9-8 9 8M5 10v10h14V10',
        text: 'M4 6h16M4 12h16M4 18h10',
        font: 'M4 20l6-16h2l6 16M7 14h8',
        paper: 'M6 2h9l5 5v15H6zM14 2v6h6',
        pen: 'M3 21l3-1 12-12-2-2L4 18zM14 6l2-2 4 4-2 2',
        target: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
        hand: 'M4 20c4-1 6-4 8-9s3-7 5-7 2 3 0 6-6 6-6 10',
        terminal: 'M4 5l6 7-6 7M12 19h8',
        more: 'M5 12h.01M12 12h.01M19 12h.01',
        upload: 'M12 16V4M6 10l6-6 6 6M4 20h16',
        download: 'M12 4v12M6 10l6 6 6-6M4 20h16',
        unlock: 'M7 11V7a5 5 0 0 1 9.6-2M5 11h14v10H5z',
        frame: 'M3 3h18v18H3z',
        zoom: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
        dice: 'M4 4h16v16H4zM8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01',
        check: 'M4 12l5 5L20 6',
        warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
        sim: 'M3 5h18v12H3zM8 21h8M12 17v4',
        undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
        trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    };
    return (h("svg", { class: "icon", width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
        h("path", { d: paths[props.name] ?? '' })));
}
