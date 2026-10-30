// Правая панель: подключение, ПЕЧАТЬ / Пауза / СТОП, прогресс, скорость на ходу, ручное управление.
import { h } from "./dom.js";
import { signal } from "./reactive.js";
import { app } from "../app/state.js";
import { connectSerial, connectSimulator, disconnect, hasWebSerial, startPrint, printBlockers, resumeJob, unlock, traceJob, } from "../app/actions.js";
import { Btn, Icon, Segmented, Toggle, Slider } from "./components.js";
import { Jog } from "./Jog.js";
import { fmtTime } from "../app/notify.js";
const range = signal('all');
const fromPage = signal(1);
const lineFrom = signal(1);
const lineTo = signal(1);
// номера строк показываем в предпросмотре, пока выбран режим «Строки»
const syncLines = () => (app.printLines.value = range.peek() === 'lines' ? [lineFrom.peek(), Math.max(lineFrom.peek(), lineTo.peek())] : null);
const ovTarget = signal(100);
let ovTimer;
function rangeValue() {
    const r = range.peek();
    if (r === 'from')
        return { kind: 'from', page: Math.max(0, fromPage.peek() - 1) };
    if (r === 'lines')
        return { kind: 'lines', from: lineFrom.peek(), to: Math.max(lineFrom.peek(), lineTo.peek()) };
    return { kind: r };
}
function Connection() {
    const m = app.machine;
    return (h("div", { class: "card conn" },
        () => m.conn.value === 'connected' ? (h("div", { class: "conn-row" },
            h("span", { class: "conn-dot on" }),
            h("span", { class: "conn-label" },
                () => m.transportLabel.value,
                h("small", null, () => (m.version.value ? 'GRBL ' + m.version.value : ''))),
            h(Btn, { small: true, kind: "ghost", onClick: () => disconnect() }, "\u041E\u0442\u043A\u043B\u044E\u0447\u0438\u0442\u044C"))) : m.conn.value === 'connecting' ? (h("div", { class: "conn-row" },
            h("span", { class: "conn-dot wait" }),
            " \u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435\u2026")) : (h("div", { class: "conn-actions" },
            h(Btn, { kind: "primary", class: "btn-block", onClick: () => connectSerial(), disabled: () => !hasWebSerial(), title: "USB (CH340) \u0438\u043B\u0438 Bluetooth COM-\u043F\u043E\u0440\u0442" },
                h(Icon, { name: "plug" }),
                " \u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u043F\u043B\u043E\u0442\u0442\u0435\u0440"),
            h(Btn, { kind: "ghost", small: true, onClick: () => connectSimulator(), title: "\u0412\u0438\u0440\u0442\u0443\u0430\u043B\u044C\u043D\u0430\u044F \u043F\u043B\u0430\u0442\u0430: \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0432\u0441\u0451 \u0431\u0435\u0437 \u0436\u0435\u043B\u0435\u0437\u0430" },
                h(Icon, { name: "sim", size: 16 }),
                " \u0421\u0438\u043C\u0443\u043B\u044F\u0442\u043E\u0440"),
            !hasWebSerial() ? h("div", { class: "note note-warn small" }, "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0432 Google Chrome \u0438\u043B\u0438 Microsoft Edge \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u043E\u043D\u0438 \u0443\u043C\u0435\u044E\u0442 \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0441 USB.") : null)),
        () => m.alarm.value ? (h("div", { class: "alarm" },
            h(Icon, { name: "warn", size: 16 }),
            h("span", null, () => m.alarm.value),
            h(Btn, { small: true, kind: "danger", onClick: () => unlock() },
                h(Icon, { name: "unlock", size: 14 }),
                " \u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C"))) : null));
}
function PrintBlock() {
    const job = app.job;
    const blockers = () => printBlockers();
    return (h("div", { class: "card print" },
        h("button", { class: "print-btn", disabled: () => blockers().length > 0, title: () => blockers().join('\n'), onClick: () => startPrint(rangeValue()) },
            h(Icon, { name: "print", size: 26 }),
            h("span", null,
                () => (app.dryRun.value ? 'СУХОЙ ПРОГОН' : 'ПЕЧАТЬ'),
                h("small", null, () => {
                    const n = app.pageCount.value;
                    const t = app.totalEstimate.value;
                    return n ? `${n} стр. · ≈ ${fmtTime(t)}` : 'нет текста';
                }))),
        () => {
            const b = blockers();
            return b.length ? (h("ul", { class: "blockers" }, b.map((x) => h("li", null, x)))) : null;
        },
        h("div", { class: "print-opts" },
            h(Segmented, { small: true, value: () => range.value, onChange: (v) => { range.value = v; syncLines(); }, options: [{ value: 'all', label: 'Все' }, { value: 'current', label: 'Текущую' }, { value: 'from', label: 'С стр.' }, { value: 'lines', label: 'Строки' }] }),
            () => range.value === 'from' ? (h("input", { class: "mini-num", type: "number", min: "1", value: () => String(fromPage.value), onChange: (e) => (fromPage.value = Math.max(1, parseInt(e.target.value) || 1)) })) : range.value === 'lines' ? (h("span", { class: "row", title: "\u041D\u043E\u043C\u0435\u0440\u0430 \u0441\u0442\u0440\u043E\u043A \u0432\u0438\u0434\u043D\u044B \u0441\u043B\u0435\u0432\u0430 \u043D\u0430 \u043B\u0438\u0441\u0442\u0435. \u041F\u0435\u0447\u0430\u0442\u0430\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0442\u0435\u043A\u0441\u0442 \u044D\u0442\u0438\u0445 \u0441\u0442\u0440\u043E\u043A \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B, \u043D\u0430 \u0441\u0432\u043E\u0451\u043C \u043C\u0435\u0441\u0442\u0435" },
                h("span", { class: "small" }, "\u0441"),
                h("input", { class: "mini-num", type: "number", min: "1", value: () => String(lineFrom.value), onChange: (e) => { lineFrom.value = Math.max(1, parseInt(e.target.value) || 1); syncLines(); } }),
                h("span", { class: "small" }, "\u043F\u043E"),
                h("input", { class: "mini-num", type: "number", min: "1", value: () => String(lineTo.value), onChange: (e) => { lineTo.value = Math.max(1, parseInt(e.target.value) || 1); syncLines(); } }))) : null),
        h("div", { class: "print-opts" },
            h(Toggle, { value: () => app.dryRun.value, onChange: (v) => (app.dryRun.value = v), label: "\u0421\u0443\u0445\u043E\u0439 \u043F\u0440\u043E\u0433\u043E\u043D", hint: "\u041F\u0440\u043E\u0439\u0442\u0438 \u0432\u0441\u0451 \u0437\u0430\u0434\u0430\u043D\u0438\u0435 \u0441 \u043F\u043E\u0434\u043D\u044F\u0442\u043E\u0439 \u0440\u0443\u0447\u043A\u043E\u0439 \u2014 \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0440\u0430\u0437\u043C\u0435\u0449\u0435\u043D\u0438\u0435" }),
            h(Btn, { small: true, kind: "ghost", onClick: () => traceJob(), disabled: () => app.machine.conn.value !== 'connected' || job.active, title: "\u041E\u0431\u0432\u0435\u0441\u0442\u0438 \u0440\u0430\u043C\u043A\u0443 \u0437\u0430\u0434\u0430\u043D\u0438\u044F \u043F\u043E\u0434\u043D\u044F\u0442\u043E\u0439 \u0440\u0443\u0447\u043A\u043E\u0439" },
                h(Icon, { name: "frame", size: 14 }),
                " \u0420\u0430\u043C\u043A\u0430"))));
}
function RunBlock() {
    const job = app.job;
    const st = () => job.status.value;
    return (h("div", { class: "card run" },
        h("div", { class: "run-head" },
            h("b", null, () => statusLabel(st())),
            h("span", { class: "muted" }, () => job.title.value)),
        h("div", { class: "progress" },
            h("div", { class: "progress-bar", style: () => `width:${(job.progress.value * 100).toFixed(1)}%` })),
        h("div", { class: "run-meta" },
            h("span", null, () => `${Math.round(job.progress.value * 100)}%`),
            h("span", null, () => {
                const plan = job.plan;
                const k = job.currentStroke.value;
                const line = plan && k >= 0 ? plan.strokeLine[Math.min(k, plan.strokeLine.length - 1)] : 0;
                const pg = job.pages[job.pageIdx.value];
                return pg ? `стр. ${pg.pageNo + 1} (${job.pageIdx.value + 1}/${job.pages.length})${line ? ', строка ' + line : ''}` : '';
            }),
            h("span", { title: "\u043F\u0440\u043E\u0448\u043B\u043E / \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C" }, () => `${fmtTime(job.elapsed.value)} / ≈${fmtTime(job.eta.value)}`)),
        () => (job.message.value ? h("div", { class: "run-msg" }, job.message.value) : null),
        h("div", { class: "run-btns" },
            () => st() === 'running' ? (h(Btn, { onClick: () => job.pause(), title: "\u041F\u0430\u0443\u0437\u0430 \u043F\u043E\u0441\u043B\u0435 \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u0448\u0442\u0440\u0438\u0445\u0430 (\u043F\u0440\u043E\u0431\u0435\u043B)" },
                h(Icon, { name: "pause" }),
                " \u041F\u0430\u0443\u0437\u0430")) : st() === 'paused' || st() === 'pausing' ? (h(Btn, { kind: "ok", onClick: () => job.resume(), title: "\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C (\u043F\u0440\u043E\u0431\u0435\u043B)" },
                h(Icon, { name: "play" }),
                " \u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C")) : st() === 'sheet' ? (h(Btn, { kind: "ok", onClick: () => job.nextSheet() },
                h(Icon, { name: "play" }),
                " \u041B\u0438\u0441\u0442 \u0437\u0430\u043C\u0435\u043D\u0451\u043D, \u0434\u0430\u043B\u044C\u0448\u0435")) : null,
            h(Btn, { kind: "danger", class: "stop-btn", onClick: () => job.stop(), disabled: () => st() === 'stopping', title: "\u0421\u0422\u041E\u041F: \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C, \u043F\u043E\u0434\u043D\u044F\u0442\u044C \u0440\u0443\u0447\u043A\u0443 (Esc)" },
                h(Icon, { name: "stop" }),
                " \u0421\u0422\u041E\u041F")),
        h("div", { class: "ov" },
            h("span", { class: "muted" }, "\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u043D\u0430 \u0445\u043E\u0434\u0443"),
            h(Slider, { min: 50, max: 150, step: 10, value: () => ovTarget.value, onInput: (v) => {
                    ovTarget.value = v;
                    clearTimeout(ovTimer);
                    ovTimer = setTimeout(() => app.machine.setFeedOverride(ovTarget.peek()), 150);
                }, format: (v) => v + '%' }))));
}
function ResumeBlock() {
    const job = app.job;
    return (h("div", { class: "card resume" },
        h("div", null,
            h("b", null, () => statusLabel(job.status.value))),
        () => (job.message.value ? h("div", { class: "run-msg" }, job.message.value) : null),
        h("div", { class: "run-btns" },
            () => job.resumePoint.value && job.status.value !== 'done' ? (h(Btn, { kind: "primary", onClick: () => resumeJob(), disabled: () => app.machine.conn.value !== 'connected' },
                h(Icon, { name: "play" }),
                " \u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C \u0441 \u043C\u0435\u0441\u0442\u0430 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0438")) : null,
            h(Btn, { kind: "ghost", small: true, onClick: () => job.reset() }, "\u0417\u0430\u043A\u0440\u044B\u0442\u044C"))));
}
export function statusLabel(s) {
    return {
        idle: 'Готов', running: 'Печатает', pausing: 'Пауза…', paused: 'Пауза', sheet: 'Смените лист', stopping: 'Остановка…',
        stopped: 'Остановлено', done: 'Готово', error: 'Ошибка', interrupted: 'Связь прервалась',
    }[s] ?? s;
}
export function ControlPanel() {
    const job = app.job;
    return (h("aside", { class: "right" },
        h(Connection, null),
        () => {
            const s = job.status.value;
            if (s === 'running' || s === 'pausing' || s === 'paused' || s === 'sheet' || s === 'stopping')
                return h(RunBlock, null);
            if (s === 'stopped' || s === 'error' || s === 'interrupted' || s === 'done')
                return [h(ResumeBlock, null), h(PrintBlock, null)];
            return h(PrintBlock, null);
        },
        h("div", { class: "card" },
            h("div", { class: "card-title" }, "\u0420\u0443\u0447\u043D\u043E\u0435 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435"),
            h(Jog, null))));
}
