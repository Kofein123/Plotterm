import { h, listen } from "./dom.js";
import { app } from "../app/state.js";
import { toasts } from "../app/notify.js";
import { startPrint, jogStep, jogZ, jogContinuousStart, jogContinuousStop } from "../app/actions.js";
import { Preview } from "./Preview.js";
import { ControlPanel, statusLabel } from "./ControlPanel.js";
import { Icon } from "./components.js";
import { TextTab } from "./tabs/TextTab.js";
import { FontTab } from "./tabs/FontTab.js";
import { PaperTab } from "./tabs/PaperTab.js";
import { PenTab } from "./tabs/PenTab.js";
import { CalibTab } from "./tabs/CalibTab.js";
import { HandTab } from "./tabs/HandTab.js";
import { ConsoleTab } from "./tabs/ConsoleTab.js";
import { MoreTab } from "./tabs/MoreTab.js";
const TABS = [
    { id: 'text', label: 'Текст', icon: 'text', view: TextTab },
    { id: 'font', label: 'Шрифт', icon: 'font', view: FontTab },
    { id: 'paper', label: 'Бумага', icon: 'paper', view: PaperTab },
    { id: 'pen', label: 'Ручка', icon: 'pen', view: PenTab },
    { id: 'calib', label: 'Калибровка', icon: 'target', view: CalibTab },
    { id: 'hand', label: 'Мой почерк', icon: 'hand', view: HandTab },
    { id: 'console', label: 'Терминал', icon: 'terminal', view: ConsoleTab },
    { id: 'more', label: 'Ещё', icon: 'more', view: MoreTab },
];
function StatusBar() {
    const m = app.machine;
    const stateClass = () => {
        if (m.conn.value !== 'connected')
            return 'off';
        return { Idle: 'idle', Run: 'run', Jog: 'run', Hold: 'hold', Alarm: 'alarm', Door: 'alarm' }[m.state.value] ?? 'off';
    };
    const calibText = () => {
        const c = app.calib.value;
        if (c.stale)
            return { cls: 'warn', text: 'Ноль мог сбиться' };
        if (c.penSet && c.zeroSet && c.cornerSet)
            return { cls: 'ok', text: 'Откалибровано' };
        return { cls: 'warn', text: 'Нужна калибровка' };
    };
    return (h("header", { class: "topbar" },
        h("div", { class: "brand" },
            h("svg", { width: "26", height: "26", viewBox: "0 0 32 32", "aria-hidden": "true" },
                h("rect", { x: "3", y: "5", width: "26", height: "22", rx: "3", fill: "none", stroke: "currentColor", "stroke-width": "2" }),
                h("path", { d: "M8 20c3-6 5-8 7-3s4 3 6-2 3-4 3-4", fill: "none", stroke: "var(--accent)", "stroke-width": "2.4", "stroke-linecap": "round" })),
            h("span", null, "Plotterm")),
        h("span", { class: () => 'pill state-' + stateClass() },
            h("span", { class: "dot" }),
            () => (m.conn.value === 'connected' ? stateRu(m.state.value) : m.conn.value === 'connecting' ? 'Подключение…' : 'Не подключено')),
        h("button", { class: () => 'pill calib-' + calibText().cls, onClick: () => app.prefs.patch({ leftTab: 'calib' }), title: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0443" }, () => calibText().text),
        () => {
            const s = app.job.status.value;
            return s !== 'idle' ? h("span", { class: "pill job" }, statusLabel(s)) : null;
        },
        h("span", { class: "spacer" }),
        () => m.conn.value === 'connected' ? (h("span", { class: "topbar-pos" },
            h("span", null,
                "X ",
                h("b", null, () => m.wpos.value[0].toFixed(1))),
            h("span", null,
                "Y ",
                h("b", null, () => m.wpos.value[1].toFixed(1))),
            h("span", null,
                "Z ",
                h("b", null, () => m.wpos.value[2].toFixed(2))),
            h("span", null,
                "F ",
                h("b", null, () => Math.round(m.feedRate.value))))) : null));
}
function stateRu(s) {
    return { Idle: 'Ожидание', Run: 'Работа', Hold: 'Пауза', Jog: 'Перемещение', Alarm: 'ALARM', Door: 'Дверь', Check: 'Проверка', Home: 'Хоминг', Sleep: 'Сон' }[s] ?? '…';
}
function LeftPanel() {
    const tab = () => app.prefs.value.leftTab;
    return (h("aside", { class: "left" },
        h("nav", { class: "tabs", role: "tablist" }, TABS.map((t) => (h("button", { role: "tab", class: () => 'tab-btn' + (tab() === t.id ? ' on' : ''), "aria-selected": () => String(tab() === t.id), onClick: () => app.prefs.patch({ leftTab: t.id }), title: t.label },
            h(Icon, { name: t.icon, size: 18 }),
            h("span", null, t.label))))),
        h("div", { class: "tab-scroll" }, () => {
            const t = TABS.find((x) => x.id === tab()) ?? TABS[0];
            return t.view();
        })));
}
function Toasts() {
    return (h("div", { class: "toasts", "aria-live": "polite" }, () => toasts.value.map((t) => h("div", { class: 'toast toast-' + t.kind }, t.text))));
}
function isTyping(e) {
    const el = e.target;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
function hotkeys() {
    const held = new Set();
    const continuous = new Set();
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    listen(window, 'keydown', (e) => {
        const job = app.job;
        if (e.key === 'Escape' && app.machine.connected) {
            // СТОП работает всегда, даже из поля ввода
            e.preventDefault();
            job.stop();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
            e.preventDefault();
            if (!job.active)
                startPrint({ kind: 'all' });
            return;
        }
        if (isTyping(e))
            return;
        if (e.key === ' ') {
            const s = job.status.peek();
            if (s === 'running') {
                e.preventDefault();
                job.pause();
            }
            else if (s === 'paused' || s === 'pausing') {
                e.preventDefault();
                job.resume();
            }
            else if (s === 'sheet') {
                e.preventDefault();
                job.nextSheet();
            }
            return;
        }
        if (dirs[e.key]) {
            e.preventDefault();
            if (e.repeat)
                return;
            const [du, dv] = dirs[e.key];
            const step = app.prefs.peek().jogStep;
            const key = e.key;
            held.add(key);
            if (step === 0) {
                continuous.add(key);
                jogContinuousStart(du, dv);
            }
            else {
                jogStep(du * step, dv * step);
                // удержание дольше 0,45 с — непрерывное движение
                setTimeout(() => {
                    if (held.has(key)) {
                        continuous.add(key);
                        jogContinuousStart(du, dv);
                    }
                }, 450);
            }
            return;
        }
        if (e.key === 'PageUp') {
            e.preventDefault();
            jogZ(app.prefs.peek().zStep);
        }
        if (e.key === 'PageDown') {
            e.preventDefault();
            jogZ(-app.prefs.peek().zStep);
        }
    });
    listen(window, 'keyup', (e) => {
        if (dirs[e.key] && held.has(e.key)) {
            held.delete(e.key);
            if (continuous.delete(e.key))
                jogContinuousStop();
        }
    });
    listen(window, 'blur', () => {
        if (continuous.size)
            jogContinuousStop();
        held.clear();
        continuous.clear();
    });
    listen(window, 'beforeunload', (e) => {
        if (app.job.active) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}
export function App() {
    hotkeys();
    return (h("div", { class: "app" },
        h(StatusBar, null),
        h("main", { class: "main" },
            h(LeftPanel, null),
            h(Preview, null),
            h(ControlPanel, null)),
        h(Toasts, null)));
}
