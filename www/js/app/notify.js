// Всплывающие сообщения, звук, системные уведомления, запрет сна экрана.
import { signal } from "../ui/reactive.js";
export const toasts = signal([]);
let nextId = 1;
export function toast(text, kind = 'info', ms = kind === 'err' ? 9000 : 4500) {
    const t = { id: nextId++, kind, text };
    toasts.value = [...toasts.peek(), t].slice(-5);
    setTimeout(() => (toasts.value = toasts.peek().filter((x) => x.id !== t.id)), ms);
}
let audio = null;
/** Короткий сигнал: «готово» (2 тона) или «смените лист» (3 тона). */
export function beep(kind = 'done') {
    try {
        audio ??= new AudioContext();
        const ctx = audio;
        const notes = kind === 'sheet' ? [660, 880, 660] : kind === 'error' ? [300, 220] : [660, 990];
        notes.forEach((f, i) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.frequency.value = f;
            o.type = 'sine';
            const t0 = ctx.currentTime + i * 0.22;
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
            o.connect(g).connect(ctx.destination);
            o.start(t0);
            o.stop(t0 + 0.21);
        });
    }
    catch {
        /* звук недоступен */
    }
}
export async function askNotifications() {
    try {
        if ('Notification' in window && Notification.permission === 'default')
            await Notification.requestPermission();
    }
    catch {
        /* ignore */
    }
}
export function systemNotify(title, body) {
    try {
        if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
            new Notification(title, { body, icon: './icon.svg', tag: 'plotterm' });
        }
    }
    catch {
        /* ignore */
    }
}
let wakeLock = null;
export async function keepAwake(on) {
    try {
        if (on && !wakeLock && 'wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener?.('release', () => (wakeLock = null));
        }
        else if (!on && wakeLock) {
            await wakeLock.release();
            wakeLock = null;
        }
    }
    catch {
        /* браузер не разрешил */
    }
}
export function downloadText(name, text, type = 'text/plain') {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
    }, 1000);
}
export function pickFile(accept) {
    return new Promise((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept;
        inp.onchange = () => resolve(inp.files?.[0] ?? null);
        inp.addEventListener('cancel', () => resolve(null));
        inp.click();
    });
}
export function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec <= 0)
        return '0:00';
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}
export function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}
