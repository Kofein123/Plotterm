// Контроллер платы GRBL: очередь команд со счётом символов, опрос статуса, ручное управление,
// безопасная остановка (пауза движения → сброс → ручка вверх).
import { signal, batch } from '../ui/reactive.ts';
import { classify, RT, type GrblState, type StatusReport } from './protocol.ts';
import { encodeLine, encodeRealtime, lineBytes, type Transport } from './transport.ts';

export type ConnState = 'disconnected' | 'connecting' | 'connected';

export interface LogEntry {
  t: number;
  dir: 'tx' | 'rx' | 'info' | 'err';
  text: string;
}

interface Cmd {
  line: string;
  bytes: number;
  quiet: boolean;
  info: string[];
  onOk?: (info: string[]) => void;
  onError?: (code: number, text: string) => void;
}

export class GrblError extends Error {
  code: number;
  constructor(code: number, text: string) {
    super(text);
    this.code = code;
  }
}

export class Machine {
  // --- состояние (реактивное) ---
  conn = signal<ConnState>('disconnected');
  transportLabel = signal('');
  state = signal<GrblState>('Unknown');
  subState = signal<number | null>(null);
  mpos = signal<[number, number, number]>([0, 0, 0]);
  wpos = signal<[number, number, number]>([0, 0, 0]);
  feedRate = signal(0);
  ov = signal<[number, number, number]>([100, 100, 100]);
  pins = signal('');
  version = signal('');
  settings = signal<Map<number | string, string>>(new Map());
  alarm = signal<string | null>(null);
  lastError = signal<string | null>(null);
  log = signal<LogEntry[]>([]);
  /** счётчик перезагрузок платы, которые произошли не по нашей команде */
  unexpectedResets = signal(0);
  /** первый статус после подключения пришёл */
  firstStatus = signal(false);

  // --- внутреннее ---
  transport: Transport | null = null;
  rxSize = 127;
  private wco: [number, number, number] = [0, 0, 0];
  private buf = '';
  private inflight: Cmd[] = [];
  private pending: Cmd[] = [];
  private usedBytes = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private expectReset = false;
  private writing: Promise<void> = Promise.resolve();
  private stateWaiters: { test: (s: StatusReport) => boolean; resolve: (s: StatusReport) => void }[] = [];
  private welcomeWaiters: (() => void)[] = [];
  private lastReport: StatusReport | null = null;
  onStatus: ((r: StatusReport) => void) | null = null;
  onDisconnect: ((reason: string) => void) | null = null;
  onReset: ((unexpected: boolean) => void) | null = null;

  get connected() {
    return this.conn.peek() === 'connected';
  }

  get queueLength() {
    return this.pending.length + this.inflight.length;
  }

  get report() {
    return this.lastReport;
  }

  addLog(dir: LogEntry['dir'], text: string) {
    const l = this.log.peek();
    const next = l.length > 600 ? l.slice(l.length - 500) : l.slice();
    next.push({ t: Date.now(), dir, text });
    this.log.value = next;
  }

  async connect(t: Transport) {
    if (this.transport) await this.disconnect();
    this.conn.value = 'connecting';
    this.transport = t;
    this.transportLabel.value = t.label;
    this.firstStatus.value = false;
    this.buf = '';
    this.resetQueues('подключение');
    t.onData = (s) => this.onData(s);
    t.onClose = (reason) => this.handleClose(reason);
    try {
      await t.open();
    } catch (e: any) {
      this.transport = null;
      this.conn.value = 'disconnected';
      throw e;
    }
    this.conn.value = 'connected';
    this.addLog('info', `подключено: ${t.label}`);
    // ESP32 может перезагрузиться при открытии порта — даём ему проснуться
    this.expectReset = true;
    setTimeout(() => (this.expectReset = false), 2500);
    await this.writeRaw(encodeLine(''));
    this.startPolling();
    await this.waitStatus(() => true, 3000).catch(() => {
      this.addLog('err', 'плата не отвечает на «?» — проверьте скорость порта (115200) и что это GRBL');
    });
    this.firstStatus.value = true;
    // настройки и версия
    try {
      await this.refreshSettings();
      const info = await this.send('$I');
      const ver = info.find((l) => l.startsWith('[VER:'));
      if (ver) this.version.value = ver.slice(5, -1);
    } catch {
      /* не критично */
    }
  }

