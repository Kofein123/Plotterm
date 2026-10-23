// Разбор ответов GRBL 1.1 (в т. ч. Grbl_Esp32) и человеческие описания ошибок.

export type GrblState = 'Idle' | 'Run' | 'Hold' | 'Jog' | 'Alarm' | 'Door' | 'Check' | 'Home' | 'Sleep' | 'Unknown';

export interface StatusReport {
  state: GrblState;
  subState: number | null;
  mpos: [number, number, number] | null;
  wpos: [number, number, number] | null;
  wco: [number, number, number] | null;
  feed: number | null;
  spindle: number | null;
  /** свободно блоков планировщика, свободно байт RX */
  buffer: [number, number] | null;
  ov: [number, number, number] | null;
  pins: string;
  lineNumber: number | null;
}

const nums = (s: string) => s.split(',').map(Number);
const vec3 = (s: string): [number, number, number] => {
  const a = nums(s);
  return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
};

export function parseStatus(line: string): StatusReport | null {
  const m = line.match(/^<([^>]*)>$/);
  if (!m) return null;
  const parts = m[1].split('|');
  const [stateRaw, sub] = parts[0].split(':');
  const known = ['Idle', 'Run', 'Hold', 'Jog', 'Alarm', 'Door', 'Check', 'Home', 'Sleep'];
  const r: StatusReport = {
    state: (known.includes(stateRaw) ? stateRaw : 'Unknown') as GrblState,
    subState: sub !== undefined ? Number(sub) : null,
    mpos: null,
    wpos: null,
    wco: null,
    feed: null,
    spindle: null,
    buffer: null,
    ov: null,
    pins: '',
    lineNumber: null,
  };
  for (const p of parts.slice(1)) {
    const i = p.indexOf(':');
    const key = i < 0 ? p : p.slice(0, i);
    const val = i < 0 ? '' : p.slice(i + 1);
    switch (key) {
      case 'MPos': r.mpos = vec3(val); break;
      case 'WPos': r.wpos = vec3(val); break;
      case 'WCO': r.wco = vec3(val); break;
      case 'FS': { const a = nums(val); r.feed = a[0]; r.spindle = a[1] ?? null; break; }
      case 'F': r.feed = Number(val); break;
      case 'Bf': { const a = nums(val); r.buffer = [a[0], a[1]]; break; }
      case 'Ov': r.ov = vec3(val); break;
      case 'Pn': r.pins = val; break;
      case 'Ln': r.lineNumber = Number(val); break;
    }
  }
  return r;
}

export type GrblLine =
  | { type: 'ok' }
  | { type: 'error'; code: number; text: string }
  | { type: 'alarm'; code: number; text: string }
  | { type: 'status'; report: StatusReport }
  | { type: 'welcome'; version: string; raw: string }
  | { type: 'setting'; key: number | string; value: string }
  | { type: 'msg'; text: string }
  | { type: 'other'; text: string };

export function classify(line: string): GrblLine {
  const t = line.trim();
  if (t === 'ok') return { type: 'ok' };
  let m = t.match(/^error:(\d+)/i);
  if (m) return { type: 'error', code: Number(m[1]), text: errorText(Number(m[1])) };
  m = t.match(/^ALARM:(\d+)/i);
  if (m) return { type: 'alarm', code: Number(m[1]), text: alarmText(Number(m[1])) };
  if (t.startsWith('<') && t.endsWith('>')) {
    const report = parseStatus(t);
    if (report) return { type: 'status', report };
  }
  m = t.match(/^Grbl\s+(\S+)/i);
  if (m) return { type: 'welcome', version: m[1], raw: t };
  m = t.match(/^\$(\d+|[A-Za-z][\w/]*)=(.*)$/);
  if (m) return { type: 'setting', key: /^\d+$/.test(m[1]) ? Number(m[1]) : m[1], value: m[2].trim() };
  if (t.startsWith('[')) return { type: 'msg', text: t };
  return { type: 'other', text: t };
}

