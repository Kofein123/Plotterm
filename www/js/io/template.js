// Лист-шаблон почерка А4: человек пишет по букве в каждой клетке, фотографирует лист, программа снимает буквы.
// По углам — четыре чёрные метки: по ним фото выпрямляется. Направляющие светло-голубые — на фото они
// светлее чернил и отбрасываются порогом. Все размеры в мм, начало — левый верхний угол листа.
export const SHEET_W = 210;
export const SHEET_H = 297;
/** центры угловых меток: левый верхний, правый верхний, правый нижний, левый нижний */
export const MARKS = [[12, 12], [198, 12], [198, 285], [12, 285]];
export const MARK_SIZE = 8;
export const CELL_W = 14;
export const CELL_H = 16;
const COLS = 13;
const ROWS = 16;
const GRID_X = 14;
const GRID_Y = 22;
/** полоса с подписью буквы сверху клетки */
export const LABEL_H = 3;
/** базовая линия от верха клетки и высота строчной по направляющей */
export const BASELINE = 12;
export const X_HEIGHT = 3.5;
const LOWER = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const UPPER = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
const KAZ_LOWER = 'әғқңөұүһі';
const KAZ_UPPER = 'ӘҒҚҢӨҰҮҺІ';
const DIGITS = '0123456789';
const PUNCT = '.,:;!?-—()«»"/+=%№<>~';
const LATIN_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const LATIN_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GREEK = 'αβγδεηθλμνπρστφψωΔΣΩΦ';
const MATH = "'*[]{}|±°∞√≈≠≤≥→×·∫";
/** Символы листа по порядку клеток: всё по разу, строчные — второй раз (их больше всего в тексте). */
export const TEMPLATE_CHARS = [...LOWER, ...KAZ_LOWER, ...UPPER, ...KAZ_UPPER, ...DIGITS, ...PUNCT, ...LOWER, ...KAZ_LOWER].slice(0, COLS * ROWS);
/** Лист 2 — для формул: латиница, греческие буквы, знаки; остаток — ещё варианты частых строчных. Клеток столько же. */
export const TEMPLATE_CHARS_2 = [...LATIN_LOWER, ...LATIN_UPPER, ...GREEK, ...MATH, ...LATIN_LOWER, ...LOWER, ...'әіңқұүөғһ'].slice(0, TEMPLATE_CHARS.length);
const SHEET_NAMES = ['', 'кириллица, цифры, знаки', 'латиница и формулы'];
/**
 * Крупный лист (как у Basuratti): 6 клеток в ряд, в каждой четыре направляющие — верх прописных,
 * верх строчных, базовая линия, низ хвостов. Буква в 1,5 раза крупнее, чем на листах 1–2, и снимается точнее;
 * размер прописных относительно строчных виден по линиям. Один лист — один вариант каждой буквы.
 */
