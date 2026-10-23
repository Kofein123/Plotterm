// Журнал и терминал GRBL: свои команды, история, $-настройки с пояснениями.
import { h } from "../dom.js";
import { signal, effect } from "../reactive.js";
import { app } from "../../app/state.js";
import { SETTING_INFO } from "../../grbl/protocol.js";
import { writeSetting, backupSettings } from "../../app/actions.js";
import { Btn, Icon, Section, Segmented } from "../components.js";
import { downloadText, stamp, toast } from "../../app/notify.js";
const history = (() => {
    try {
        return JSON.parse(localStorage.getItem('plotterm:history') ?? '[]');
    }
    catch {
        return [];
    }
})();
let hIdx = history.length;
const view = signal('log');
async function run(cmd) {
    cmd = cmd.trim();
    if (!cmd)
        return;
    if (!app.machine.connected)
        return toast('Нет связи с платой.', 'warn');
    history.push(cmd);
    while (history.length > 50)
        history.shift();
    hIdx = history.length;
    try {
        localStorage.setItem('plotterm:history', JSON.stringify(history));
    }
    catch { /* ignore */ }
    if (/^\$\d+=/.test(cmd) && !confirm(`Изменить настройку платы ${cmd}? Перед этим лучше сохранить копию ($$).`))
        return;
    if (cmd === '?' || cmd === '!' || cmd === '~') {
        await app.machine.realtime(cmd);
        return;
    }
    try {
        await app.machine.send(cmd);
        if (/^\$\d+=/.test(cmd))
            app.machine.refreshSettings();
    }
    catch {
        /* ошибка уже в журнале */
    }
}
function LogView() {
    let box;
    effect(() => {
        app.machine.log.value;
        requestAnimationFrame(() => box && (box.scrollTop = box.scrollHeight));
    });
    return (h("div", { class: "log", ref: (el) => (box = el) }, () => app.machine.log.value.slice(-300).map((e) => (h("div", { class: 'log-line log-' + e.dir },
        h("span", { class: "log-dir" }, e.dir === 'tx' ? '→' : e.dir === 'rx' ? '←' : e.dir === 'err' ? '!' : '·'),
        h("span", null, e.text))))));
}
function SettingsView() {
    return (h("div", { class: "settings-table" }, () => {
        const map = app.machine.settings.value;
        if (!map.size)
            return h("div", { class: "muted small" }, "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u0435\u0441\u044C \u2014 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u044E\u0442\u0441\u044F \u043A\u043E\u043C\u0430\u043D\u0434\u043E\u0439 $$.");
        return [...map.entries()].map(([k, v]) => {
            const info = typeof k === 'number' ? SETTING_INFO[k] : undefined;
            return (h("div", { class: 'set-row' + (info?.danger ? ' danger' : '') },
                h("code", null,
                    "$",
                    String(k)),
                h("input", { value: v, onChange: (e) => {
                        const nv = e.target.value.trim();
                        if (nv !== v)
                            writeSetting(k, nv);
                    } }),
                h("span", { class: "set-name" }, info ? `${info.name}${info.unit ? ', ' + info.unit : ''}` : '')));
        });
    }));
}
export function ConsoleTab() {
    return (h("div", { class: "tab tab-console" },
        h(Section, { title: "\u041F\u043B\u0430\u0442\u0430", aside: h(Segmented, { small: true, value: () => view.value, onChange: (v) => (view.value = v), options: [{ value: 'log', label: 'Журнал' }, { value: 'settings', label: 'Настройки $$' }] }) },
            () => (view.value === 'log' ? h(LogView, null) : h(SettingsView, null)),
            () => view.value === 'log' ? (h("div", null,
                h("input", { class: "console-input", placeholder: "\u041A\u043E\u043C\u0430\u043D\u0434\u0430 GRBL, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 $$ \u0438\u043B\u0438 G0 X10 \u2014 Enter", onKeyDown: (e) => {
                        const inp = e.target;
                        if (e.key === 'Enter') {
                            run(inp.value);
                            inp.value = '';
                        }
                        else if (e.key === 'ArrowUp') {
                            hIdx = Math.max(0, hIdx - 1);
                            inp.value = history[hIdx] ?? '';
                            e.preventDefault();
                        }
                        else if (e.key === 'ArrowDown') {
                            hIdx = Math.min(history.length, hIdx + 1);
                            inp.value = history[hIdx] ?? '';
                            e.preventDefault();
                        }
                    } }),
                h("div", { class: "row wrap" },
                    ['$$', '$I', '$G', '$#', '$X', '?'].map((c) => h("button", { class: "chip", onClick: () => run(c) }, c)),
                    h(Btn, { small: true, kind: "ghost", onClick: () => downloadText(`plotterm-log_${stamp()}.txt`, app.machine.log.peek().map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.dir} ${e.text}`).join('\n')) },
                        h(Icon, { name: "download", size: 14 }),
                        " \u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0436\u0443\u0440\u043D\u0430\u043B")))) : (h("div", { class: "row wrap" },
                h(Btn, { small: true, onClick: () => app.machine.refreshSettings().catch(() => { }) }, "\u041F\u0435\u0440\u0435\u0447\u0438\u0442\u0430\u0442\u044C"),
                h(Btn, { small: true, kind: "ghost", onClick: () => backupSettings() },
                    h(Icon, { name: "download", size: 14 }),
                    " \u041A\u043E\u043F\u0438\u044F \u0432 \u0444\u0430\u0439\u043B"),
                h("span", { class: "muted small" }, "\u041A\u0440\u0430\u0441\u043D\u044B\u043C \u2014 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438, \u043E\u0442 \u043A\u043E\u0442\u043E\u0440\u044B\u0445 \u0437\u0430\u0432\u0438\u0441\u0438\u0442 \u043C\u0435\u0445\u0430\u043D\u0438\u043A\u0430. \u041C\u0435\u043D\u044F\u044E\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0441 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435\u043C."))))));
}