const ERRORS: Record<number, string> = {
  1: 'G-код: команда без буквы',
  2: 'неверное число в команде',
  3: 'команда $ не поддерживается',
  4: 'отрицательное значение там, где нужно положительное',
  5: 'хоминг выключен ($22=0) — у плоттера нет концевиков',
  6: 'импульс шага слишком короткий',
  7: 'настройки платы прочитаны с ошибкой, восстановлены по умолчанию',
  8: 'команда $ разрешена только в состоянии Idle',
  9: 'плата заблокирована (ALARM) или ждёт — нажмите «Разблокировать»',
  10: 'мягкие лимиты требуют хоминга',
  11: 'слишком длинная строка',
  12: 'шаг слишком частый для платы',
  13: 'открыта защитная дверь',
  14: 'строка $N слишком длинная',
  15: 'перемещение (jog) выходит за пределы хода',
  16: 'неверная команда перемещения $J',
  17: 'лазерный режим требует PWM',
  20: 'неподдерживаемая G-команда',
  21: 'в строке две команды одной группы',
  22: 'не задана подача F',
  23: 'G-код ожидает целое число',
  24: 'в строке две команды, использующие оси',
  25: 'повторяющееся слово в строке',
  26: 'в команде нет координат осей',
  27: 'номер строки N вне диапазона',
  28: 'не хватает значения P или L',
  29: 'система координат не поддерживается',
  30: 'G53 только с G0/G1',
  31: 'лишние координаты осей',
  32: 'дуга без координат',
  33: 'недопустимая цель перемещения',
  34: 'ошибка радиуса дуги',
  35: 'дуге нужны I/J/K',
  36: 'лишние слова в строке',
  37: 'смещение инструмента не по оси',
  38: 'номер инструмента больше допустимого',
};

const ALARMS: Record<number, string> = {
  1: 'сработал концевик (жёсткий лимит) — положение потеряно',
  2: 'цель за пределами мягких лимитов',
  3: 'сброс во время движения — положение могло сбиться',
  4: 'датчик щупа в неожиданном состоянии',
  5: 'щуп не сработал',
  6: 'хоминг прерван сбросом',
  7: 'хоминг: открыта дверь',
  8: 'хоминг: концевик не отпустился',
  9: 'хоминг: концевик не найден',
  10: 'хоминг: ошибка второго мотора',
};

export function errorText(code: number) {
  return ERRORS[code] ?? `ошибка ${code}`;
}
export function alarmText(code: number) {
  return ALARMS[code] ?? `авария ${code}`;
}

/** Описания основных $-настроек GRBL. */
export const SETTING_INFO: Record<number, { name: string; unit?: string; danger?: boolean }> = {
  0: { name: 'длительность импульса шага', unit: 'мкс' },
  1: { name: 'задержка отключения моторов (255 — всегда включены)', unit: 'мс' },
  2: { name: 'инверсия импульса шага (маска)' },
  3: { name: 'инверсия направления осей (маска X=1 Y=2 Z=4)', danger: true },
  4: { name: 'инверсия сигнала Enable' },
  5: { name: 'инверсия концевиков' },
  6: { name: 'инверсия щупа' },
  10: { name: 'что в отчёте статуса (маска)' },
  11: { name: 'допуск на поворотах (junction deviation)', unit: 'мм' },
  12: { name: 'точность дуг', unit: 'мм' },
  13: { name: 'единицы отчёта (0 — мм)' },
  20: { name: 'мягкие лимиты' },
  21: { name: 'жёсткие лимиты (концевики)' },
  22: { name: 'хоминг' },
  23: { name: 'направление хоминга (маска)' },
  24: { name: 'хоминг: медленная скорость', unit: 'мм/мин' },
  25: { name: 'хоминг: быстрая скорость', unit: 'мм/мин' },
  26: { name: 'хоминг: антидребезг', unit: 'мс' },
  27: { name: 'хоминг: отъезд от концевика', unit: 'мм' },
  30: { name: 'макс. обороты шпинделя' },
  31: { name: 'мин. обороты шпинделя' },
  32: { name: 'лазерный режим' },
  100: { name: 'шагов на мм по X', unit: 'шаг/мм', danger: true },
  101: { name: 'шагов на мм по Y', unit: 'шаг/мм', danger: true },
  102: { name: 'шагов на мм по Z (ручка)', unit: 'шаг/мм', danger: true },
  110: { name: 'макс. скорость X', unit: 'мм/мин', danger: true },
  111: { name: 'макс. скорость Y', unit: 'мм/мин', danger: true },
  112: { name: 'макс. скорость Z', unit: 'мм/мин', danger: true },
  120: { name: 'ускорение X', unit: 'мм/с²', danger: true },
  121: { name: 'ускорение Y', unit: 'мм/с²', danger: true },
  122: { name: 'ускорение Z', unit: 'мм/с²', danger: true },
  130: { name: 'макс. ход X', unit: 'мм' },
  131: { name: 'макс. ход Y', unit: 'мм' },
  132: { name: 'макс. ход Z', unit: 'мм' },
};

/** Реальные (мгновенные) команды GRBL — идут вне очереди и не занимают буфер. */
export const RT = {
  status: '?',
  hold: '!',
  resume: '~',
  reset: '\x18',
  jogCancel: '\x85',
  feedReset: '\x90',
  feedPlus10: '\x91',
  feedMinus10: '\x92',
  feedPlus1: '\x93',
  feedMinus1: '\x94',
} as const;
