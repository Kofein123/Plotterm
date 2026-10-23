// Выполнение задания: потоковая отправка G-кода по страницам, пауза на границе штриха,
// остановка с запоминанием места, продолжение с любого штриха, смена листа.
import { signal } from "../ui/reactive.js";
import { polyDist2, segDist2 } from "../core/geometry.js";
import { sleep } from "./machine.js";
const WINDOW = 48; // строк в очереди платы и программы
export class JobRunner {
    status = signal('idle');
    pageIdx = signal(0);
    /** штрих, который сейчас рисуется (по положению каретки) */
    currentStroke = signal(-1);
    progress = signal(0);
    elapsed = signal(0);
    eta = signal(0);
    message = signal(null);
    resumePoint = signal(null);
    title = signal('');
    dryRun = signal(false);
    pages = [];
    nextLine = 0;
    ackedLine = 0;
    pauseRequested = false;
    strokeStarts = new Set();
    pageStartLine = 0;
    startedAt = 0;
    pageStartedAt = 0;
    pageStartEst = 0;
    finishing = false;
    ticker = null;
    machine;
    hooks;
    constructor(machine, hooks) {
        this.machine = machine;
        this.hooks = hooks;
    }
    get active() {
        const s = this.status.peek();
        return s === 'running' || s === 'pausing' || s === 'paused' || s === 'sheet' || s === 'stopping';
    }
    get plan() {
        return this.pages[this.pageIdx.peek()]?.plan ?? null;
    }
    totalEstimate() {
        return this.pages.reduce((a, p) => a + p.plan.estSeconds, 0);
    }
    start(pages, fromPage = 0, fromStroke = 0, opts = {}) {
        if (!this.machine.connected)
            throw new Error('плата не подключена');
        if (this.active)
            throw new Error('задание уже выполняется');
        this.pages = pages;
        this.title.value = opts.title ?? '';
        this.dryRun.value = !!opts.dryRun;
        this.message.value = null;
        this.resumePoint.value = null;
        this.startedAt = Date.now();
        this.elapsed.value = 0;
        this.startTicker();
        this.beginPage(fromPage, fromStroke);
    }
    startTicker() {
        if (this.ticker)
            clearInterval(this.ticker);
        this.ticker = setInterval(() => {
            if (this.status.peek() === 'running' || this.status.peek() === 'pausing') {
                this.elapsed.value = (Date.now() - this.startedAt) / 1000;
            }
        }, 500);
    }
    stopTicker() {
        if (this.ticker)
            clearInterval(this.ticker);
        this.ticker = null;
    }
    beginPage(p, stroke) {
        this.pageIdx.value = p;
        const plan = this.pages[p].plan;
        this.strokeStarts = new Set(plan.strokeStart);
        this.pauseRequested = false;
        this.finishing = false;
        // заголовок (единицы, абсолютные координаты, ручка вверх)
        const headerEnd = plan.strokeStart[0] ?? plan.gcode.length;
        for (let i = 0; i < headerEnd; i++) {
            const l = plan.gcode[i];
            if (!l.startsWith(';'))
                this.machine.enqueue(l, { quiet: true, onError: (c, t) => this.onLineError(i, c, t) });
        }
        stroke = Math.max(0, Math.min(stroke, plan.strokeStart.length));
        this.nextLine = stroke < plan.strokeStart.length ? plan.strokeStart[stroke] : headerEnd;
        if (stroke >= plan.strokeStart.length)
            this.nextLine = plan.gcode.length - this.footerLength(plan);
        this.pageStartLine = this.nextLine;
        this.ackedLine = this.nextLine;
        this.currentStroke.value = stroke - 1;
        this.pageStartedAt = Date.now();
        this.pageStartEst = plan.strokeTime[stroke] ?? 0;
        this.status.value = 'running';
        this.feed();
    }
    footerLength(plan) {
        let n = 0;
        for (let i = plan.gcode.length - 1; i >= 0 && plan.lineStroke[i] === -1; i--)
            n++;
        return n;
    }
    feed() {
        const plan = this.plan;
        if (!plan || this.status.peek() !== 'running')
            return;
        while (this.machine.queueLength < WINDOW && this.nextLine < plan.gcode.length) {
            if (this.pauseRequested && this.strokeStarts.has(this.nextLine) && this.nextLine !== this.pageStartLine) {
                this.enterPausing();
                return;
            }
            const idx = this.nextLine++;
            const line = plan.gcode[idx];
            if (line.startsWith(';'))
                continue;
            this.machine.enqueue(line, {
                quiet: true,
                onOk: () => {
                    this.ackedLine = idx + 1;
                    this.feed();
                },
                onError: (code, text) => this.onLineError(idx, code, text),
            });
        }
        if (this.nextLine >= plan.gcode.length && !this.finishing) {
            this.finishing = true;
            this.finishPage();
        }
    }
    async finishPage() {
        try {
            await this.machine.waitIdle(30 * 60 * 1000);
        }
        catch {
            return;
        }
        if (this.status.peek() !== 'running' && this.status.peek() !== 'pausing')
            return;
        const p = this.pageIdx.peek();
        const plan = this.pages[p].plan;
        const actual = (Date.now() - this.pageStartedAt) / 1000;
        if (!this.dryRun.peek())
            this.hooks.onPageDone?.(plan.estSeconds - this.pageStartEst, actual);
        this.currentStroke.value = plan.strokes.length;
        if (p + 1 < this.pages.length) {
            this.status.value = 'sheet';
            this.message.value = `Страница ${this.pages[p].pageNo + 1} готова. Положите следующий лист и нажмите «Продолжить».`;
            this.hooks.onSheet?.(this.pages[p + 1]);
        }
        else {
            this.status.value = 'done';
            this.progress.value = 1;
            this.eta.value = 0;
            this.stopTicker();
            const sec = (Date.now() - this.startedAt) / 1000;
            this.message.value = `${this.dryRun.peek() ? 'Сухой прогон завершён' : 'Напечатано'}: ${this.pages.length} стр. за ${Math.floor(sec / 60)} мин ${Math.round(sec % 60)} с.`;
            this.hooks.onDone?.((Date.now() - this.startedAt) / 1000);
        }
    }
    /** Лист заменён — печатаем следующую страницу. */
    nextSheet() {
        if (this.status.peek() !== 'sheet')
            return;
        this.message.value = null;
        this.beginPage(this.pageIdx.peek() + 1, 0);
    }
    pause() {
        if (this.status.peek() !== 'running')
            return;
        this.pauseRequested = true;
        this.message.value = 'Пауза: дописываю текущий штрих…';
        this.feed();
    }
    async enterPausing() {
        this.status.value = 'pausing';
        try {
            await this.machine.waitIdle(5 * 60 * 1000);
        }
        catch {
            return;
        }
        if (this.status.peek() !== 'pausing')
            return;
        // между буквами ручка могла быть поднята низко — на паузе поднимаем полностью
        this.machine.enqueue(`G0 Z${this.hooks.upZ().toFixed(2)}`, { quiet: true });
        this.status.value = 'paused';
        this.message.value = 'Пауза. Ручка поднята. Можно поправить лист или ручку.';
    }
    resume() {
        const s = this.status.peek();
        if (s === 'paused' || s === 'pausing') {
            this.pauseRequested = false;
            this.message.value = null;
            this.status.value = 'running';
            // во время паузы ручку могли трогать — сначала гарантированно поднимаем
            this.machine.enqueue('G21 G90', { quiet: true });
            this.machine.enqueue(`G0 Z${this.hooks.upZ().toFixed(2)}`, { quiet: true });
            this.feed();
        }
    }
    /** СТОП: остановить движение, сбросить буфер платы, поднять ручку, запомнить место. */
    async stop() {
        const s = this.status.peek();
        if (!this.active) {
            await this.machine.safeStop(this.hooks.upZ());
            return;
        }
        this.status.value = 'stopping';
        this.message.value = 'Останавливаю…';
        let point = null;
        try {
            if (s === 'running' || s === 'pausing') {
                await this.machine.realtime('!');
                const r = await this.machine.waitStatus((x) => (x.state === 'Hold' && x.subState === 0) || x.state === 'Idle', 2000).catch(() => null);
                point = { page: this.pageIdx.peek(), stroke: this.locate(r ?? this.machine.report) };
            }
            else if (s === 'paused') {
                point = { page: this.pageIdx.peek(), stroke: this.strokeOfLine(this.nextLine) };
            }
            else if (s === 'sheet') {
                point = { page: Math.min(this.pageIdx.peek() + 1, this.pages.length - 1), stroke: 0 };
            }
            await this.machine.safeStop(this.hooks.upZ());
        }
        catch (e) {
            this.message.value = 'Ошибка при остановке: ' + (e?.message ?? e);
        }
        this.stopTicker();
        this.resumePoint.value = point;
        this.status.value = 'stopped';
        this.message.value = point ? 'Остановлено. Можно продолжить с места остановки.' : 'Остановлено.';
    }
    /** Связь пропала посреди печати. */
    interrupted(reason) {
        if (!this.active)
            return;
        const point = { page: this.pageIdx.peek(), stroke: this.locate(this.machine.report) };
        this.stopTicker();
        this.resumePoint.value = point;
        this.status.value = 'interrupted';
        this.message.value = `Связь прервалась (${reason}). После переподключения можно продолжить с места обрыва.`;
    }
    async onLineError(idx, code, text) {
        if (code === -1) {
            // очередь сброшена (стоп, перезагрузка, отключение) — обрабатывается в другом месте
            if (this.status.peek() === 'running' || this.status.peek() === 'pausing')
                this.interrupted(text);
            return;
        }
        if (!this.active || this.status.peek() === 'stopping')
            return;
        const plan = this.plan;
        this.status.value = 'stopping';
        const point = { page: this.pageIdx.peek(), stroke: this.strokeOfLine(idx) };
        try {
            await this.machine.safeStop(this.hooks.upZ());
        }
        catch {
            /* ignore */
        }
        this.stopTicker();
        this.resumePoint.value = point;
        this.status.value = 'error';
        this.message.value = `Плата отклонила строку ${idx + 1} «${plan?.gcode[idx] ?? ''}»: error:${code} — ${text}. Ручка поднята.`;
    }
    strokeOfLine(line) {
        const plan = this.plan;
        if (!plan)
            return 0;
        for (let i = Math.min(line, plan.lineStroke.length - 1); i >= 0; i--) {
            if (plan.lineStroke[i] >= 0)
                return plan.lineStroke[i];
        }
        return 0;
    }
    /** Найти штрих, на котором находится каретка: окно до последней подтверждённой строки. */
    locate(r) {
        const plan = this.plan;
        if (!plan || !plan.strokes.length)
            return 0;
        const acked = this.strokeOfLine(Math.max(this.ackedLine - 1, 0));
        if (!r?.wpos)
            return Math.max(0, acked - 2);
        const [u, v] = this.hooks.toPaper(r.wpos[0], r.wpos[1]);
        const down = this.hooks.penDownAt(r.wpos[2]);
        const lo = Math.max(0, acked - WINDOW);
        let best = acked;
        let bd = Infinity;
        for (let k = acked; k >= lo; k--) {
            const s = plan.strokes[k];
            if (!s)
                continue;
            let d;
            if (down)
                d = polyDist2(s, u, v);
            else if (k === 0)
                d = (s[0] - u) ** 2 + (s[1] - v) ** 2;
            else {
                const p = plan.strokes[k - 1];
                d = segDist2(u, v, p[p.length - 2], p[p.length - 1], s[0], s[1]);
            }
            if (d < bd - 1e-9) {
                bd = d;
                best = k;
            }
        }
        return best;
    }
    /** Обновление прогресса по статусу платы. */
    onStatus(r) {
        const s = this.status.peek();
        if (s !== 'running' && s !== 'pausing')
            return;
        const plan = this.plan;
        if (!plan)
            return;
        const k = this.locate(r);
        if (k !== this.currentStroke.peek())
            this.currentStroke.value = k;
        const doneBefore = this.pages.slice(0, this.pageIdx.peek()).reduce((a, p) => a + p.plan.estSeconds, 0);
        const here = plan.strokeTime[k] ?? 0;
        const total = this.totalEstimate() || 1;
        this.progress.value = Math.min(1, (doneBefore + here) / total);
        const estDoneRun = doneBefore + here - (this.pageIdx.peek() === 0 ? (this.pages[0].plan.strokeTime[0] ?? 0) : 0);
        const elapsed = (Date.now() - this.startedAt) / 1000;
        const ratio = estDoneRun > 20 && elapsed > 10 ? Math.max(0.5, Math.min(2.5, elapsed / estDoneRun)) : 1;
        this.eta.value = Math.max(0, (total - doneBefore - here) * ratio);
    }
    reset() {
        if (this.active)
            return;
        this.status.value = 'idle';
        this.message.value = null;
        this.currentStroke.value = -1;
        this.progress.value = 0;
    }
}
export { sleep };
