// Правка разметки из предпросмотра: пользователь щёлкает по рисунку на листе, а меняется строка текста.
import type { ImageTool } from './markup.ts';

const TOOL_WORD: Record<ImageTool, string> = { pen: '', pencil: 'карандаш', space: 'место' };

/** Строка рисунка: подпись, ширина в долях строки, инструмент. */
export interface ImageLine {
  index: number;
  caption: string;
  width: number;
  tool: ImageTool;
}

const LINE_RE = /^!\[([^\]\n]*)\]\(img:([\w-]+)([^)\n]*)\)\s*$/;

/** Найти строку рисунка по его id. */
export function findImageLine(text: string, id: string): ImageLine | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = LINE_RE.exec(lines[i]);
    if (!m || m[2] !== id) continue;
    const rest = m[3];
    const pct = /(\d{1,3}(?:[.,]\d+)?)\s*%/.exec(rest);
    const tool: ImageTool = /карандаш|pencil/i.test(rest) ? 'pencil' : /место|space/i.test(rest) ? 'space' : 'pen';
    const width = pct ? Math.max(0.1, Math.min(1, parseFloat(pct[1].replace(',', '.')) / 100)) : 1;
    return { index: i, caption: m[1], width, tool };
  }
  return null;
}

function compose(id: string, l: ImageLine): string {
  const parts = [l.width < 0.999 ? `${Math.round(l.width * 100)}%` : '', TOOL_WORD[l.tool]].filter(Boolean);
  return `![${l.caption}](img:${id}${parts.length ? ' ' + parts.join(' ') : ''})`;
}

/** Ширина рисунка (доля строки) и чем его рисовать. */
export function setImage(text: string, id: string, patch: { width?: number; tool?: ImageTool; caption?: string }): string {
  const cur = findImageLine(text, id);
  if (!cur) return text;
  const lines = text.split('\n');
  lines[cur.index] = compose(id, { ...cur, ...patch });
  return lines.join('\n');
}

/** Лишние пустые строки, оставшиеся от перестановки, схлопываем в одну. */
function tidy(lines: string[]): string {
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Убрать рисунок вместе с его строкой (и пустой строкой, если та осталась одна от него). */
export function removeImage(text: string, id: string): string {
  const cur = findImageLine(text, id);
  if (!cur) return text;
  const lines = text.split('\n');
  lines.splice(cur.index, 1);
  return tidy(lines);
}

/**
 * Передвинуть рисунок по тексту: dir < 0 — выше, dir > 0 — ниже.
 * Шаг — соседний непустой абзац, чтобы рисунок перепрыгивал через абзац, а не через пустую строку.
 */
export function moveImage(text: string, id: string, dir: -1 | 1, steps = 1): string {
  let out = text;
  for (let n = 0; n < steps; n++) {
    const cur = findImageLine(out, id);
    if (!cur) return out;
    const lines = out.split('\n');
    let j = cur.index + dir;
    while (j >= 0 && j < lines.length && lines[j].trim() === '') j += dir;
    if (j < 0 || j >= lines.length) return out;
    const [img] = lines.splice(cur.index, 1);
    lines.splice(j, 0, img);
    out = tidy(lines);
  }
  return out;
}
