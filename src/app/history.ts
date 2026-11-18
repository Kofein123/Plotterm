// Отмена и возврат: помним недавние состояния конспекта (текст, шрифт, бумага).
// Запись с задержкой, чтобы набор текста не превращался в сотню шагов отмены.
import { signal, effect } from '../ui/reactive.ts';
import { app } from './state.ts';
import type { PaperSettings, TypographySettings } from '../core/types.ts';

interface Snap {
  text: string;
  typo: TypographySettings;
  paper: PaperSettings;
}

const LIMIT = 60;
const PAUSE = 500;

const past: Snap[] = [];
const future: Snap[] = [];
export const canUndo = signal(false);
export const canRedo = signal(false);

let current: Snap | null = null;
let applying = false;
let timer: ReturnType<typeof setTimeout> | undefined;

const snap = (): Snap => ({ text: app.text.peek(), typo: app.typo.peek(), paper: app.paper.peek() });
const same = (a: Snap, b: Snap) => a.text === b.text && a.typo === b.typo && a.paper === b.paper;

function sync() {
  canUndo.value = past.length > 0;
  canRedo.value = future.length > 0;
}

function apply(s: Snap) {
  applying = true;
  app.text.value = s.text;
  app.typo.value = s.typo;
  app.paper.value = s.paper;
  current = s;
  clearTimeout(timer);
  applying = false;
  sync();
}

/** Запомнить текущее состояние сразу, не дожидаясь паузы (перед шагом правки). */
export function mark() {
  clearTimeout(timer);
  const now = snap();
  if (current && same(current, now)) return;
  if (current) {
    past.push(current);
    if (past.length > LIMIT) past.shift();
    future.length = 0;
  }
  current = now;
  sync();
}

export function undo() {
  mark();
  const prev = past.pop();
  if (!prev) return;
  if (current) future.push(current);
  apply(prev);
}

export function redo() {
  const next = future.pop();
  if (!next) return;
  if (current) past.push(current);
  apply(next);
}

/** Следить за изменениями и запоминать их через паузу после последней правки. */
export function startHistory() {
  current = snap();
  effect(() => {
    app.text.value;
    app.typo.value;
    app.paper.value;
    if (applying) return;
    clearTimeout(timer);
    timer = setTimeout(mark, PAUSE);
  });
}
