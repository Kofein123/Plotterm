export const SIM_SETTINGS = [
    [0, '10'], [1, '250'], [2, '0'], [3, '0'], [4, '0'], [5, '0'], [6, '0'], [10, '1'], [11, '0.010'], [12, '0.002'],
    [13, '0'], [20, '0'], [21, '0'], [22, '0'], [23, '0'], [24, '25.000'], [25, '1000.000'], [26, '250'], [27, '1.000'],
    [100, '80.000'], [101, '80.000'], [102, '65.000'], [110, '12000.000'], [111, '12000.000'], [112, '3000.000'],
    [120, '9000.000'], [121, '6000.000'], [122, '500.000'], [130, '300.000'], [131, '300.000'], [132, '20.000'],
];
export class SimulatorTransport {
    kind = 'sim';
    label = 'Симулятор';
    onData = () => { };
    onClose = () => { };
    /** во сколько раз быстрее реального времени */
    speedup = 1;
    /** касается ли ручка бумаги при данном рабочем Z (Z = 0 — касание) */
    inkTest = (z) => z <= 0.01;
    trace = {};
    rxSize = 128;
    plannerSize = 15;
    rx = '';
    rxBytes = 0;
    planner = [];
    cur = null;
    pos = [0, 0, 0];
    wco = [0, 0, 0];
    state = 'Idle';
    holdComplete = false;
    absolute = true;
    feed = 1000;
    motion = 0;
    feedOv = 100;
    timer = null;
    last = 0;
    settings = new Map(SIM_SETTINGS);
    opened = false;
    constructor(opts) {
        if (opts?.startPos)
            this.pos = [...opts.startPos];
        if (opts?.speedup)
            this.speedup = opts.speedup;
    }
    async open() {
        this.opened = true;
        this.last = now();
        this.timer = setInterval(() => this.tick(), 16);
        setTimeout(() => this.emit("\r\nGrbl 1.3a ['$' for help]\r\n[MSG:'$H'|'$X' to unlock]\r\n"), 50);
    }
    async close() {
        this.opened = false;
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        this.onClose('отключено');
    }
    /** Имитировать выдёргивание кабеля. */
    unplug() {
        this.opened = false;
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        this.onClose('обрыв связи (симуляция)');
    }
    get machinePos() {
        return [...this.pos];
    }
    emit(s) {
        if (!this.opened)
            return;
        queueMicrotask(() => this.onData(s));
    }
    async write(data) {
        if (!this.opened)
            throw new Error('порт не открыт');
        for (const b of data) {
            // мгновенные команды
            if (b === 0x3f) {
                this.reportStatus();
                continue;
            } // ?
            if (b === 0x21) {
                this.hold();
                continue;
            } // !
            if (b === 0x7e) {
                this.cycleStart();
                continue;
            } // ~
            if (b === 0x18) {
                this.softReset();
                continue;
            }
            if (b === 0x85) {
                this.jogCancel();
                continue;
            }
            if (b >= 0x90 && b <= 0x94) {
                this.override(b);
                continue;
            }
            if (b >= 0x80)
                continue;
            this.rx += String.fromCharCode(b);
            this.rxBytes++;
            if (this.rxBytes > this.rxSize) {
                // переполнение буфера — так бывает при неправильной потоковой отправке
                console.error('[sim] RX buffer overflow', this.rxBytes);
            }
        }
        this.processRx();
    }
    processRx() {
        while (true) {
            const nl = this.rx.indexOf('\n');
            if (nl < 0)
                return;
            const raw = this.rx.slice(0, nl).replace(/\r/g, '');
            const line = raw.replace(/;.*$/, '').replace(/\(.*?\)/g, '').trim();
            // G-код движения ждёт свободного места в планировщике
            if (this.isMotion(line) && this.planner.length >= this.plannerSize)
                return;
            this.rx = this.rx.slice(nl + 1);
            this.rxBytes -= nl + 1;
            this.execLine(line);
        }
    }
    isMotion(line) {
        return /^\$J=/i.test(line) || (/[XYZ]/i.test(line) && !/^\$/.test(line) && !/G10/i.test(line)) || /G4/i.test(line);
    }
    ok() {
        this.emit('ok\r\n');
    }
    err(n) {
        this.emit(`error:${n}\r\n`);
    }
    execLine(line) {
        if (line === '')
            return this.ok();
        const up = line.toUpperCase();
        if (up.startsWith('$'))
            return this.dollar(up);
        if (this.state === 'Alarm')
            return this.err(9);
        const words = [...up.replace(/\s+/g, '').matchAll(/([A-Z])(-?\d*\.?\d+)/g)].map((m) => [m[1], Number(m[2])]);
        let g10 = false, g4 = false, p = null, l = null;
        const ax = {};
        let motionSet = null;
        for (const [w, v] of words) {
            if (w === 'G') {
                if (v === 0)
                    motionSet = 0;
                else if (v === 1)
                    motionSet = 1;
                else if (v === 90)
                    this.absolute = true;
                else if (v === 91)
                    this.absolute = false;
                else if (v === 10)
                    g10 = true;
                else if (v === 4)
                    g4 = true;
                else if ([17, 21, 54, 94, 40, 49, 80].includes(v)) { /* ok */ }
                else
                    return this.err(20);
            }
            else if (w === 'X' || w === 'Y' || w === 'Z')
                ax[w] = v;
            else if (w === 'F')
                this.feed = v;
            else if (w === 'P')
                p = v;
            else if (w === 'L')
                l = v;
            else if (w === 'M' || w === 'S' || w === 'T' || w === 'N') { /* ignore */ }
            else
                return this.err(20);
        }
        if (g10) {
            if (l !== 20 && l !== 2)
                return this.err(28);
            const target = this.lastTarget();
            ['X', 'Y', 'Z'].forEach((a, i) => {
                if (ax[a] !== undefined)
                    this.wco[i] = l === 20 ? target[i] - ax[a] : ax[a];
            });
            return this.ok();
        }
        if (g4) {
            this.planner.push({ to: this.lastTarget(), feed: 0, rapid: false, dwell: p ?? 0 });
            return this.ok();
        }
        if (motionSet !== null)
            this.motion = motionSet;
        if (Object.keys(ax).length === 0)
            return this.ok();
        if (this.motion === 1 && !this.feed)
            return this.err(22);
        const from = this.lastTarget();
        const to = [...from];
        ['X', 'Y', 'Z'].forEach((a, i) => {
            if (ax[a] === undefined)
                return;
            to[i] = this.absolute ? ax[a] + this.wco[i] : from[i] + ax[a];
        });
        this.planner.push({ to, feed: this.motion === 0 ? this.maxRate() : this.feed, rapid: this.motion === 0 });
        if (this.state === 'Idle')
            this.state = 'Run';
        this.ok();
    }
    maxRate() {
        return Number(this.settings.get(110) ?? 12000);
    }
    lastTarget() {
        const b = this.planner[this.planner.length - 1] ?? this.cur;
        return b ? [...b.to] : [...this.pos];
    }
    dollar(up) {
        if (up === '$$') {
            let s = '';
            for (const [k, v] of this.settings)
                s += `$${k}=${v}\r\n`;
            this.emit(s);
            return this.ok();
        }
        if (up === '$I') {
            this.emit('[VER:1.3a.20220101:BtWriter]\r\n[OPT:VHM,15,128]\r\n');
            return this.ok();
        }
        if (up === '$G') {
            this.emit(`[GC:G${this.motion} G54 G17 G21 G${this.absolute ? 90 : 91} G94 M5 M9 T0 F${this.feed} S0]\r\n`);
            return this.ok();
        }
        if (up === '$#') {
            this.emit(`[G54:${this.wco.map((v) => v.toFixed(3)).join(',')}]\r\n`);
            return this.ok();
        }
        if (up === '$X') {
            if (this.state === 'Alarm')
                this.state = 'Idle';
            this.emit('[MSG:Caution: Unlocked]\r\n');
            return this.ok();
        }
        if (up === '$H')
            return this.err(5);
        let m = up.match(/^\$(\d+)=(.*)$/);
        if (m) {
            if (this.state !== 'Idle')
                return this.err(8);
            this.settings.set(Number(m[1]), m[2]);
            return this.ok();
        }
        m = up.match(/^\$J=(.*)$/);
        if (m) {
            if (this.state !== 'Idle' && this.state !== 'Jog')
                return this.err(8);
            const body = m[1].replace(/\s+/g, '');
            const rel = /G91/.test(body);
            const words = [...body.matchAll(/([XYZF])(-?\d*\.?\d+)/g)];
            const f = words.find((w) => w[1] === 'F');
            if (!f)
                return this.err(22);
            const from = this.lastTarget();
            const to = [...from];
            for (const w of words) {
                const i = 'XYZ'.indexOf(w[1]);
                if (i < 0)
                    continue;
                to[i] = rel ? from[i] + Number(w[2]) : Number(w[2]) + this.wco[i];
            }
            this.planner.push({ to, feed: Number(f[2]), rapid: false, jog: true });
            this.state = 'Jog';
            return this.ok();
        }
        return this.err(3);
    }
    reportStatus() {
        const st = this.state === 'Hold' ? `Hold:${this.holdComplete ? 0 : 1}` : this.state;
        const f = this.cur && this.state !== 'Hold' ? (this.cur.feed * this.feedOv) / 100 : 0;
        const free = this.plannerSize - this.planner.length;
        const rxFree = this.rxSize - this.rxBytes;
        const fmt = (v) => v.toFixed(3);
        this.emit(`<${st}|MPos:${this.pos.map(fmt).join(',')}|Bf:${free},${rxFree}|FS:${Math.round(f)},0|Ov:${this.feedOv},100,100|WCO:${this.wco.map(fmt).join(',')}>\r\n`);
    }
    hold() {
        if (this.state === 'Run' || this.state === 'Jog') {
            if (this.state === 'Jog')
                return this.jogCancel();
            this.state = 'Hold';
            this.holdComplete = false;
            setTimeout(() => (this.holdComplete = true), 60 / this.speedup);
        }
    }
    cycleStart() {
        if (this.state === 'Hold')
            this.state = this.cur || this.planner.length ? 'Run' : 'Idle';
    }
    jogCancel() {
        if (this.state !== 'Jog')
            return;
        this.planner = this.planner.filter((b) => !b.jog);
        if (this.cur?.jog)
            this.cur = null;
        this.state = this.planner.length ? 'Run' : 'Idle';
    }
    override(b) {
        if (b === 0x90)
            this.feedOv = 100;
        if (b === 0x91)
            this.feedOv += 10;
        if (b === 0x92)
            this.feedOv -= 10;
        if (b === 0x93)
            this.feedOv += 1;
        if (b === 0x94)
            this.feedOv -= 1;
        this.feedOv = Math.max(10, Math.min(200, this.feedOv));
    }
    softReset() {
        const moving = this.state === 'Run' || this.state === 'Jog';
        this.planner = [];
        this.cur = null;
        this.rx = '';
        this.rxBytes = 0;
        this.absolute = true;
        this.motion = 0;
        this.feedOv = 100;
        this.state = moving ? 'Alarm' : 'Idle';
        this.emit(`\r\nGrbl 1.3a ['$' for help]\r\n${moving ? 'ALARM:3\r\n' : ''}`);
    }
    tick() {
        const t = now();
        let dt = ((t - this.last) / 1000) * this.speedup;
        this.last = t;
        if (this.state === 'Hold' || this.state === 'Alarm')
            return;
        while (dt > 0) {
            if (!this.cur) {
                this.cur = this.planner.shift() ?? null;
                this.processRx();
                if (!this.cur) {
                    if (this.state === 'Run' || this.state === 'Jog')
                        this.state = 'Idle';
                    return;
                }
            }
            const b = this.cur;
            if (b.dwell !== undefined) {
                b.dwell -= dt;
                if (b.dwell > 0)
                    return;
                dt = -b.dwell;
                this.cur = null;
                continue;
            }
            const d = [b.to[0] - this.pos[0], b.to[1] - this.pos[1], b.to[2] - this.pos[2]];
            const dist = Math.hypot(d[0], d[1], d[2]);
            const v = ((b.rapid ? b.feed : (b.feed * this.feedOv) / 100) / 60) * (d[2] !== 0 && d[0] === 0 && d[1] === 0 ? 0.25 : 1);
            const step = v * dt;
            const from = [...this.pos];
            if (step >= dist) {
                this.pos = [...b.to];
                dt -= dist / Math.max(v, 1e-6);
                this.cur = null;
            }
            else {
                const k = step / dist;
                this.pos = [this.pos[0] + d[0] * k, this.pos[1] + d[1] * k, this.pos[2] + d[2] * k];
                dt = 0;
            }
            if (this.inkTest(from[2] - this.wco[2]) && this.inkTest(this.pos[2] - this.wco[2])) {
                this.trace.onInk?.(from[0] - this.wco[0], from[1] - this.wco[1], this.pos[0] - this.wco[0], this.pos[1] - this.wco[1]);
            }
        }
    }
}
function now() {
    return globalThis.performance?.now() ?? Date.now();
}
