// Лист-шаблон почерка А4: человек пишет по букве в каждой клетке, фотографирует лист, программа снимает буквы.
// По углам — четыре чёрные метки: по ним фото выпрямляется. Направляющие светло-голубые — на фото они
// светлее чернил и отбрасываются порогом. Все размеры в мм, начало — левый верхний угол листа.

export const SHEET_W = 210;
export const SHEET_H = 297;
/** центры угловых меток: левый верхний, правый верхний, правый нижний, левый нижний */
export const MARKS: [number, number][] = [[12, 12], [198, 12], [198, 285], [12, 285]];
export const MARK_SIZE = 8;

export const CELL_W = 14;
export const CELL_H = 16;
const COLS = 13;
const ROWS = 16;
const GRID_X = 14;
const GRID_Y = 22;
/** полоса с подписью буквы сверху клетки */
const LABEL_H = 3;
/** базовая линия от верха клетки и высота строчной по направляющей */
export const BASELINE = 12;
export const X_HEIGHT = 3.5;

const LOWER = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const UPPER = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
const KAZ_LOWER = 'әғқңөұүһі';
const KAZ_UPPER = 'ӘҒҚҢӨҰҮҺІ';
const DIGITS = '0123456789';
const PUNCT = '.,:;!?-—()«»"/+=%№<>~';

/** Символы листа по порядку клеток: всё по разу, строчные — второй раз (их больше всего в тексте). */
export const TEMPLATE_CHARS: string[] = [...LOWER, ...KAZ_LOWER, ...UPPER, ...KAZ_UPPER, ...DIGITS, ...PUNCT, ...LOWER, ...KAZ_LOWER].slice(0, COLS * ROWS);

export interface TemplateCell {
  ch: string;
  /** область письма (без подписи), мм */
  x: number;
  y: number;
  w: number;
  h: number;
  /** базовая линия, мм от верха листа */
  baseline: number;
}

export function templateCells(): TemplateCell[] {
  return TEMPLATE_CHARS.map((ch, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = GRID_X + col * CELL_W;
    const y = GRID_Y + row * CELL_H;
    return { ch, x, y: y + LABEL_H, w: CELL_W, h: CELL_H - LABEL_H, baseline: y + BASELINE };
  });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SVG листа для печати в масштабе 1:1 (без полей принтера — «реальный размер»). */
export function templateSvg(sheetNo = 1): string {
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}mm" height="${SHEET_H}mm" viewBox="0 0 ${SHEET_W} ${SHEET_H}">`;
  s += `<rect width="${SHEET_W}" height="${SHEET_H}" fill="#fff"/>`;
  for (const [cx, cy] of MARKS) s += `<rect x="${cx - MARK_SIZE / 2}" y="${cy - MARK_SIZE / 2}" width="${MARK_SIZE}" height="${MARK_SIZE}" fill="#000"/>`;
  s += `<text x="${SHEET_W / 2}" y="13" font-family="sans-serif" font-size="4" text-anchor="middle" fill="#555">Plotterm · лист-шаблон почерка · лист ${sheetNo}</text>`;
  s += `<text x="${SHEET_W / 2}" y="18.5" font-family="sans-serif" font-size="2.6" text-anchor="middle" fill="#777">Пишите своей обычной ручкой по одной букве в клетке, на сплошной линии, как в тетради. Не выходите за клетку.</text>`;
  for (const c of templateCells()) {
    const top = c.y - LABEL_H;
    s += `<rect x="${c.x}" y="${top}" width="${c.w}" height="${CELL_H}" fill="none" stroke="#a8d8ee" stroke-width="0.25"/>`;
    s += `<line x1="${c.x}" y1="${c.y}" x2="${c.x + c.w}" y2="${c.y}" stroke="#d4ecf7" stroke-width="0.2"/>`;
    s += `<line x1="${c.x + 1}" y1="${c.baseline}" x2="${c.x + c.w - 1}" y2="${c.baseline}" stroke="#8fcde9" stroke-width="0.3"/>`;
    s += `<line x1="${c.x + 1}" y1="${c.baseline - X_HEIGHT}" x2="${c.x + c.w - 1}" y2="${c.baseline - X_HEIGHT}" stroke="#bfe3f3" stroke-width="0.2" stroke-dasharray="0.8 0.8"/>`;
    s += `<text x="${c.x + 0.8}" y="${top + 2.3}" font-family="sans-serif" font-size="2.2" fill="#b8b8b8">${esc(c.ch)}</text>`;
  }
  return s + '</svg>';
}
