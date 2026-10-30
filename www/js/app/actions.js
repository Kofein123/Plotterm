// Действия: подключение, калибровка, ручное управление, печать, тесты.
import { app } from "./state.js";
import { signal, effect, createRoot } from "../ui/reactive.js";
import { WebSerialTransport, serialApi, SPP_UUID } from "../grbl/webserial.js";
import { SimulatorTransport } from "../grbl/simulator.js";
import { paperToWork, workToPaper, penZ } from "../core/calibration.js";
import { buildPlan, fmt } from "../core/plan.js";
import { layoutText } from "../core/layout.js";
import { toast, beep, systemNotify, keepAwake, askNotifications, downloadText, stamp, fmtTime } from "./notify.js";
import { GrblError } from "../grbl/machine.js";
const { machine, job, calib, prefs } = app;
/** След, нарисованный симулятором (бумажные координаты): для наглядности в предпросмотре. */
export const simInk = { segs: [], version: signal(0) };
export let simulator = null;
let lastPort = null;
let checkedAfterConnect = false;
// --- связь событий платы с заданием и калибровкой ---
machine.onStatus = (r) => job.onStatus(r);
machine.onDisconnect = (reason) => {
    checkedAfterConnect = false;
    if (job.active) {
        job.interrupted(reason);
        if (prefs.peek().sound)
            beep('error');
        systemNotify('Plotterm: связь прервалась', reason);
    }
    keepAwake(false);
};
machine.onReset = (unexpected) => {
    if (unexpected && calib.peek().zeroSet) {
        calib.patch({ stale: true });
        toast('Плата перезагрузилась: ноль мог сбиться. Повторите шаги 2–3 калибровки.', 'warn', 12000);
    }
};
createRoot(() => {
    // запоминаем машинное положение, чтобы после переподключения понять, не терялся ли ноль
    let last = '';
    effect(() => {
        const mp = machine.mpos.value;
        const st = machine.state.value;
        if (!checkedAfterConnect || st !== 'Idle' || machine.conn.peek() !== 'connected')
            return;
        const key = mp.map((v) => v.toFixed(2)).join(',');
        if (key === last)
            return;
        last = key;
        calib.patch({ lastMPos: mp });
    });
    // запрет сна, пока идёт печать
    effect(() => {
        const s = job.status.value;
        keepAwake(s === 'running' || s === 'pausing' || s === 'paused' || s === 'sheet');
    });
});
async function afterConnect() {
    const c = calib.peek();
    if (c.zeroSet) {
        const mp = machine.mpos.peek();
        const lm = c.lastMPos;
        const moved = !lm || Math.hypot(mp[0] - lm[0], mp[1] - lm[1], mp[2] - lm[2]) > 0.05;
        if (moved && !c.stale) {
            calib.patch({ stale: true });
            toast('Положение каретки не совпадает с последним известным — после выключения питания ноль теряется. Пройдите шаги 2–3 калибровки.', 'warn', 12000);
        }
    }
    checkedAfterConnect = true;
    if (machine.state.peek() === 'Alarm')
        toast('Плата в состоянии ALARM. Нажмите «Разблокировать».', 'warn');
}
export function hasWebSerial() {
    return !!serialApi();
}
export async function connectSerial() {
    const api = serialApi();
    if (!api) {
        toast('Этот браузер не умеет работать с USB-портами. Откройте страницу в Chrome или Edge.', 'err');
        return;
    }
    let port;
    try {
        try {
            port = await api.requestPort({ allowedBluetoothServiceClassIds: [SPP_UUID] });
        }
        catch (e) {
            if (e?.name === 'TypeError')
                port = await api.requestPort();
            else
                throw e;
        }
    }
    catch (e) {
        if (e?.name !== 'NotFoundError')
            toast('Порт не выбран: ' + (e?.message ?? e), 'warn');
        return;
    }
    await connectPort(port);
}
async function connectPort(port) {
    try {
        const t = new WebSerialTransport(port, { baudRate: prefs.peek().baud, keepSignals: prefs.peek().keepSignals });
        simulator = null;
        await machine.connect(t);
        lastPort = port;
        toast(`Подключено: ${t.label}${machine.version.peek() ? ', GRBL ' + machine.version.peek() : ''}`, 'ok');
        await afterConnect();
    }
    catch (e) {
        const msg = String(e?.message ?? e);
        if (/already open|InvalidStateError/i.test(msg))
            toast('Порт занят другой программой (закройте её, например UGS или Arduino IDE).', 'err');
        else
            toast('Не удалось подключиться: ' + msg, 'err');
    }
}
/** Автопереподключение, когда кабель снова вставлен. */
export function setupAutoReconnect() {
    const api = serialApi();
    if (!api)
        return;
    api.addEventListener('connect', async (e) => {
        if (!prefs.peek().autoReconnect || machine.conn.peek() !== 'disconnected')
            return;
        const port = (e.target ?? e.port);
        if (lastPort && port !== lastPort)
            return;
        toast('Плоттер снова подключён — переподключаюсь…');
        await new Promise((r) => setTimeout(r, 600));
        await connectPort(port);
    });
}
/** При загрузке страницы — подключиться к ранее разрешённому порту, если он один. */
export async function tryRestorePort() {
    const api = serialApi();
    if (!api || !prefs.peek().autoReconnect)
        return;
    try {
        const ports = await api.getPorts();
        if (ports.length === 1)
            await connectPort(ports[0]);
    }
    catch {
        /* ignore */
    }
}
export async function connectSimulator() {
    const c = calib.peek();
    const sim = new SimulatorTransport({ speedup: prefs.peek().simSpeed });
    const dir = c.upZ >= 0 ? 1 : -1;
    sim.inkTest = (z) => z * dir <= 0.01;
    sim.trace.onInk = (x0, y0, x1, y1) => {
        const f = app.frame.peek();
        simInk.segs.push(...workToPaper(f, x0, y0), ...workToPaper(f, x1, y1));
        simInk.version.value++;
    };
    simInk.segs = [];
    simInk.version.value++;
    simulator = sim;
    try {
        await machine.connect(sim);
        toast('Подключён симулятор: можно проверить всё без плоттера.', 'ok');
        await afterConnect();
    }
    catch (e) {
        toast('Симулятор не запустился: ' + (e?.message ?? e), 'err');
    }
}
export function setSimSpeed(x) {
    prefs.patch({ simSpeed: x });
    if (simulator)
        simulator.speedup = x;
}
export async function disconnect() {
    if (job.active && !confirm('Идёт печать. Отключиться? Печать остановится.'))
        return;
    if (job.active)
        await job.stop();
    await machine.disconnect();
}
// --- ручное управление ---
function needConn() {
    if (!machine.connected) {
        toast('Сначала подключите плоттер.', 'warn');
        return false;
    }
    if (job.active && job.status.peek() !== 'paused' && job.status.peek() !== 'sheet') {
        toast('Во время печати ручное управление недоступно — сначала пауза.', 'warn');
        return false;
    }
    return true;
}
/** Ограничивать перемещения листом (после калибровки) */
export const clampJog = signal(true);
export function sheetGuardActive() {
    const c = calib.peek();
    return clampJog.peek() && c.zeroSet && c.cornerSet && !c.stale;
}
async function jogError(e) {
    if (e instanceof GrblError && e.code === 9)
        toast('Плата заблокирована (ALARM) — нажмите «Разблокировать».', 'warn');
    else if (e instanceof GrblError)
        toast('Плата: ' + e.message, 'err');
}
/** Шаг перемещения: du/dv — направление на листе (после калибровки) или по осям станка. */
export async function jogStep(du, dv) {
    if (!needConn())
        return;
    const feed = prefs.peek().jogFeed;
    try {
        if (sheetGuardActive()) {
            const f = app.frame.peek();
            const w = machine.wpos.peek();
            const [u, v] = workToPaper(f, w[0], w[1]);
            const tu = Math.max(0, Math.min(f.width, u + du));
            const tv = Math.max(0, Math.min(f.height, v + dv));
            if (Math.abs(tu - u) < 0.001 && Math.abs(tv - v) < 0.001) {
                toast('Дальше край листа.', 'info', 1500);
                return;
            }
            const [x, y] = paperToWork(f, tu, tv);
            await machine.jogTo(x, y, null, feed);
        }
        else {
            // до калибровки: по осям станка, но в тех же направлениях, что и метка на превью
            const [x, y] = paperToWork(app.frame.peek(), du, dv);
            await machine.jog(x, y, 0, feed);
        }
    }
    catch (e) {
        jogError(e);
    }
}
export async function jogContinuousStart(du, dv) {
    if (!needConn())
        return;
    const feed = prefs.peek().jogFeed;
    try {
        if (sheetGuardActive()) {
            const f = app.frame.peek();
            const w = machine.wpos.peek();
            const [u, v] = workToPaper(f, w[0], w[1]);
            const tu = du ? (du > 0 ? f.width : 0) : u;
            const tv = dv ? (dv > 0 ? f.height : 0) : v;
            const [x, y] = paperToWork(f, tu, tv);
            await machine.jogTo(x, y, null, feed);
        }
        else {
            const [x, y] = paperToWork(app.frame.peek(), du * 300, dv * 300);
            await machine.jog(x, y, 0, feed);
        }
    }
    catch (e) {
        jogError(e);
    }
}
export function jogContinuousStop() {
    if (machine.connected)
        machine.cancelJog();
}
export async function jogZ(dz) {
    if (!needConn())
        return;
    try {
        await machine.jog(0, 0, dz, prefs.peek().zFeed);
    }
    catch (e) {
        jogError(e);
    }
}
export async function penUp() {
    if (!needConn())
        return;
    const c = calib.peek();
    try {
        await machine.send(`G90 G0 Z${fmt(c.upZ)}`);
    }
    catch (e) {
        jogError(e);
    }
}
export async function penDown() {
    if (!needConn())
        return;
    const c = calib.peek();
    if (!c.penSet) {
        toast('Сначала шаг 1 калибровки: где ручка касается бумаги.', 'warn');
        return;
    }
    const z = penZ(c, app.pen.peek().pressure);
    try {
        await machine.send(`G90 G1 Z${fmt(z.down)} F${Math.round(app.pen.peek().zDownFeed)}`);
    }
    catch (e) {
        jogError(e);
    }
}
export async function goZero() {
    if (!needConn())
        return;
    try {
        await machine.send(`G90 G0 Z${fmt(calib.peek().upZ)}`);
        await machine.send('G0 X0 Y0');
    }
    catch (e) {
        jogError(e);
    }
}
export async function unlock() {
    try {
        await machine.unlock();
        toast('Разблокировано.', 'ok');
    }
    catch (e) {
        toast('Не удалось разблокировать: ' + (e?.message ?? e), 'err');
    }
}
// --- калибровка ---
export async function calibPenTouch() {
    if (!needConn())
        return;
    try {
        await machine.send('G10 L20 P1 Z0');
        calib.patch({ penSet: false });
        toast('Запомнено: здесь ручка касается бумаги (Z = 0). Теперь поднимите ручку и нажмите «Ручка поднята».', 'ok', 8000);
    }
    catch (e) {
        toast('Ошибка: ' + e.message, 'err');
    }
}
export function calibPenUp() {
    const z = machine.wpos.peek()[2];
    if (Math.abs(z) < 0.3) {
        toast('Ручка почти не поднята (меньше 0,3 мм). Поднимите её на 1–3 мм над бумагой.', 'warn');
        return;
    }
    calib.patch({ penSet: true, upZ: Math.round(z * 100) / 100 });
    if (simulator) {
        const dir = z >= 0 ? 1 : -1;
        simulator.inkTest = (zz) => zz * dir <= 0.01;
    }
    toast(`Запомнено: ручка поднята при Z = ${fmt(z)}. Опускание — на ${app.pen.peek().pressure} мм ниже касания.`, 'ok');
}
export async function calibZero() {
    if (!needConn())
        return;
    try {
        await machine.send('G10 L20 P1 X0 Y0');
        calib.patch({ zeroSet: true, cornerSet: false, skewPoint: null, stale: false, lastMPos: machine.mpos.peek() });
        toast('Ноль поставлен в угол листа. Теперь отведите каретку в противоположный угол и нажмите «Здесь край».', 'ok', 8000);
    }
    catch (e) {
        toast('Ошибка: ' + e.message, 'err');
    }
}
export function calibCorner() {
    const [x, y] = machine.wpos.peek();
    if (!calib.peek().zeroSet) {
        toast('Сначала шаг 2: ноль в углу листа.', 'warn');
        return;
    }
    if (Math.abs(x) < 20 || Math.abs(y) < 20) {
        toast('Слишком близко к нулю: отведите каретку в противоположный угол листа.', 'warn');
        return;
    }
    calib.patch({ corner: [Math.round(x * 100) / 100, Math.round(y * 100) / 100], cornerSet: true, stale: false });
    const f = app.frame.peek();
    toast(`Лист: ${f.width.toFixed(1)} × ${f.height.toFixed(1)} мм. Каретка больше не выйдет за эти границы.`, 'ok', 8000);
}
export function calibSkew() {
    const [x, y] = machine.wpos.peek();
    if (!calib.peek().zeroSet)
        return toast('Сначала шаг 2.', 'warn');
    if (Math.hypot(x, y) < 40)
        return toast('Отведите каретку дальше вдоль верхнего края (хотя бы на 40 мм).', 'warn');
    calib.patch({ skewPoint: [x, y] });
    const deg = (app.frame.peek().theta * 180) / Math.PI;
    toast(`Перекос листа: ${deg.toFixed(2)}°. Текст будет повёрнут под лист.`, 'ok');
}
export function calibSkewReset() {
    calib.patch({ skewPoint: null });
}
export function calibGridOrigin() {
    const [x, y] = machine.wpos.peek();
    const [u, v] = workToPaper(app.frame.peek(), x, y);
    calib.patch({ gridOrigin: [Math.round(u * 100) / 100, Math.round(v * 100) / 100] });
    toast('Запомнена линия сетки: строки встанут на линии клеток.', 'ok');
}
/** Стрелка едет не туда — перевернуть ось (до шага 3; шаг 3 потом сам узнаёт направление). */
export function calibFlipAxis(axis) {
    const { corner: c, swap } = calib.peek();
    const i = swap ? 1 - axis : axis;
    calib.patch({ corner: i === 0 ? [-c[0], c[1]] : [c[0], -c[1]] });
}
/** Тетрадь стоит поперёк осей станка: ←→ двигают ось Y, ↑↓ — ось X. Лист после этого надо задать заново. */
export function calibSwapAxes() {
    const { corner: c, swap } = calib.peek();
    calib.patch({ swap: !swap, corner: [c[1], c[0]], cornerSet: false, skewPoint: null });
}
export function calibResetAll() {
    if (!confirm('Сбросить всю калибровку?'))
        return;
    calib.patch({ penSet: false, zeroSet: false, cornerSet: false, skewPoint: null, gridOrigin: null, stale: false });
}
/** Проехать с поднятой ручкой по контуру (лист или задание). */
export async function traceRect(u0, v0, u1, v1) {
    if (!needConn())
        return;
    const f = app.frame.peek();
    const pts = [[u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0]];
    try {
        await machine.send(`G21 G90 G0 Z${fmt(calib.peek().upZ)}`);
        for (const [u, v] of pts) {
            const [x, y] = paperToWork(f, u, v);
            await machine.send(`G1 X${fmt(x)} Y${fmt(y)} F${Math.round(prefs.peek().jogFeed)}`);
        }
    }
    catch (e) {
        jogError(e);
    }
}
export function traceSheet() {
    const f = app.frame.peek();
    if (!f.ready)
        return toast('Сначала шаги 2–3 калибровки.', 'warn');
    return traceRect(0, 0, f.width, f.height);
}
export function traceJob() {
    const plan = app.previewPlan.peek();
    if (!plan || !plan.strokes.length)
        return toast('Нечего обводить: задание пустое.', 'warn');
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const s of plan.strokes)
        for (let i = 0; i < s.length; i += 2) {
            minU = Math.min(minU, s[i]);
            maxU = Math.max(maxU, s[i]);
            minV = Math.min(minV, s[i + 1]);
            maxV = Math.max(maxV, s[i + 1]);
        }
    if (plan.outOfBounds.length)
        toast('Часть задания за краем листа — рамка покажет где.', 'warn');
    return traceRect(minU, minV, maxU, maxV);
}
/** Замер подъёма/опускания ручки: 10 циклов. */
export async function measurePenLift() {
    if (!needConn())
        return;
    const c = calib.peek();
    if (!c.penSet)
        return toast('Сначала шаг 1 калибровки.', 'warn');
    const z = penZ(c, app.pen.peek().pressure);
    const t0 = performance.now();
    try {
        for (let i = 0; i < 10; i++) {
            machine.enqueue(`G1 Z${fmt(z.down)} F${Math.round(app.pen.peek().zDownFeed)}`, { quiet: true });
            machine.enqueue(`G0 Z${fmt(z.up)}`, { quiet: true });
        }
        await machine.waitIdle(60000);
        const per = (performance.now() - t0 - 150) / 10 / 1000;
        toast(`Цикл «опустить + поднять» ≈ ${per.toFixed(2)} с. На страницу с ~700 штрихами это ≈ ${fmtTime(per * 700)} только на подъёмы.`, 'info', 12000);
    }
    catch (e) {
        toast('Ошибка замера: ' + (e?.message ?? e), 'err');
    }
}
// --- $-настройки ---
export async function backupSettings() {
    const map = await machine.refreshSettings();
    const lines = [...map.entries()].map(([k, v]) => `$${k}=${v}`);
    downloadText(`grbl-settings_${stamp()}.txt`, `; Копия настроек GRBL (${machine.version.peek()}), ${new Date().toLocaleString()}\n` + lines.join('\n') + '\n');
}
export async function writeSetting(key, value) {
    if (!machine.connected)
        return toast('Нет связи с платой.', 'warn');
    if (job.active)
        return toast('Во время печати настройки менять нельзя.', 'warn');
    if (!confirm(`Записать в плату $${key}=${value}?\nПеред этим будет скачана копия всех текущих настроек.`))
        return;
    try {
        await backupSettings();
        await machine.send(`$${key}=${value}`);
        await machine.refreshSettings();
        toast(`$${key}=${value} записано.`, 'ok');
    }
    catch (e) {
        toast('Не записалось: ' + (e?.message ?? e), 'err');
    }
}
export function printBlockers() {
    const out = [];
    if (machine.conn.value !== 'connected')
        out.push('плоттер не подключён');
    if (app.pageCount.value === 0 || (app.source.value.kind === 'text' && !app.layout.value.chars))
        out.push('нечего печатать');
    if (!prefs.value.allowUncalibrated) {
        if (!calib.value.penSet)
            out.push('калибровка: шаг 1 (ручка)');
        if (!calib.value.zeroSet || !calib.value.cornerSet)
            out.push('калибровка: шаги 2–3 (лист)');
    }
    if (calib.value.stale)
        out.push('ноль мог сбиться — повторите шаги 2–3');
    if (machine.state.value === 'Alarm')
        out.push('плата в ALARM — разблокируйте');
    return out;
}
export function buildJobPages(range, dry) {
    const n = app.pageCount.peek();
    let idx = [];
    if (range.kind === 'all')
        idx = [...Array(n).keys()];
    else if (range.kind === 'current')
        idx = [Math.min(app.currentPage.peek(), n - 1)];
    else
        idx = [...Array(n).keys()].filter((i) => i >= range.page);
    // на каждой странице сначала текст ручкой, потом рисунки карандашом (с паузой на смену и обратно)
    const out = [];
    let pencilIn = false;
    for (const i of idx) {
        const pen = app.planFor(i, { dryRun: dry, tool: 'pen' });
        const pencil = app.planFor(i, { dryRun: dry, tool: 'pencil' });
        const hasPen = !!pen && pen.strokes.length > 0;
        const hasPencil = !!pencil && pencil.strokes.length > 0;
        if (hasPen) {
            const before = pencilIn
                ? `Рисунки карандашом готовы. Верните ручку (кончик на той же высоте), положите страницу ${i + 1} и нажмите «Продолжить».`
                : undefined;
            out.push({ plan: pen, pageNo: i, before });
            pencilIn = false;
        }
        if (hasPencil) {
            const before = pencilIn
                ? `Положите страницу ${i + 1} — карандаш оставьте и нажмите «Продолжить».`
                : `Текст страницы ${i + 1} готов. Вставьте КАРАНДАШ вместо ручки (кончик на той же высоте над бумагой) и нажмите «Продолжить» — нарисую рисунки.`;
            out.push({ plan: pencil, pageNo: i, before });
            pencilIn = true;
        }
    }
    return out;
}
export async function startPrint(range, fromStroke = 0) {
    const blockers = printBlockers();
    if (blockers.length)
        return toast('Печать недоступна: ' + blockers.join('; '), 'warn');
    if (job.active)
        return;
    const dry = app.dryRun.peek();
    const pages = buildJobPages(range, dry);
    if (!pages.length)
        return toast('Нет страниц для печати.', 'warn');
    const bad = pages.find((p) => p.plan.outOfBounds.length);
    if (bad) {
        app.currentPage.value = bad.pageNo;
        return toast(`Страница ${bad.pageNo + 1}: часть текста выходит за лист (подсвечено красным). Уменьшите поля/шрифт или проверьте калибровку.`, 'err');
    }
    if (machine.state.peek() !== 'Idle') {
        try {
            await machine.waitStatus((s) => s.state === 'Idle', 3000);
        }
        catch {
            return toast(`Плата занята (${machine.state.peek()}). Дождитесь Idle.`, 'warn');
        }
    }
    if (calib.peek().stale && !confirm('Ноль мог сбиться. Всё равно печатать?'))
        return;
    askNotifications();
    if (app.source.peek().kind === 'text' || app.source.peek().kind === 'drawing') {
        // симулятор: чистый лист
        simInk.segs = [];
        simInk.version.value++;
    }
    app.currentPage.value = pages[0].pageNo;
    try {
        job.start(pages, 0, fromStroke, { title: titleOf(), dryRun: dry });
        toast(`${dry ? 'Сухой прогон' : 'Печать'}: ${pages.length} стр., примерно ${fmtTime(pages.reduce((a, p) => a + p.plan.estSeconds, 0))}.`, 'ok');
    }
    catch (e) {
        toast(e.message, 'err');
    }
}
function titleOf() {
    const s = app.source.peek();
    if (s.kind !== 'text')
        return s.name;
    const first = app.text.peek().split('\n').find((l) => l.trim()) ?? '';
    return first.replace(/^#\s*/, '').slice(0, 40);
}
export async function resumeJob() {
    const rp = job.resumePoint.peek();
    if (!rp || !job.pages.length)
        return;
    const blockers = printBlockers().filter((b) => !b.startsWith('нечего'));
    if (blockers.length)
        return toast('Продолжить нельзя: ' + blockers.join('; '), 'warn');
    const pages = job.pages.slice(rp.page);
    job.reset();
    try {
        job.start(pages, 0, rp.stroke, { title: job.title.peek(), dryRun: job.dryRun.peek() });
        app.currentPage.value = pages[0].pageNo;
        toast(`Продолжаю со штриха ${rp.stroke + 1}.`, 'ok');
    }
    catch (e) {
        toast(e.message, 'err');
    }
}
/** «Повторить с…»: начать печать текущей страницы (и следующих) с выбранного штриха. */
export async function printFromStroke(stroke) {
    await startPrint({ kind: 'from', page: app.currentPage.peek() }, stroke);
}
// реакции на события задания
job.hooks.onSheet = (next) => {
    if (prefs.peek().sound)
        beep('sheet');
    systemNotify('Plotterm: смените лист', `Дальше страница ${next.pageNo + 1}`);
    app.currentPage.value = next.pageNo;
    simInk.segs = [];
    simInk.version.value++;
};
job.hooks.onDone = (sec) => {
    if (prefs.peek().sound)
        beep('done');
    systemNotify('Plotterm: готово', `Напечатано за ${fmtTime(sec)}`);
    const meters = job.pages.reduce((a, p) => a + p.plan.drawLength, 0) / 1000;
    if (!job.dryRun.peek()) {
        const s = app.stats.peek();
        app.stats.value = { meters: s.meters + meters, seconds: s.seconds + sec, pages: s.pages + job.pages.length, sinceRefill: s.sinceRefill + meters };
    }
};
// --- тестовые узоры ---
function patternPlan(strokes, title, feedOverride) {
    const p = app.paper.peek();
    const f = app.frame.peek();
    const speed = feedOverride ? { ...app.speed.peek(), profile: 'custom', customFeed: feedOverride } : app.speed.peek();
    return buildPlan({
        strokes, pageW: p.width, pageH: p.height, rotate180: false, frame: f.ready ? f : { ...f, width: p.width, height: p.height },
        calib: calib.peek(), pen: app.pen.peek(), speed, limits: app.limits.peek(), dryRun: app.dryRun.peek(), reorder: false, title,
    });
}
/** Объединить несколько планов в один (общий заголовок/хвост). */
function mergePlans(plans, title) {
    const gcode = [`; Plotterm: ${title}`];
    const ls = [-1];
    const out = { strokes: [], strokeLine: [], gcode, strokeStart: [], lineStroke: new Int32Array(0), outOfBounds: [], drawLength: 0, travelLength: 0, penLifts: 0, estSeconds: 0, strokeTime: [] };
    const header = plans[0].gcode.slice(1, plans[0].strokeStart[0]);
    header.forEach((l) => { gcode.push(l); ls.push(-1); });
    for (const p of plans) {
        const base = out.strokes.length;
        const first = p.strokeStart[0] ?? p.gcode.length;
        let last = p.gcode.length;
        while (last > first && p.lineStroke[last - 1] === -1)
            last--;
        for (let i = first; i < last; i++) {
            if (p.strokeStart.includes(i))
                out.strokeStart.push(gcode.length);
            gcode.push(p.gcode[i]);
            ls.push(p.lineStroke[i] + base);
        }
        p.outOfBounds.forEach((i) => out.outOfBounds.push(i + base));
        p.strokeTime.forEach((t) => out.strokeTime.push(out.estSeconds + t));
        out.strokes.push(...p.strokes);
        out.strokeLine.push(...p.strokeLine);
        out.drawLength += p.drawLength;
        out.travelLength += p.travelLength;
        out.penLifts += p.penLifts;
        out.estSeconds += p.estSeconds;
    }
    const tail = plans[plans.length - 1];
    let t = tail.gcode.length;
    while (t > 0 && tail.lineStroke[t - 1] === -1)
        t--;
    tail.gcode.slice(t).forEach((l) => { gcode.push(l); ls.push(-1); });
    out.lineStroke = Int32Array.from(ls);
    return out;
}
function textStrokes(text, u, v, size = 3) {
    const r = layoutText({
        text, font: app.font.peek(), typo: { ...app.typo.peek(), xHeight: size, liveliness: 0, indent: 0, align: 'left' },
        paper: { ...app.paper.peek(), template: 'a4', width: 1000, height: 1000, marginLeft: u, marginTop: v - size * 1.4, marginRight: 0, marginBottom: 0, blankLineStep: size * 2.6, startLine: 1 },
    });
    return r.pages[0]?.strokes ?? [];
}
export function patternPlanFor(kind) {
    const p = app.paper.peek();
    const f = app.frame.peek();
    const W = f.ready ? f.width : p.width;
    const H = f.ready ? f.height : p.height;
    const L = p.marginLeft, T = p.marginTop + 5;
    switch (kind) {
        case 'square':
            return patternPlan([{ pts: [L, T, L + 100, T, L + 100, T + 100, L, T + 100, L, T], line: 1 }, ...textStrokes('100 × 100 мм', L + 30, T + 50)], 'квадрат 100 мм');
        case 'cross': {
            const cu = W / 2, cv = H / 2;
            return patternPlan([{ pts: [cu - 30, cv, cu + 30, cv], line: 1 }, { pts: [cu, cv - 30, cu, cv + 30], line: 1 }, { pts: [cu - 30, cv - 30, cu + 30, cv - 30, cu + 30, cv + 30, cu - 30, cv + 30, cu - 30, cv - 30], line: 1 }], 'крест');
        }
        case 'grid': {
            const s = [];
            for (let i = 0; i <= 10; i++) {
                s.push({ pts: [L, T + i * 10, L + 100, T + i * 10], line: i + 1 });
                s.push({ pts: [L + i * 10, T, L + i * 10, T + 100], line: 20 + i });
            }
            return patternPlan(s, 'сетка 10 мм');
        }
        case 'speed': {
            const feeds = [1500, 2500, 3500, 4500, 5500, 6500, 8000];
            const plans = feeds.map((fd, i) => {
                const v = T + i * 14;
                const wave = [];
                for (let x = 0; x <= 80; x += 0.5)
                    wave.push(L + 32 + x, v + Math.sin(x * 0.8) * 2.5);
                return patternPlan([...textStrokes(String(fd), L, v + 1.5, 3), { pts: wave, line: 1 }], 'скорость ' + fd, fd);
            });
            return mergePlans(plans, 'полоса скоростей');
        }
        case 'paragraph': {
            const r = layoutText({ text: 'Съешь же ещё этих мягких французских булок, да выпей чаю. Пробный абзац для проверки нажима, скорости и почерка: 0123456789.', font: app.font.peek(), typo: app.typo.peek(), paper: { ...p, startLine: 1 } });
            return patternPlan(r.pages[0]?.strokes ?? [], 'пробный абзац');
        }
    }
}
export async function printPattern(kind) {
    if (!machine.connected)
        return toast('Сначала подключите плоттер.', 'warn');
    if (job.active)
        return;
    const f = app.frame.peek();
    if (!f.ready && !prefs.peek().allowUncalibrated)
        return toast('Сначала шаги 2–3 калибровки (лист).', 'warn');
    const plan = patternPlanFor(kind);
    if (plan.outOfBounds.length)
        return toast('Узор не помещается на лист.', 'err');
    simInk.segs = [];
    simInk.version.value++;
    job.reset();
    job.start([{ plan, pageNo: app.currentPage.peek() }], 0, 0, { title: plan.gcode[0].replace('; Plotterm: ', '') });
}
export function exportGcode() {
    const pages = buildJobPages({ kind: 'all' }, app.dryRun.peek());
    if (!pages.length)
        return toast('Нечего экспортировать.', 'warn');
    if (pages.length === 1)
        downloadText(`plotterm_${stamp()}.gcode`, pages[0].plan.gcode.join('\n') + '\n');
    else
        pages.forEach((p) => downloadText(`plotterm_${stamp()}_стр${p.pageNo + 1}.gcode`, p.plan.gcode.join('\n') + '\n'));
}
