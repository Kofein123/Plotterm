// Подключение к плате через Web Serial (Chrome / Edge). Работает и с Bluetooth COM-портами Windows.
import type { Transport } from './transport.ts';

// Минимальные типы Web Serial API (их нет в стандартной библиотеке TypeScript)
export interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: string;
}
export interface SerialPortLike {
  open(o: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
  setSignals(s: { dataTerminalReady?: boolean; requestToSend?: boolean; break?: boolean }): Promise<void>;
  forget?(): Promise<void>;
}
interface SerialLike extends EventTarget {
  requestPort(o?: { filters?: SerialPortInfo[]; allowedBluetoothServiceClassIds?: string[] }): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

export function serialApi(): SerialLike | null {
  return (navigator as any).serial ?? null;
}

export const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';

export function describePort(info: SerialPortInfo): string {
  if (info.bluetoothServiceClassId) return 'Bluetooth';
  const vid = info.usbVendorId;
  if (vid === 0x1a86) return 'USB (CH340)';
  if (vid === 0x10c4) return 'USB (CP210x)';
  if (vid === 0x0403) return 'USB (FTDI)';
  if (vid !== undefined) return `USB ${vid.toString(16).padStart(4, '0')}:${(info.usbProductId ?? 0).toString(16).padStart(4, '0')}`;
  return 'COM-порт';
}

export interface SerialOptions {
  baudRate: number;
  /** не дёргать DTR/RTS после открытия (иначе ESP32 может перезагрузиться) */
  keepSignals: boolean;
}

export class WebSerialTransport implements Transport {
  readonly kind = 'serial' as const;
  label: string;
  port: SerialPortLike;
  onData: (text: string) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private closing = false;
  private loop: Promise<void> | null = null;
  private opts: SerialOptions;

  constructor(port: SerialPortLike, opts: SerialOptions) {
    this.port = port;
    this.opts = opts;
    this.label = describePort(port.getInfo());
  }

  async open() {
    await this.port.open({ baudRate: this.opts.baudRate, bufferSize: 8192 });
    if (!this.opts.keepSignals) {
      // Сначала RTS, потом DTR: так авто-ресет ESP32 (EN ← RTS при DTR=0) не срабатывает.
      try {
        await this.port.setSignals({ requestToSend: false });
        await this.port.setSignals({ dataTerminalReady: false });
      } catch {
        /* драйвер может не поддерживать — не страшно */
      }
    }
    this.writer = this.port.writable!.getWriter();
    this.loop = this.readLoop();
  }

  private async readLoop() {
    const decoder = new TextDecoder();
    let reason = 'порт закрыт';
    try {
      while (this.port.readable && !this.closing) {
        this.reader = this.port.readable.getReader();
        try {
          while (true) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value) this.onData(decoder.decode(value, { stream: true }));
          }
        } finally {
          this.reader.releaseLock();
          this.reader = null;
        }
      }
    } catch (e: any) {
      reason = e?.message ? `обрыв связи: ${e.message}` : 'обрыв связи';
    }
    try {
      this.writer?.releaseLock();
    } catch {
      /* ignore */
    }
    this.writer = null;
    try {
      await this.port.close();
    } catch {
      /* уже закрыт или устройство пропало */
    }
    this.onClose(this.closing ? 'отключено' : reason);
  }

  async write(data: Uint8Array) {
    if (!this.writer) throw new Error('порт не открыт');
    await this.writer.write(data);
  }

  async close() {
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    await this.loop;
  }
}