  async refreshSettings() {
    const lines = await this.send('$$');
    const map = new Map<number | string, string>();
    for (const l of lines) {
      const c = classify(l);
      if (c.type === 'setting') map.set(c.key, c.value);
    }
    if (map.size) this.settings.value = map;
    return map;
  }

  settingNum(key: number, fallback: number): number {
    const v = this.settings.peek().get(key);
    const n = v === undefined ? NaN : parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  async disconnect() {
    const t = this.transport;
    if (!t) return;
    this.stopPolling();
    this.transport = null;
    try {
      await t.close();
    } catch {
      /* ignore */
    }
    if (this.conn.peek() !== 'disconnected') this.handleClose('отключено');
  }

  private handleClose(reason: string) {
    if (this.conn.peek() === 'disconnected' && !this.transport) return; // уже обработано
    this.stopPolling();
    this.transport = null;
    this.resetQueues(reason);
    batch(() => {
      this.conn.value = 'disconnected';
      this.state.value = 'Unknown';
    });
    this.addLog('info', reason);
    this.onDisconnect?.(reason);
  }

  private startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      if (this.transport) this.writeRaw(encodeRealtime(RT.status)).catch(() => {});
    }, 150);
  }

  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private writeRaw(data: Uint8Array): Promise<void> {
    const t = this.transport;
    if (!t) return Promise.reject(new Error('нет связи с платой'));
    // запись строго по порядку
    this.writing = this.writing.then(() => t.write(data)).catch((e) => {
      this.addLog('err', 'ошибка записи: ' + (e?.message ?? e));
    });
    return this.writing;
  }

  /** Мгновенная команда (не занимает буфер). */
  realtime(cmd: string) {
    return this.writeRaw(encodeRealtime(cmd));
  }

  /** Поставить строку в очередь. */
  enqueue(line: string, opts: { quiet?: boolean; onOk?: (info: string[]) => void; onError?: (code: number, text: string) => void } = {}) {
    const clean = line.trim();
    const cmd: Cmd = { line: clean, bytes: lineBytes(clean), quiet: !!opts.quiet, info: [], onOk: opts.onOk, onError: opts.onError };
    this.pending.push(cmd);
    this.pump();
  }

  /** Отправить команду и дождаться ok (вернёт строки ответа) или ошибки. */
  send(line: string, quiet = false): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (!this.transport) return reject(new Error('нет связи с платой'));
      this.enqueue(line, {
        quiet,
        onOk: resolve,
        onError: (code, text) => reject(new GrblError(code, text)),
      });
    });
  }

  private pump() {
    if (!this.transport) return;
    while (this.pending.length) {
      const c = this.pending[0];
      if (this.inflight.length && this.usedBytes + c.bytes > this.rxSize) break;
      this.pending.shift();
      this.inflight.push(c);
      this.usedBytes += c.bytes;
      if (!c.quiet) this.addLog('tx', c.line);
      this.writeRaw(encodeLine(c.line));
    }
  }

  /** Очистить ещё не отправленные строки. */
  clearPending(reason = 'отменено') {
    const p = this.pending;
    this.pending = [];
    for (const c of p) c.onError?.(-1, reason);
  }

  private resetQueues(reason: string) {
    const all = [...this.inflight, ...this.pending];
    this.inflight = [];
    this.pending = [];
    this.usedBytes = 0;
    for (const c of all) c.onError?.(-1, reason);
  }

  private onData(s: string) {
    this.buf += s;
    let i: number;
    while ((i = this.buf.search(/\r?\n/)) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(this.buf[i] === '\r' ? i + 2 : i + 1);
      if (line) this.handleLine(line);
    }
    // статус может прийти без перевода строки в конце пакета — ждём следующего куска
  }

  private handleLine(line: string) {
    const c = classify(line);
    switch (c.type) {
      case 'status':
        this.applyStatus(c.report);
        return;
      case 'ok': {
        const cmd = this.inflight.shift();
        if (cmd) {
          this.usedBytes -= cmd.bytes;
          cmd.onOk?.(cmd.info);
        }
        this.pump();
        return;
      }
      case 'error': {
        const cmd = this.inflight.shift();
        this.addLog('err', `${cmd ? cmd.line + ' → ' : ''}error:${c.code} ${c.text}`);
        this.lastError.value = c.text;
        if (cmd) {
          this.usedBytes -= cmd.bytes;
          cmd.onError?.(c.code, c.text);
        }
        this.pump();
        return;
      }
      case 'alarm':
        this.alarm.value = `ALARM:${c.code} — ${c.text}`;
        this.addLog('err', `ALARM:${c.code} ${c.text}`);
        return;
      case 'welcome': {
        const unexpected = !this.expectReset;
        this.expectReset = false;
        this.resetQueues('плата перезагрузилась');
        this.version.value = c.version;
        this.addLog('info', line + (unexpected ? ' — плата перезагрузилась' : ''));
        if (unexpected) this.unexpectedResets.value++;
        const w = this.welcomeWaiters;
        this.welcomeWaiters = [];
        w.forEach((f) => f());
        this.onReset?.(unexpected);
        return;
      }
      default: {
        const cmd = this.inflight[0];
        if (cmd) cmd.info.push(line);
        if (!cmd || !cmd.quiet || c.type === 'msg') this.addLog('rx', line);
      }
    }
  }

  private applyStatus(r: StatusReport) {
    if (r.wco) this.wco = r.wco;
    let mpos = r.mpos;
    let wpos = r.wpos;
    if (mpos && !wpos) wpos = [mpos[0] - this.wco[0], mpos[1] - this.wco[1], mpos[2] - this.wco[2]];
    if (wpos && !mpos) mpos = [wpos[0] + this.wco[0], wpos[1] + this.wco[1], wpos[2] + this.wco[2]];
    this.lastReport = { ...r, mpos, wpos };
    batch(() => {
      this.state.value = r.state;
      this.subState.value = r.subState;
      if (mpos) this.mpos.value = mpos;
      if (wpos) this.wpos.value = wpos;
      if (r.feed !== null) this.feedRate.value = r.feed;
      if (r.ov) this.ov.value = r.ov;
      this.pins.value = r.pins;
      if (r.state !== 'Alarm' && this.alarm.peek()) this.alarm.value = null;
      if (r.state === 'Alarm' && !this.alarm.peek()) this.alarm.value = 'ALARM — плата заблокирована';
    });
    // Bf: подсказка о реальном размере буфера платы
    if (r.buffer && this.inflight.length === 0 && r.buffer[1] > 0) {
      const size = Math.min(1024, r.buffer[1]);
      if (size !== this.rxSize && size >= 64) this.rxSize = size - 1;
    }
    const ws = this.stateWaiters;
    this.stateWaiters = [];
    for (const w of ws) {
      if (w.test(this.lastReport)) w.resolve(this.lastReport);
      else this.stateWaiters.push(w);
    }
    this.onStatus?.(this.lastReport);
  }

  /** Дождаться статуса, удовлетворяющего условию. */
  waitStatus(test: (s: StatusReport) => boolean, timeoutMs = 5000): Promise<StatusReport> {
    return new Promise((resolve, reject) => {
      const w = { test, resolve: (s: StatusReport) => { clearTimeout(timer); resolve(s); } };
      const timer = setTimeout(() => {
        this.stateWaiters = this.stateWaiters.filter((x) => x !== w);
        reject(new Error('плата не ответила вовремя'));
      }, timeoutMs);
      this.stateWaiters.push(w);
    });
  }

  /** Дождаться, пока все команды выполнены и плата стоит (Idle). */
  async waitIdle(timeoutMs = 60000) {
    const start = Date.now();
    while (this.queueLength > 0) {
      if (Date.now() - start > timeoutMs) throw new Error('очередь не опустела');
      await sleep(30);
    }
    // небольшой запас: статус «Idle» должен прийти после последнего ok
    await sleep(160);
    await this.waitStatus((s) => s.state === 'Idle' || s.state === 'Alarm', Math.max(1000, timeoutMs - (Date.now() - start)));
  }

  private waitWelcome(timeoutMs: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      this.welcomeWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /**
   * Безопасная остановка: пауза движения (без потери положения) → программный сброс →
   * разблокировка при необходимости → ручка вверх.
   */
  async safeStop(upZ: number | null) {
    if (!this.transport) return;
    this.clearPending('остановлено');
    const st = this.state.peek();
    if (st === 'Jog') {
      await this.realtime(RT.jogCancel);
      await this.waitStatus((s) => s.state !== 'Jog', 1500).catch(() => {});
    }
    if (st === 'Run' || st === 'Hold') {
      await this.realtime(RT.hold);
      await this.waitStatus((s) => (s.state === 'Hold' && s.subState === 0) || s.state === 'Idle', 2000).catch(() => {});
    }
    this.expectReset = true;
    await this.realtime(RT.reset);
    await this.waitWelcome(2500);
    this.expectReset = false;
    this.resetQueues('остановлено');
    const s = await this.waitStatus(() => true, 2000).catch(() => null);
    if (s?.state === 'Alarm') await this.send('$X').catch(() => {});
    await this.send('G21 G90').catch(() => {});
    if (upZ !== null) await this.send(`G0 Z${upZ.toFixed(2)}`).catch(() => {});
    // «остановлено» = ручка действительно поднята, а не только команда принята
    await this.waitIdle(8000).catch(() => {});
  }

  async unlock() {
    await this.send('$X');
    this.alarm.value = null;
  }

  /** Относительное ручное перемещение. */
  jog(dx: number, dy: number, dz: number, feed: number) {
    const parts: string[] = [];
    if (dx) parts.push('X' + dx.toFixed(3));
    if (dy) parts.push('Y' + dy.toFixed(3));
    if (dz) parts.push('Z' + dz.toFixed(3));
    if (!parts.length) return Promise.resolve([]);
    return this.send(`$J=G91 G21 ${parts.join(' ')} F${Math.round(feed)}`);
  }

  /** Абсолютное перемещение в рабочих координатах (G90). */
  jogTo(x: number | null, y: number | null, z: number | null, feed: number) {
    const parts: string[] = [];
    if (x !== null) parts.push('X' + x.toFixed(3));
    if (y !== null) parts.push('Y' + y.toFixed(3));
    if (z !== null) parts.push('Z' + z.toFixed(3));
    if (!parts.length) return Promise.resolve([]);
    return this.send(`$J=G90 G21 ${parts.join(' ')} F${Math.round(feed)}`);
  }

  cancelJog() {
    return this.realtime(RT.jogCancel);
  }

  /** Установить подачу на ходу (оверрайд) в процентах 10–200: сброс к 100 % и шаги ±10/±1. */
  async setFeedOverride(target: number) {
    target = Math.max(10, Math.min(200, Math.round(target)));
    const seq: string[] = [RT.feedReset];
    let cur = 100;
    while (cur !== target) {
      const diff = target - cur;
      const big = Math.abs(diff) >= 10;
      seq.push(diff > 0 ? (big ? RT.feedPlus10 : RT.feedPlus1) : big ? RT.feedMinus10 : RT.feedMinus1);
      cur += (diff > 0 ? 1 : -1) * (big ? 10 : 1);
    }
    await this.realtime(seq.join(''));
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
