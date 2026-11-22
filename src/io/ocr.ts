// Распознавание текста на картинке: скриншот или фото страницы → текст, который плоттер напишет почерком.
// Tesseract грузится с CDN при первом вызове; языковые данные он качает сам и кладёт в кеш браузера.

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.esm.min.js';

/** Языки распознавания: русский, казахский, английский. */
export type OcrLang = 'rus' | 'kaz' | 'eng';

let tessP: Promise<any> | null = null;
function loadTesseract(): Promise<any> {
  if (!tessP) {
    const url = TESSERACT;
    tessP = import(/* webpackIgnore: true */ url);
    tessP.catch(() => (tessP = null));
  }
  return tessP;
}

/** Кусок текста страницы с его местом (для разбора на абзацы). */
interface OcrLine {
  text: string;
  top: number;
  height: number;
  left: number;
}

/**
 * Переносы в конце строки склеиваем, строки одного абзаца соединяем в одну,
 * а новый абзац начинаем там, где строка кончилась точкой или следующая заметно отступила.
 */
export function tidyOcr(lines: OcrLine[]): string {
  const out: string[] = [];
  const minLeft = Math.min(...lines.map((l) => l.left), Infinity);
  let buf = '';
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.text.replace(/\s+/g, ' ').trim();
    if (!t) { flush(); continue; }
    const prev = lines[i - 1];
    const gap = prev ? l.top - (prev.top + prev.height) : 0;
    const indent = l.left - minLeft;
    // пустая строка, большой отступ сверху или красная строка — новый абзац
    if (buf && (gap > l.height * 0.8 || indent > l.height * 1.2)) flush();
    if (!buf) buf = t;
    else if (/[-‐–—]$/.test(buf)) buf = buf.replace(/[-‐–—]$/, '') + t;
    else buf += ' ' + t;
    if (/[.!?:]$/.test(t)) flush();
  }
  flush();
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export interface OcrOptions {
  langs?: OcrLang[];
  onProgress?: (msg: string) => void;
}

/** Распознать текст на картинке. Возвращает текст абзацами; пустая строка — ничего не нашлось. */
export async function recognizeImage(image: Blob | string, opts: OcrOptions = {}): Promise<string> {
  const langs = opts.langs?.length ? opts.langs : (['rus', 'kaz'] as OcrLang[]);
  const t = await loadTesseract();
  opts.onProgress?.('Загружаю распознаватель…');
  const worker = await t.createWorker(langs, 1, {
    logger: (m: { status?: string; progress?: number }) => {
      if (!m?.status) return;
      if (m.status === 'recognizing text') opts.onProgress?.(`Распознаю текст: ${Math.round((m.progress ?? 0) * 100)} %`);
      else if (/loading|initializ|downloading/i.test(m.status)) opts.onProgress?.('Готовлю распознаватель…');
    },
  });
  try {
    const res = await worker.recognize(image, {}, { text: true, blocks: true });
    const page = res?.data;
    const lines: OcrLine[] = [];
    for (const b of page?.blocks ?? []) {
      for (const par of b.paragraphs ?? []) {
        for (const ln of par.lines ?? []) {
          const bb = ln.bbox ?? { y0: 0, y1: 0, x0: 0 };
          lines.push({ text: ln.text ?? '', top: bb.y0, height: Math.max(1, bb.y1 - bb.y0), left: bb.x0 });
        }
      }
    }
    if (lines.length) return tidyOcr(lines);
    // блоков нет (старая сборка или картинка без разметки) — берём простой текст
    const plain = String(page?.text ?? '').trim();
    return plain ? plain.replace(/\n{3,}/g, '\n\n') + '\n' : '';
  } finally {
    await worker.terminate().catch(() => {});
  }
}
