import { h } from "../dom.js";
import { app, loadCustomFonts } from "../../app/state.js";
import { exportGcode, setSimSpeed } from "../../app/actions.js";
import { Btn, Field, Icon, Section, Segmented, Toggle, bind } from "../components.js";
import { downloadText, fmtTime, pickFile, stamp, toast } from "../../app/notify.js";
import { idb } from "../../store/db.js";
import { importGcode, importSvg } from "./TextTab.js";
async function exportAll() {
    const data = {
        app: 'plotterm', version: 1, exportedAt: new Date().toISOString(),
        text: app.text.peek(), typo: app.typo.peek(), paper: app.paper.peek(), pen: app.pen.peek(), speed: app.speed.peek(),
        calib: app.calib.peek(), prefs: app.prefs.peek(), profiles: app.profiles.peek(), stats: app.stats.peek(),
        fonts: app.customFonts.peek(),
    };
    downloadText(`plotterm-settings_${stamp()}.json`, JSON.stringify(data, null, 1), 'application/json');
}
async function importAll() {
    const f = await pickFile('.json');
    if (!f)
        return;
    try {
        const d = JSON.parse(await f.text());
        if (d.app !== 'plotterm')
            throw new Error('это не файл настроек Plotterm');
        if (!confirm('Заменить текущие настройки, профили и шрифты данными из файла?'))
            return;
        if (d.text !== undefined)
            app.text.value = d.text;
        if (d.typo)
            app.typo.value = { ...app.typo.peek(), ...d.typo };
        if (d.paper)
            app.paper.value = { ...app.paper.peek(), ...d.paper };
        if (d.pen)
            app.pen.value = { ...app.pen.peek(), ...d.pen };
        if (d.speed)
            app.speed.value = { ...app.speed.peek(), ...d.speed };
        if (d.calib && confirm('Взять и калибровку из файла? (нужно, только если это тот же плоттер и ноль не сбивался)'))
            app.calib.value = { ...app.calib.peek(), ...d.calib, stale: true };
        if (d.prefs)
            app.prefs.value = { ...app.prefs.peek(), ...d.prefs };
        if (Array.isArray(d.profiles))
            app.profiles.value = d.profiles;
        if (Array.isArray(d.fonts))
            for (const fr of d.fonts)
                await idb.set('fonts', fr.id, fr);
        await loadCustomFonts();
        toast('Настройки загружены.', 'ok');
    }
    catch (e) {
        toast('Не удалось загрузить: ' + (e?.message ?? e), 'err');
    }
}
export function MoreTab() {
    const pr = app.prefs;
    return (h("div", { class: "tab" },
        h(Section, { title: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435" },
            h(Field, { label: "\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u043F\u043E\u0440\u0442\u0430" },
                h(Segmented, { small: true, value: bind(pr, 'baud').get, onChange: bind(pr, 'baud').set, options: [{ value: 115200, label: '115200' }, { value: 250000, label: '250000' }, { value: 57600, label: '57600' }] })),
            h(Toggle, { value: bind(pr, 'autoReconnect').get, onChange: bind(pr, 'autoReconnect').set, label: "\u041F\u0435\u0440\u0435\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0430\u0442\u044C\u0441\u044F \u0441\u0430\u043C \u043F\u0440\u0438 \u043E\u0431\u0440\u044B\u0432\u0435 \u0438 \u043F\u0440\u0438 \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u0438 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B" }),
            h(Toggle, { value: bind(pr, 'keepSignals').get, onChange: bind(pr, 'keepSignals').set, label: "\u041D\u0435 \u0442\u0440\u043E\u0433\u0430\u0442\u044C DTR/RTS", hint: "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u0435, \u0435\u0441\u043B\u0438 \u043F\u043B\u0430\u0442\u0430 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u0442\u0441\u044F \u043F\u0440\u0438 \u043A\u0430\u0436\u0434\u043E\u043C \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0438 \u0438\u043B\u0438 \u043D\u0435 \u043E\u0442\u0432\u0435\u0447\u0430\u0435\u0442" }),
            h(Field, { label: "\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u0440\u0443\u0447\u043D\u043E\u0433\u043E \u0445\u043E\u0434\u0430" },
                h(Segmented, { small: true, value: bind(pr, 'jogFeed').get, onChange: bind(pr, 'jogFeed').set, options: [1000, 3000, 6000].map((v) => ({ value: v, label: v + ' мм/мин' })) })),
            h("div", { class: "muted small" }, "Bluetooth: \u0441\u043F\u0430\u0440\u044C\u0442\u0435 \u00ABBtWriter\u00BB \u0432 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445 Bluetooth Windows \u2014 \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F COM-\u043F\u043E\u0440\u0442, \u0435\u0433\u043E \u043C\u043E\u0436\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0432 \u00AB\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u043F\u043B\u043E\u0442\u0442\u0435\u0440\u00BB.")),
        h(Section, { title: "\u0421\u0438\u043C\u0443\u043B\u044F\u0442\u043E\u0440" },
            h(Field, { label: "\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u0441\u0438\u043C\u0443\u043B\u044F\u0446\u0438\u0438" },
                h(Segmented, { small: true, value: bind(pr, 'simSpeed').get, onChange: (v) => setSimSpeed(v), options: [1, 4, 20, 100].map((v) => ({ value: v, label: '×' + v })) }))),
        h(Section, { title: "\u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C" },
            h(Toggle, { value: bind(pr, 'allowUncalibrated').get, onChange: bind(pr, 'allowUncalibrated').set, label: "\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u043F\u0435\u0447\u0430\u0442\u044C \u0431\u0435\u0437 \u043A\u0430\u043B\u0438\u0431\u0440\u043E\u0432\u043A\u0438 (\u043E\u043F\u0430\u0441\u043D\u043E)", hint: "\u0411\u0435\u0437 \u0433\u0440\u0430\u043D\u0438\u0446 \u043B\u0438\u0441\u0442\u0430 \u043A\u0430\u0440\u0435\u0442\u043A\u0430 \u043C\u043E\u0436\u0435\u0442 \u0443\u0434\u0430\u0440\u0438\u0442\u044C\u0441\u044F \u043E \u043A\u0440\u0430\u0439" }),
            h(Toggle, { value: bind(pr, 'sound').get, onChange: bind(pr, 'sound').set, label: "\u0417\u0432\u0443\u043A \u043F\u0440\u0438 \u0441\u043C\u0435\u043D\u0435 \u043B\u0438\u0441\u0442\u0430 \u0438 \u0432 \u043A\u043E\u043D\u0446\u0435" })),
        h(Section, { title: "\u0424\u0430\u0439\u043B\u044B" },
            h("div", { class: "row wrap" },
                h(Btn, { small: true, onClick: () => exportGcode() },
                    h(Icon, { name: "download", size: 14 }),
                    " \u042D\u043A\u0441\u043F\u043E\u0440\u0442 G-\u043A\u043E\u0434\u0430"),
                h(Btn, { small: true, onClick: () => importGcode() },
                    h(Icon, { name: "upload", size: 14 }),
                    " \u041E\u0442\u043A\u0440\u044B\u0442\u044C G-\u043A\u043E\u0434"),
                h(Btn, { small: true, onClick: () => importSvg() },
                    h(Icon, { name: "upload", size: 14 }),
                    " \u041E\u0442\u043A\u0440\u044B\u0442\u044C SVG")),
            h("div", { class: "row wrap" },
                h(Btn, { small: true, kind: "ghost", onClick: exportAll },
                    h(Icon, { name: "download", size: 14 }),
                    " \u0412\u0441\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0432 \u0444\u0430\u0439\u043B"),
                h(Btn, { small: true, kind: "ghost", onClick: importAll },
                    h(Icon, { name: "upload", size: 14 }),
                    " \u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0438\u0437 \u0444\u0430\u0439\u043B\u0430"))),
        h(Section, { title: "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430" },
            () => {
                const s = app.stats.value;
                return (h("div", { class: "stats" },
                    h("span", null,
                        h("b", null, s.meters.toFixed(1)),
                        " \u043C \u043B\u0438\u043D\u0438\u0439"),
                    h("span", null,
                        h("b", null, s.pages),
                        " \u0441\u0442\u0440\u0430\u043D\u0438\u0446"),
                    h("span", null,
                        h("b", null, fmtTime(s.seconds)),
                        " \u0440\u0430\u0431\u043E\u0442\u044B"),
                    h("span", null,
                        h("b", null, s.sinceRefill.toFixed(1)),
                        " \u043C \u0441 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0439 \u0437\u0430\u043C\u0435\u043D\u044B \u0440\u0443\u0447\u043A\u0438")));
            },
            h("div", { class: "row" },
                h(Btn, { small: true, kind: "ghost", onClick: () => app.stats.patch({ sinceRefill: 0 }) }, "\u0420\u0443\u0447\u043A\u0443 \u0437\u0430\u043C\u0435\u043D\u0438\u043B"),
                () => (app.stats.value.sinceRefill > 150 ? h("span", { class: "warn-text small" }, "\u0413\u0435\u043B\u0435\u0432\u043E\u0433\u043E \u0441\u0442\u0435\u0440\u0436\u043D\u044F \u043E\u0431\u044B\u0447\u043D\u043E \u0445\u0432\u0430\u0442\u0430\u0435\u0442 \u043D\u0430 150\u2013400 \u043C \u2014 \u043F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0440\u0443\u0447\u043A\u0443.") : null))),
        h(Section, { title: "\u0413\u043E\u0440\u044F\u0447\u0438\u0435 \u043A\u043B\u0430\u0432\u0438\u0448\u0438" },
            h("div", { class: "keys" },
                h("span", null,
                    h("kbd", null, "\u041F\u0440\u043E\u0431\u0435\u043B"),
                    " \u043F\u0430\u0443\u0437\u0430 / \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C"),
                h("span", null,
                    h("kbd", null, "Esc"),
                    " \u0421\u0422\u041E\u041F"),
                h("span", null,
                    h("kbd", null, "\u2190 \u2192 \u2191 \u2193"),
                    " \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0435 (\u0443\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u0435 \u2014 \u043D\u0435\u043F\u0440\u0435\u0440\u044B\u0432\u043D\u043E)"),
                h("span", null,
                    h("kbd", null, "PgUp"),
                    " / ",
                    h("kbd", null, "PgDn"),
                    " Z+ / Z\u2212"),
                h("span", null,
                    h("kbd", null, "Ctrl"),
                    "+",
                    h("kbd", null, "P"),
                    " \u043F\u0435\u0447\u0430\u0442\u044C"))),
        h(Section, { title: "\u041E \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0435" },
            h("div", { class: "muted small" }, "Plotterm \u2014 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0440\u0443\u043A\u043E\u043F\u0438\u0441\u043D\u044B\u043C \u043F\u043B\u043E\u0442\u0442\u0435\u0440\u043E\u043C \u043D\u0430 GRBL \u043F\u0440\u044F\u043C\u043E \u0438\u0437 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430. \u0412\u0441\u0451 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u043D\u0430 \u0432\u0430\u0448\u0435\u043C \u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440\u0435, \u0442\u0435\u043A\u0441\u0442 \u043D\u0438\u043A\u0443\u0434\u0430 \u043D\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u0442\u0441\u044F. \u0428\u0440\u0438\u0444\u0442\u044B OpenGOST \u0442\u0438\u043F \u0410/\u0411 \u2014 SIL Open Font License 1.1. \u041A\u043E\u0434 \u2014 MIT."))));
}
