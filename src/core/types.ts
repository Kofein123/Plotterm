// Общие типы ядра. Все размеры в миллиметрах.
// «Бумажные» координаты: u вправо, v вниз от левого верхнего угла листа.

/** Штрих: ломаная [u0, v0, u1, v1, ...]. line — номер строки на странице (с 1), 0 — не текст. */
export interface Stroke {
  pts: number[];
  line: number;
}

export interface PageLayout {
  index: number;
  strokes: Stroke[];
  /** сколько строк страницы занято (включая пропущенные в начале) */
  usedLines: number;
  totalLines: number;
  /** зеркальные поля (левая страница тетради) */
  mirrored: boolean;
  /** базовые линии строк (v), для предпросмотра */
  baselines: number[];
}

/** Экземпляр буквы на странице: штрихи уже в бумажных координатах (мм). */
export interface GlyphInstance {
  ch: string;
  page: number;
  strokes: number[][];
}

/** Связный штрих слова: joints — номера точек, где буква переходит в соединение и обратно. */
export interface CursiveRun {
  page: number;
  pts: number[];
  joints: number[];
}

export interface LayoutTrace {
  glyphs: GlyphInstance[];
  runs: CursiveRun[];
}

export interface LayoutResult {
  pages: PageLayout[];
  missingChars: string[];
  /** символов в тексте (без пробелов) */
  chars: number;
  /** трасса вёрстки, если просили `trace: true` */
  trace?: LayoutTrace;
}

export type PaperTemplate = 'a4' | 'grid' | 'ruled' | 'custom';

export interface PaperSettings {
  template: PaperTemplate;
  width: number;
  height: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  /** чистый лист: расстояние между строками */
  blankLineStep: number;
  /** клетка: размер клетки */
  cell: number;
  /** клетка: строка через сколько клеток */
  gridLineCells: number;
  /** линейка: шаг линий */
  rulePitch: number;
  /** правая / левая страница / чередовать (поля зеркалятся на левой) */
  side: 'right' | 'left' | 'alternate';
  /** повернуть страницу на 180° (оборот листа) */
  rotate180: boolean;
  /** начать с N-й строки первой страницы (дописать на начатой странице) */
  startLine: number;
}

export interface TypographySettings {
  fontId: string;
  /** высота строчной буквы, мм */
  xHeight: number;
  /** наклон, градусы (плюс — вправо) */
  slant: number;
  /** множитель межбуквенного интервала */
  letterSpacing: number;
  /** множитель межсловного интервала */
  wordSpacing: number;
  align: 'left' | 'justify';
  hyphenate: boolean;
  /** красная строка, мм */
  indent: number;
  /** живость почерка 0–10 */
  liveliness: number;
  seed: number;
  /** связное письмо: не поднимать ручку внутри слова (если шрифт задаёт точки входа/выхода) */
  cursive?: boolean;
}

export interface Calibration {
  /** Z = 0 — ручка касается бумаги, upZ — ручка поднята (рабочие координаты) */
  penSet: boolean;
  upZ: number;
  zeroSet: boolean;
  cornerSet: boolean;
  /** противоположный угол листа в рабочих координатах X, Y */
  corner: [number, number];
  /** оси станка повёрнуты к листу на 90°: X станка идёт вдоль высоты листа, Y — вдоль ширины */
  swap?: boolean;
  /** точка на верхнем крае листа для компенсации перекоса */
  skewPoint: [number, number] | null;
  /** узел сетки / линия линейки в бумажных координатах */
  gridOrigin: [number, number] | null;
  /** последнее известное машинное положение (для проверки, не терялся ли ноль) */
  lastMPos: [number, number, number] | null;
  /** калибровка, возможно, устарела (плата перезагружалась) */
  stale: boolean;
}

export interface PenSettings {
  /** нажим: на сколько мм опустить ниже касания */
  pressure: number;
  /** скорость опускания, мм/мин */
  zDownFeed: number;
  /** пауза после опускания, мс */
  dwellMs: number;
  /** опускать на максимальной скорости оси Z (G0), а не zDownFeed */
  zDownRapid: boolean;
  /** низкий подъём для коротких переездов внутри строки, мм над бумагой (0 — всегда полный подъём) */
  hopLift: number;
  /** до какой длины переезд считается коротким, мм */
  hopDistance: number;
  /** версия настроек низкого подъёма (2 — по умолчанию 2 мм) */
  hopV?: number;
}

export interface SpeedSettings {
  profile: 'turbo' | 'draft' | 'normal' | 'neat' | 'custom';
  customFeed: number;
  /** холостой ход: 0 = G0 (максимальная скорость платы) */
  travelFeed: number;
  /** соединять штрихи без подъёма, если зазор меньше (мм) */
  joinTolerance: number;
  /** допуск упрощения траектории, мм */
  simplify: number;
  /** куда отъехать после печати */
  park: 'none' | 'zero' | 'away';
}

export const SPEED_PROFILES: Record<Exclude<SpeedSettings['profile'], 'custom'>, { name: string; feed: number; hint: string }> = {
  turbo: { name: 'Турбо', feed: 9000, hint: 'гелевая ручка, проверить тестом' },
  draft: { name: 'Черновик', feed: 6000, hint: 'быстрые заметки' },
  normal: { name: 'Обычный', feed: 4000, hint: 'конспект' },
  neat: { name: 'Аккуратный', feed: 2500, hint: 'чистовик, сдача' },
};

export function feedOf(s: SpeedSettings): number {
  return s.profile === 'custom' ? s.customFeed : SPEED_PROFILES[s.profile].feed;
}
