// Простая разметка текста конспекта.
//   строка «# Заголовок»   — заголовок по центру
//   пустая строка          — пропуск строки
//   строка «===»           — новая страница
//   __текст__              — подчёркнуто
//   x^2, x^{10}, a_1, a_{ij} — степень и индекс
//   \^ \_ \\               — сами символы
//   | ячейка | ячейка |     — строка таблицы (соседние такие строки — одна таблица, рамку плоттер рисует сам)
//   ![подпись](img:ID 60% карандаш) — рисунок на всю строку: ширина в % от строки (по умолчанию 70 %),
//                            «карандаш» — рисовать карандашом (пауза на смену), «место» — оставить пустое место
export function parseMarkup(text) {
    const out = [];
    const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    // убираем хвостовые пустые строки
    while (lines.length && lines[lines.length - 1].trim() === '')
        lines.pop();
    for (const line of lines) {
        const t = line.trim();
        if (t === '===') {
            out.push({ kind: 'page' });
            continue;
        }
        if (t === '') {
            out.push({ kind: 'blank' });
            continue;
        }
        const img = t.match(/^!\[([^\]]*)\]\(img:([\w-]+)([^)]*)\)$/u);
        if (img) {
            const opts = img[3].toLowerCase();
            const pct = opts.match(/(\d+(?:[.,]\d+)?)\s*%/);
            const tool = /карандаш|pencil/.test(opts) ? 'pencil' : /мест|space|пуст/.test(opts) ? 'space' : 'pen';
            const width = pct ? Math.max(0.1, Math.min(1, parseFloat(pct[1].replace(',', '.')) / 100)) : 0.7;
            out.push({ kind: 'image', id: img[2], caption: img[1].trim(), width, tool });
            // подпись — отдельной строкой по центру под рисунком
            if (img[1].trim())
                out.push({ kind: 'text', heading: true, chars: parseInline(img[1].trim()) });
            continue;
        }
        if (t.length > 2 && t.startsWith('|') && t.endsWith('|')) {
            const cells = t.slice(1, -1).split(/(?<!\\)\|/).map((c) => parseInline(c.trim()));
            // строка-разделитель из Markdown «|---|---|» — пропускаем
            if (!cells.every((c) => c.every((it) => /[-:\s]/.test(it.ch))))
                out.push({ kind: 'row', cells });
            continue;
        }
        let heading = false;
        let body = t;
        if (body.startsWith('# ')) {
            heading = true;
            body = body.slice(2).trim();
        }
        out.push({ kind: 'text', heading, chars: parseInline(body) });
    }
    return out;
}
function parseInline(s) {
    const out = [];
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
            const script = c === '^' ? 1 : -1;
            if (chars[i + 1] === '{') {
                const end = chars.indexOf('}', i + 2);
                if (end > 0) {
                    for (let j = i + 2; j < end; j++)
                        out.push({ ch: chars[j], script, underline });
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
