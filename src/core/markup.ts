// Простая разметка текста конспекта.
//   строка «# Заголовок»   — заголовок по центру
//   пустая строка          — пропуск строки
//   строка «===»           — новая страница
//   __текст__              — подчёркнуто
//   x^2, x^{10}, a_1, a_{ij} — степень и индекс
//   \^ \_ \\               — сами символы

export interface CharItem {
  ch: string;
  /** 0 — обычный, 1 — верхний индекс, -1 — нижний */
  script: 0 | 1 | -1;
  underline: boolean;
}

export type Paragraph =
  | { kind: 'text'; heading: boolean; chars: CharItem[] }
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
    let heading = false;
    let body = t;
    if (body.startsWith('# ')) { heading = true; body = body.slice(2).trim(); }
    out.push({ kind: 'text', heading, chars: parseInline(body) });
  }
  return out;
}

function parseInline(s: string): CharItem[] {
  const out: CharItem[] = [];
  const chars = [...s];
  let underline = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '\\' && i + 1 < chars.length) {
      out.push({ ch: chars[++i], script: 0, underline });
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