const pairs = (up, low) => [...up].flatMap((c, i) => [c, [...low][i]]);
const BIG_CHARS = {
    3: pairs(UPPER, LOWER),
    // «а о н е с» — по ним меряется высота строчных на этом листе, остальные знаки — для формул
    4: [...pairs(KAZ_UPPER, KAZ_LOWER), ...DIGITS, ...PUNCT, ..."'*[]±°≈≠≤≥→×", ...'аонес'],
    5: [...pairs(LATIN_UPPER, LATIN_LOWER), ...'αβγδεηθλμπρσφω'],
};
const BIG_NAMES = { 3: 'А · русские буквы', 4: 'Б · қазақ әріптері, цифры, знаки', 5: 'В · латиница и греческие' };
const SMALL = { cols: COLS, gridX: GRID_X, gridY: GRID_Y, cellW: CELL_W, cellH: CELL_H, baseline: BASELINE, xHeight: X_HEIGHT };
export const BIG = { cols: 6, gridX: 12, gridY: 42, cellW: 31, cellH: 21, baseline: 14.5, xHeight: 5, cap: 8.5, desc: 4 };
export const TEMPLATE_SHEETS = [1, 2, 3, 4, 5];
export const isBigSheet = (sheet) => sheet in BIG_CHARS;
const layout = (sheet) => (isBigSheet(sheet) ? BIG : SMALL);
export const templateChars = (sheet = 1) => BIG_CHARS[sheet] ?? (sheet === 2 ? TEMPLATE_CHARS_2 : TEMPLATE_CHARS);
/** Углы таблицы (мм): левый и правый верх, правый и левый низ последнего полного ряда — запасные опорные точки. */
export function gridCorners(sheet = 1) {
    const L = layout(sheet);
    const full = Math.floor(templateChars(sheet).length / L.cols);
    const x1 = L.gridX + L.cols * L.cellW, y1 = L.gridY + full * L.cellH;
    return [[L.gridX, L.gridY], [x1, L.gridY], [x1, y1], [L.gridX, y1]];
}
export const GRID_CORNERS = gridCorners(1);
export function templateCells(sheet = 1) {
    const L = layout(sheet);
    return templateChars(sheet).map((ch, i) => {
        const col = i % L.cols;
        const row = Math.floor(i / L.cols);
        const x = L.gridX + col * L.cellW;
        const y = L.gridY + row * L.cellH;
        const c = { ch, x, y: y + LABEL_H, w: L.cellW, h: L.cellH - LABEL_H, baseline: y + L.baseline };
        if (L !== SMALL) {
            c.xh = L.xHeight;
            c.guides = [L.cap, -L.desc];
        }
        return c;
    });
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function bigSheetSvg(sheetNo) {
    const L = BIG;
    let s = `<text x="${L.gridX}" y="24" font-family="sans-serif" font-size="5" font-weight="bold" fill="#333">Plotterm · почерк</text>`;
    s += `<text x="${L.gridX + L.cols * L.cellW}" y="24" font-family="sans-serif" font-size="3.4" text-anchor="end" fill="#555">лист ${esc(BIG_NAMES[sheetNo])}</text>`;
    s += `<text x="${L.gridX}" y="30.5" font-family="sans-serif" font-size="2.6" fill="#666">Один лист — один вариант букв. Заполните лист 2–4 раза: буквы на странице будут разными, как в жизни.</text>`;
    s += `<text x="${L.gridX}" y="35" font-family="sans-serif" font-size="2.6" fill="#666">Своей ручкой, обычным почерком: строчная до пунктира, прописная до верхней линии, хвосты (у, д, р) вниз.</text>`;
    s += `<text x="${L.gridX}" y="39.2" font-family="sans-serif" font-size="2.6" fill="#666">Не касайтесь рамок клетки. Печать в масштабе 100 %, фото — сверху, целиком, все четыре чёрные метки в кадре.</text>`;
    for (const c of templateCells(sheetNo)) {
        const top = c.y - LABEL_H;
        const x0 = c.x + 1.5, x1 = c.x + c.w - 1.5;
        const ln = (dy, color, w, dash = '') => `<line x1="${x0}" y1="${c.baseline - dy}" x2="${x1}" y2="${c.baseline - dy}" stroke="${color}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
        s += `<rect x="${c.x}" y="${top}" width="${c.w}" height="${L.cellH}" fill="none" stroke="#a8d8ee" stroke-width="0.25"/>`;
        s += ln(L.cap, '#c6e6f5', 0.2);
        s += ln(L.xHeight, '#bfe3f3', 0.2, '1 1');
        s += ln(0, '#8fcde9', 0.3);
        s += ln(-L.desc, '#d4ecf7', 0.2, '0.3 0.9');
        s += `<text x="${c.x + 1}" y="${top + 2.4}" font-family="sans-serif" font-size="2.4" fill="#b0b0b0">${esc(c.ch)}</text>`;
    }
    return s;
}
/** SVG листа для печати в масштабе 1:1 (без полей принтера — «реальный размер»). */
export function templateSvg(sheetNo = 1) {
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}mm" height="${SHEET_H}mm" viewBox="0 0 ${SHEET_W} ${SHEET_H}">`;
    s += `<rect width="${SHEET_W}" height="${SHEET_H}" fill="#fff"/>`;
    for (const [cx, cy] of MARKS)
        s += `<rect x="${cx - MARK_SIZE / 2}" y="${cy - MARK_SIZE / 2}" width="${MARK_SIZE}" height="${MARK_SIZE}" fill="#000"/>`;
    if (isBigSheet(sheetNo))
        return s + bigSheetSvg(sheetNo) + '</svg>';
    s += `<text x="${SHEET_W / 2}" y="13" font-family="sans-serif" font-size="4" text-anchor="middle" fill="#555">Plotterm · лист-шаблон почерка · лист ${sheetNo}: ${SHEET_NAMES[sheetNo] ?? ''}</text>`;
    s += `<text x="${SHEET_W / 2}" y="18.5" font-family="sans-serif" font-size="2.6" text-anchor="middle" fill="#777">Пишите своей обычной ручкой по одной букве в клетке, на сплошной линии, как в тетради. Не выходите за клетку.</text>`;
    for (const c of templateCells(sheetNo)) {
        const top = c.y - LABEL_H;
        s += `<rect x="${c.x}" y="${top}" width="${c.w}" height="${CELL_H}" fill="none" stroke="#a8d8ee" stroke-width="0.25"/>`;
        s += `<line x1="${c.x}" y1="${c.y}" x2="${c.x + c.w}" y2="${c.y}" stroke="#d4ecf7" stroke-width="0.2"/>`;
        s += `<line x1="${c.x + 1}" y1="${c.baseline}" x2="${c.x + c.w - 1}" y2="${c.baseline}" stroke="#8fcde9" stroke-width="0.3"/>`;
        s += `<line x1="${c.x + 1}" y1="${c.baseline - X_HEIGHT}" x2="${c.x + c.w - 1}" y2="${c.baseline - X_HEIGHT}" stroke="#bfe3f3" stroke-width="0.2" stroke-dasharray="0.8 0.8"/>`;
        s += `<text x="${c.x + 0.8}" y="${top + 2.3}" font-family="sans-serif" font-size="2.2" fill="#b8b8b8">${esc(c.ch)}</text>`;
    }
    return s + '</svg>';
}
