/** Глиф однолинейного шрифта: ширина и штрихи. Координаты в единицах шрифта, y вверх, базовая линия y = 0. */
export interface GlyphData {
  /** ширина глифа без межбуквенного интервала */
  w: number;
  /** штрихи: плоский массив [x0, y0, x1, y1, ...] на каждый штрих */
  s: number[][];
}

export interface FontData {
  id: string;
  name: string;
  source?: string;
  license?: string;
  /** высота строчной буквы (единицы шрифта) */
  xHeight: number;
  capHeight: number;
  descender: number;
  letterSpacing: number;
  wordSpacing: number;
  glyphs: Record<string, GlyphData>;
}

/** Шрифт, готовый к вёрстке: у каждого символа может быть несколько вариантов написания. */
export interface StrokeFont {
  id: string;
  name: string;
  builtin: boolean;
  xHeight: number;
  capHeight: number;
  descender: number;
  letterSpacing: number;
  wordSpacing: number;
  glyphs: Map<string, GlyphData[]>;
  /** шрифт, из которого берутся отсутствующие символы */
  fallback?: StrokeFont;
}

/** Пользовательский шрифт «свой почерк», хранится в IndexedDB. xHeight всегда 100. */
export interface CustomFontRecord {
  id: string;
  name: string;
  baseFontId: string;
  /** символ → варианты; каждый вариант — штрихи как в GlyphData */
  glyphs: Record<string, GlyphData[]>;
  letterSpacing: number;
  wordSpacing: number;
  updatedAt: number;
}
