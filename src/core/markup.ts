// Простая разметка текста конспекта.
//   строка «# Заголовок»   — заголовок по центру
//   пустая строка          — пропуск строки
//   строка «===»           — новая страница
//   __текст__              — подчёркнуто; **текст** — звёздочки убираются
//   «## » / «### »          — тоже заголовок
//   x^2, x^{10}, a_1, a_{ij} — степень и индекс
//   \^ \_ \\               — сами символы
//   | ячейка | ячейка |     — строка таблицы (соседние такие строки — одна таблица, рамку плоттер рисует сам)
//   ![подпись](img:ID 60% карандаш) — рисунок на всю строку: ширина в % от строки (по умолчанию 70 %),
//                            «карандаш» — рисовать карандашом (пауза на смену), «место» — оставить пустое место

export interface CharItem {
  ch: string;
  /** 0 — обычный, 1 — верхний индекс, -1 — нижний */
  script: 0 | 1 | -1;
  underline: boolean;
  /** экранированный символ (\/) — не участвует в формулах */
  lit?: boolean;
  /** дробь столбиком: числитель над чертой, знаменатель под ней */
  frac?: { num: CharItem[]; den: CharItem[] };
  /** корень с чертой над подкоренным выражением */
  sqrt?: CharItem[];
}

/** Символ-заглушка для дроби (не буква: не переносится и не ищется в шрифте). */
export const FRAC_CH = '\uE000';

export type ImageTool = 'pen' | 'pencil' | 'space';

export type Paragraph =
  | { kind: 'text'; heading: boolean; chars: CharItem[] }
  | { kind: 'image'; id: string; caption: string; width: number; tool: ImageTool }
  | { kind: 'row'; cells: CharItem[][] }
  | { kind: 'blank' }
  | { kind: 'page' };

export function parseMarkup(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  // убираем хвостовые пустые строки
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  for (const line of lines) {
    const t = line.trim();
    if (t === '===') { out.push({ kind: 'page' }); continue; }
    if (t === '') { out.push({ kind: 'blank' }); continue; }
    const img = t.match(/^!\[([^\]]*)\]\(img:([\w-]+)([^)]*)\)$/u);
    if (img) {
      const opts = img[3].toLowerCase();
      const pct = opts.match(/(\d+(?:[.,]\d+)?)\s*%/);
      const tool: ImageTool = /карандаш|pencil/.test(opts) ? 'pencil' : /мест|space|пуст/.test(opts) ? 'space' : 'pen';
      const width = pct ? Math.max(0.1, Math.min(1, parseFloat(pct[1].replace(',', '.')) / 100)) : 0.7;
      out.push({ kind: 'image', id: img[2], caption: img[1].trim(), width, tool });
      // подпись — отдельной строкой по центру под рисунком
      if (img[1].trim()) out.push({ kind: 'text', heading: true, chars: parseInline(img[1].trim()) });
      continue;
    }
    if (t.length > 2 && t.startsWith('|') && t.endsWith('|')) {
      const cells = t.slice(1, -1).split(/(?<!\\)\|/).map((c) => parseInline(c.trim()));
      // строка-разделитель из Markdown «|---|---|» — пропускаем
      if (!cells.every((c) => c.every((it) => /[-:\s]/.test(it.ch)))) out.push({ kind: 'row', cells });
      continue;
    }
    let heading = false;
    let body = t;
    // «# », «## », «### » из Markdown (так пишет ChatGPT) — всё заголовок
    const hm = /^#{1,6}\s+/.exec(body);
    if (hm) { heading = true; body = body.slice(hm[0].length).trim(); }
    const chars = parseInline(body);
    // заголовок от руки подчёркивают — так на тетрадной странице его видно сразу
    if (hm) for (const c of chars) c.underline = true;
    out.push({ kind: 'text', heading, chars });
  }
  return out;
}

function parseInline(s: string): CharItem[] {
  return mathify(parseChars(s), s.includes('='));
}

function parseChars(s: string): CharItem[] {
  const out: CharItem[] = [];
  const chars = [...s];
  let underline = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '\\' && i + 1 < chars.length) {
      out.push({ ch: chars[++i], script: 0, underline, lit: true });
      continue;
    }
    // **жирный** из Markdown: плоттер пишет одной ручкой, звёздочки просто убираем
    if (c === '*' && chars[i + 1] === '*') {
      i++;
      continue;
    }
    if (c === '_' && chars[i + 1] === '_') {
      underline = !underline;
      i++;
      continue;
    }
    if ((c === '^' || c === '_') && i + 1 < chars.length && chars[i + 1] !== ' ') {
      const script: 1 | -1 = c === '^' ? 1 : -1;
      if (chars[i + 1] === '{') {
        const end = chars.indexOf('}', i + 2);
        if (end > 0) {
          for (let j = i + 2; j < end; j++) out.push({ ch: chars[j], script, underline });
          i = end;
          continue;
        }
      }
      out.push({ ch: chars[i + 1], script, underline });
      i++;
      continue;
    }
    out.push({ ch: c, script: 0, underline });
  }
  return out;
}

