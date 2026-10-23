export function serialApi() {
    return navigator.serial ?? null;
}
export const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';
export function describePort(info) {
    if (info.bluetoothServiceClassId)
        return 'Bluetooth';
    const vid = info.usbVendorId;
    if (vid === 0x1a86)
        return 'USB (CH340)';
    if (vid === 0x10c4)
        return 'USB (CP210x)';
    if (vid === 0x0403)
        return 'USB (FTDI)';
    if (vid !== undefined)
        return `USB ${vid.toString(16).padStart(4, '0')}:${(info.usbProductId ?? 0).toString(16).padStart(4, '0')}`;
    return 'COM-порт';
}
export class WebSerialTransport {
    kind = 'serial';
    label;
    port;
    onData = () => { };
    onClose = () => { };
    reader = null;
    writer = null;
    closing = false;
    loop = null;
    opts;
    constructor(port, opts) {
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
            }
            catch {
                /* драйвер может не поддерживать — не страшно */
            }
        }
        this.writer = this.port.writable.getWriter();
        this.loop = this.readLoop();
    }
    async readLoop() {
        const decoder = new TextDecoder();
        let reason = 'порт закрыт';
        try {
            while (this.port.readable && !this.closing) {
                this.reader = this.port.readable.getReader();
                try {
                    while (true) {
                        const { value, done } = await this.reader.read();
                        if (done)
                            break;
                        if (value)
                            this.onData(decoder.decode(value, { stream: true }));
                    }
                }
                finally {
                    this.reader.releaseLock();
                    this.reader = null;
                }
            }
        }
        catch (e) {
            reason = e?.message ? `обрыв связи: ${e.message}` : 'обрыв связи';
        }
        try {
            this.writer?.releaseLock();
        }
        catch {
            /* ignore */
        }
        this.writer = null;
        try {
            await this.port.close();
        }
        catch {
            /* уже закрыт или устройство пропало */
        }
        this.onClose(this.closing ? 'отключено' : reason);
    }
    async write(data) {
        if (!this.writer)
            throw new Error('порт не открыт');
        await this.writer.write(data);
    }
    async close() {
        this.closing = true;
        try {
            await this.reader?.cancel();
        }
        catch {
            /* ignore */
        }
        await this.loop;
    }
}
