// Транспорт: байты туда-обратно. Реализации: Web Serial (USB/Bluetooth COM) и симулятор.
const enc = new TextEncoder();
/** Строка G-кода → байты (UTF-8 + \n). */
export function encodeLine(line) {
    return enc.encode(line + '\n');
}
/** Мгновенная команда GRBL: ровно один байт (0x18, 0x85, 0x90...). */
export function encodeRealtime(cmd) {
    const b = new Uint8Array(cmd.length);
    for (let i = 0; i < cmd.length; i++)
        b[i] = cmd.charCodeAt(i) & 0xff;
    return b;
}
/** Длина строки в байтах для подсчёта буфера GRBL (с \n). */
export function lineBytes(line) {
    return enc.encode(line).length + 1;
}