// --- формулы от руки: дроби столбиком и корни с чертой ---
// В строке с «=» запись a/b, (…)/(…), 2,5/[ω(1 + 0,4ω)] пишется дробью; в обычном тексте — только если
// с обеих сторон числа (1/2), чтобы «и/или» осталось как есть. «\/» — всегда просто косая черта.

type Node = { t: 'c'; it: CharItem } | { t: 'g'; open: CharItem; close: CharItem; kids: Node[] } | { t: 'x'; it: CharItem };

const OPEN: Record<string, string> = { '(': ')', '[': ']' };
const STOP = new Set([' ', '=', '+', '−', '-', '–', '—', ';', '<', '>', '≈', '≠', '≤', '≥', '→', '←', '±', ':', '/', '|']);

function toTree(items: CharItem[]): Node[] {
  const root: Node[] = [];
  const stack: { kids: Node[]; open: CharItem }[] = [];
  const cur = () => (stack.length ? stack[stack.length - 1].kids : root);
  for (const it of items) {
    if (!it.script && !it.lit && OPEN[it.ch]) { stack.push({ kids: [], open: it }); continue; }
    const top = stack[stack.length - 1];
    if (top && !it.script && !it.lit && it.ch === OPEN[top.open.ch]) {
      stack.pop();
      cur().push({ t: 'g', open: top.open, close: it, kids: top.kids });
      continue;
    }
    cur().push({ t: 'c', it });
  }
  // незакрытые скобки — обычные символы
  while (stack.length) {
    const top = stack.pop()!;
    cur().push({ t: 'c', it: top.open }, ...top.kids);
  }
  return root;
}

const isAtom = (n: Node) => n.t !== 'c' || n.it.script !== 0 || n.it.lit || !STOP.has(n.it.ch);
const hasDigit = (ns: Node[]): boolean => ns.some((n) => (n.t === 'c' ? /\d/.test(n.it.ch) : n.t === 'g' ? hasDigit(n.kids) : true));
const isSpace = (n: Node) => n.t === 'c' && n.it.ch === ' ' && !n.it.script;

function flatten(ns: Node[]): CharItem[] {
  const out: CharItem[] = [];
  for (const n of ns) {
    if (n.t === 'g') out.push(n.open, ...flatten(n.kids), n.close);
    else out.push(n.it);
  }
  return out;
}

/** Операнд дроби: одна группа в скобках — без скобок. */
function operand(ns: Node[], math: boolean): CharItem[] {
  const inner = ns.length === 1 && ns[0].t === 'g' ? ns[0].kids : ns;
  return flatten(transform(inner, math));
}

function transform(ns: Node[], math: boolean): Node[] {
  // внутри скобок — то же самое
  let out: Node[] = ns.map((n) => (n.t === 'g' ? { ...n, kids: transform(n.kids, math) } : n));
  // √(…) и √[…] — корень с чертой
  const r: Node[] = [];
  for (let i = 0; i < out.length; i++) {
    const n = out[i], nx = out[i + 1];
    if (n.t === 'c' && n.it.ch === '√' && !n.it.lit && nx && nx.t === 'g') {
      r.push({ t: 'x', it: { ch: '√', script: n.it.script, underline: n.it.underline, sqrt: flatten(nx.kids) } });
      i++;
    } else r.push(n);
  }
  out = r;
  // дроби
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    if (n.t !== 'c' || n.it.ch !== '/' || n.it.lit || n.it.script) continue;
    let a = i - 1;
    while (a >= 0 && isSpace(out[a])) a--;
    let L = a;
    while (L >= 0 && isAtom(out[L])) L--;
    L++;
    let b = i + 1;
    while (b < out.length && isSpace(out[b])) b++;
    let R = b;
    while (R < out.length && isAtom(out[R])) R++;
    // запятая или точка в конце — знак препинания после дроби, а не её часть
    while (R - 1 > b && out[R - 1].t === 'c' && /[,.;]/.test((out[R - 1] as { it: CharItem }).it.ch)) R--;
    const num = out.slice(L, a + 1), den = out.slice(b, R);
    if (!num.length || !den.length) continue;
    if (!math && !(hasDigit(num) && hasDigit(den))) continue;
    const frac: Node = { t: 'x', it: { ch: FRAC_CH, script: 0, underline: n.it.underline, frac: { num: operand(num, math), den: operand(den, math) } } };
    out.splice(L, R - L, frac);
    i = L;
  }
  return out;
}

function mathify(items: CharItem[], math: boolean): CharItem[] {
  if (!items.some((it) => (it.ch === '/' || it.ch === '√') && !it.lit)) return items;
  return flatten(transform(toTree(items), math));
}
