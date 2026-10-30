// Вёрстка: текст → строки → страницы → штрихи в бумажных координатах (мм).
import type { StrokeFont } from '../fonts/types.ts';
import { resolveGlyph } from '../fonts/fonts.ts';
import { parseMarkup, type CharItem } from './markup.ts';
import { hyphenPoints } from './hyphen.ts';
import { rng, type Rng } from './rng.ts';
import { connector, strokeTangent, trimEnd, trimStart } from './cursive.ts';
import type { VectorDrawing } from '../io/vectorize.ts';
import type { LayoutResult, LayoutTrace, PageLayout, PaperSettings, Stroke, TypographySettings } from './types.ts';

export interface LayoutInput {
  text: string;
  font: StrokeFont;
  typo: TypographySettings;
  paper: PaperSettings;
  /** узел сетки / линия линейки (бумажные координаты) из калибровки */
  gridOrigin?: [number, number] | null;
  /** рисунки по id из разметки `![подпись](img:ID)`: линии в долях ширины */
  images?: Record<string, VectorDrawing>;
  /** собрать трассу вёрстки (каждая буква и каждый связный штрих) — для метрик качества */
  trace?: boolean;
}

const SCRIPT_SCALE = 0.62;

interface Measured {
  item: CharItem;
  w: number;
}
type Word = Measured[];

interface LineBox {
  words: Word[];
  heading: boolean;
  firstOfPara: boolean;
  lastOfPara: boolean;
}

/** Базовые линии всех строк страницы. */
export function pageBaselines(paper: PaperSettings, capMm: number, descMm: number, gridOrigin?: [number, number] | null): number[] {
  let step: number;
  let origin: number;
  if (paper.template === 'grid') {
    step = Math.max(1, paper.cell * Math.max(1, paper.gridLineCells));
    origin = gridOrigin ? gridOrigin[1] : 0;
  } else if (paper.template === 'ruled') {
    step = Math.max(2, paper.rulePitch);
    origin = gridOrigin ? gridOrigin[1] : 0;
  } else {
    step = Math.max(1, paper.blankLineStep);
    origin = paper.marginTop + capMm;
  }
  const minFirst = paper.marginTop + capMm * 0.9;
  let b = origin + Math.ceil((minFirst - origin) / step - 1e-9) * step;
  const out: number[] = [];
  const maxB = paper.height - paper.marginBottom - descMm * 0.3;
  while (b <= maxB + 1e-9 && out.length < 500) {
    out.push(b);
    b += step;
  }
  return out;
}

export function layoutText(inp: LayoutInput): LayoutResult {
  const { font, typo, paper } = inp;
  const s = typo.xHeight / font.xHeight;
  const capMm = font.capHeight * s;
  const descMm = font.descender * s;
  // у импортированных шрифтов собственный интервал 0 — тогда регулятор работает от 30 % x-высоты
  const letterGap = (font.letterSpacing + (typo.letterSpacing - 1) * (font.letterSpacing || font.xHeight * 0.3)) * s;
  const spaceW = font.wordSpacing * s * typo.wordSpacing;
  const live = Math.max(0, Math.min(10, typo.liveliness)) / 10;
  const r = rng(typo.seed);
  const missing = new Set<string>();
  let charCount = 0;
  const lastVariant = new Map<string, number>();
  const slantK = Math.tan((typo.slant * Math.PI) / 180);
  const cursive = typo.cursive !== false;
  const joinTrim = typo.xHeight * 0.18;
  const joinProbe = Math.max(0.2, typo.xHeight * 0.12);
  const trace: LayoutTrace | undefined = inp.trace ? { glyphs: [], runs: [] } : undefined;

  const charWidth = (it: CharItem) => {
    const g = resolveGlyph(font, it.ch);
    if (g.missing) missing.add(it.ch);
    const sc = it.script ? SCRIPT_SCALE : 1;
    return (g.glyph.w * g.k * s + letterGap) * sc;
  };
  const hyphenItem = (u: boolean): Measured => {
    const item: CharItem = { ch: '-', script: 0, underline: u };
    return { item, w: charWidth(item) };
  };

  const baselines = pageBaselines(paper, capMm, descMm, inp.gridOrigin);
  const pages: PageLayout[] = [];
  const marginsFor = (pi: number) => {
    const mirrored = paper.side === 'left' || (paper.side === 'alternate' && pi % 2 === 1);
    return mirrored
      ? { left: paper.marginRight, right: paper.width - paper.marginLeft, mirrored }
      : { left: paper.marginLeft, right: paper.width - paper.marginRight, mirrored };
  };

  let page: PageLayout | null = null;
  let slot = 0;
  const newPage = () => {
    const m = marginsFor(pages.length);
    page = { index: pages.length, strokes: [], usedLines: 0, totalLines: baselines.length, mirrored: m.mirrored, baselines };
    pages.push(page);
    slot = pages.length === 1 ? Math.max(0, Math.min(baselines.length - 1, paper.startLine - 1)) : 0;
    page.usedLines = slot;
  };
  const takeSlot = (): { page: PageLayout; slot: number } => {
    if (!page || slot >= baselines.length) newPage();
    const res = { page: page!, slot };
    slot++;
    page!.usedLines = slot;
    return res;
  };

  if (!baselines.length) return { pages: [], missingChars: [], chars: 0 };

  const paragraphs = parseMarkup(inp.text);
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi];
    if (para.kind === 'row') {
      const rows: CharItem[][][] = [];
      while (pi < paragraphs.length && paragraphs[pi].kind === 'row') rows.push((paragraphs[pi++] as { cells: CharItem[][] }).cells);
      pi--;
      placeTable(rows);
      continue;
    }
    if (para.kind === 'page') {
      if (page) slot = baselines.length; // следующая строка начнёт новую страницу
      continue;
    }
    if (para.kind === 'blank') {
      takeSlot();
      continue;
    }
    if (para.kind === 'image') {
      placeImage(para.id, para.width, para.tool);
      continue;
    }
    // слова
    const words: Word[] = [];
    let cur: Word = [];
    for (const it of para.chars) {
      if (it.ch === ' ' && it.script === 0) {
        if (cur.length) words.push(cur);
        cur = [];
      } else {
        cur.push({ item: it, w: charWidth(it) });
        charCount++;
      }
    }
    if (cur.length) words.push(cur);
    if (!words.length) { takeSlot(); continue; }

    // разбиение на строки (ширина берётся по первой странице — поля симметричны по ширине)
    const m0 = marginsFor(pages.length ? pages.length - 1 : 0);
    // наклонённые буквы выступают вправо на высоту прописной × tg(наклона)
    const slantPad = Math.max(0, capMm * slantK);
    const full = m0.right - m0.left - slantPad;
    const lines: LineBox[] = [];
    let line: LineBox = { words: [], heading: para.heading, firstOfPara: true, lastOfPara: false };
    let lineW = 0;
    const avail = () => full - (line.firstOfPara && !para.heading ? typo.indent : 0);
    const pushLine = () => {
      lines.push(line);
      line = { words: [], heading: para.heading, firstOfPara: false, lastOfPara: false };
      lineW = 0;
    };
    const wordW = (w: Word) => w.reduce((a, c) => a + c.w, 0);
    const queue = [...words];
    while (queue.length) {
      const w = queue.shift()!;
      const ww = wordW(w);
      const need = (line.words.length ? spaceW : 0) + ww;
      if (lineW + need <= avail() + 1e-6) {
        line.words.push(w);
        lineW += need;
        continue;
      }
      // перенос по слогам
      if (typo.hyphenate && w.length >= 4) {
        const text = w.map((c) => c.item.ch).join('');
        const pts = hyphenPoints(text).reverse();
        let done = false;
        for (const p of pts) {
          const head = w.slice(0, p);
          const hy = hyphenItem(head[head.length - 1].item.underline);
          const hw = wordW(head) + hy.w + (line.words.length ? spaceW : 0);
          if (lineW + hw <= avail() + 1e-6) {
            line.words.push([...head, hy]);
            lineW += hw;
            pushLine();
            queue.unshift(w.slice(p));
            done = true;
            break;
          }
        }
        if (done) continue;
      }
      if (line.words.length) {
        pushLine();
        queue.unshift(w);
        continue;
      }
      // слово длиннее строки — режем по символам
      let acc = 0;
      let cut = 0;
      while (cut < w.length && acc + w[cut].w <= avail()) acc += w[cut++].w;
      cut = Math.max(1, cut);
      line.words.push(w.slice(0, cut));
      lineW = acc;
      pushLine();
      if (cut < w.length) queue.unshift(w.slice(cut));
    }
    if (line.words.length) lines.push(line);
    if (lines.length) lines[lines.length - 1].lastOfPara = true;

    // размещение
    for (const lb of lines) {
      const { page: pg, slot: sl } = takeSlot();
      const m = marginsFor(pg.index);
      const width = m.right - m.left - Math.max(0, capMm * slantK);
      const indent = lb.firstOfPara && !lb.heading ? typo.indent : 0;
      const natural = lb.words.reduce((a, w) => a + wordW(w), 0) + spaceW * Math.max(0, lb.words.length - 1);
      let x = m.left + indent;
      let gap = spaceW;
      if (lb.heading) x = m.left + Math.max(0, (width - natural) / 2);
      else if (typo.align === 'justify' && !lb.lastOfPara && lb.words.length > 1) {
        const g = spaceW + (width - indent - natural) / (lb.words.length - 1);
        if (g <= spaceW * 3.5) gap = g;
      }
      renderLine(pg, sl, x, gap, lb.words);
    }
  }

  function toWords(items: CharItem[]): Word[] {
    const words: Word[] = [];
    let cur: Word = [];
    for (const it of items) {
      if (it.ch === ' ' && it.script === 0) {
        if (cur.length) words.push(cur);
        cur = [];
      } else {
        cur.push({ item: it, w: charWidth(it) });
        charCount++;
      }
    }
    if (cur.length) words.push(cur);
    return words;
  }

  /** Жадная разбивка слов ячейки на строки; слишком длинное слово режется по буквам. */
  function breakWords(words: Word[], width: number): Word[][] {
    const out: Word[][] = [];
    let line: Word[] = [];
    let lw = 0;
    const ww = (w: Word) => w.reduce((a, c) => a + c.w, 0);
    const queue = [...words];
    while (queue.length) {
      const w = queue.shift()!;
      const need = (line.length ? spaceW : 0) + ww(w);
      if (lw + need <= width + 1e-6) { line.push(w); lw += need; continue; }
      if (line.length) { out.push(line); line = []; lw = 0; queue.unshift(w); continue; }
      let acc = 0, cut = 0;
      while (cut < w.length && acc + w[cut].w <= width) acc += w[cut++].w;
      cut = Math.max(1, cut);
      out.push([w.slice(0, cut)]);
      if (cut < w.length) queue.unshift(w.slice(cut));
    }
    if (line.length) out.push(line);
    return out.length ? out : [[]];
  }

  /** Линия от руки: чуть неровная, как по линейке без линейки. */
  function handLine(pg: PageLayout, x0: number, y0: number, x1: number, y1: number) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.ceil(len / 6));
    const wob = 0.12 * live;
    const ph = r.next() * Math.PI * 2;
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const off = wob * Math.sin(t * Math.PI * 2 * Math.max(1, len / 60) + ph) * Math.sin(t * Math.PI);
      pts.push(x0 + (x1 - x0) * t - ((y1 - y0) / (len || 1)) * off, y0 + (y1 - y0) * t + ((x1 - x0) / (len || 1)) * off);
    }
    pg.strokes.push({ pts, line: 0 });
  }

  /** Таблица на всю ширину строки: рамка от руки, текст в ячейках переносится, ряды не разрываются между страницами. */
  function placeTable(rows: CharItem[][][]) {
    const step = baselines.length > 1 ? baselines[1] - baselines[0] : Math.max(capMm * 2, 5);
    const nCol = Math.max(...rows.map((r) => r.length));
    const cellWords = rows.map((r) => Array.from({ length: nCol }, (_, j) => toWords(r[j] ?? [])));
    const pad = Math.max(1, typo.xHeight * 0.5);
    const m0 = marginsFor(page ? page.index : 0);
    const full = m0.right - m0.left;
    // ширина колонки — по самому длинному тексту, но узкие не меньше 12 % и широкие делят остаток
    const nat = Array.from({ length: nCol }, (_, j) =>
      Math.max(...cellWords.map((cw) => cw[j].reduce((a, w) => a + w.reduce((b, c) => b + c.w, 0), 0) + spaceW * Math.max(0, cw[j].length - 1))) + pad * 2,
    );
    // колонка не уже самого длинного слова в ней — иначе слова рвутся по буквам
    const longest = Array.from({ length: nCol }, (_, j) => Math.max(0, ...cellWords.flatMap((cw) => cw[j].map((w) => w.reduce((b, c) => b + c.w, 0))))) ;
    const minW = longest.map((l) => Math.min(full * 0.45, Math.max(full * 0.12, l + pad * 2)));
    let widths = nat.map((w, j) => Math.max(minW[j], w));
    const sum = widths.reduce((a, b) => a + b, 0);
    if (sum > full) {
      // ужимаем только широкие колонки
      // ужимаем до длинного слова: сначала самые широкие колонки, пропорционально запасу
      const slack = widths.map((w, j) => w - minW[j]);
      const totalSlack = slack.reduce((a, b) => a + b, 0);
      const over = sum - full;
      widths = widths.map((w, j) => (totalSlack > 0 ? w - (over * slack[j]) / totalSlack : (w * full) / sum));
    } else widths = widths.map((w) => (w * full) / sum);
    const top = (sl: number) => baselines[sl] - step * 0.72;
    let first = true;
    for (const cw of cellWords) {
      const lines = cw.map((words, j) => breakWords(words, widths[j] - pad * 2));
      const need = Math.max(1, ...lines.map((l) => l.length));
      if (!page || slot + need > baselines.length) { newPage(); first = true; }
      const pg = page!;
      const m = marginsFor(pg.index);
      const y0 = top(slot);
      const y1 = top(slot) + need * step;
      if (first) handLine(pg, m.left, y0, m.left + full, y0);
      first = false;
      let x = m.left;
      for (let j = 0; j < nCol; j++) {
        lines[j].forEach((ln, k) => { if (ln.length) renderLine(pg, slot + k, x + pad, spaceW, ln); });
        x += widths[j];
      }
      handLine(pg, m.left, y1, m.left + full, y1);
      x = m.left;
      for (let j = 0; j <= nCol; j++) {
        handLine(pg, x, y0, x, y1);
        x += widths[j] ?? 0;
      }
      slot += need;
      pg.usedLines = slot;
    }
  }

  /** Рисунок на всю ширину строки: занимает целые строки страницы, не помещается — переходит на следующую. */
  function placeImage(id: string, frac: number, tool: 'pen' | 'pencil' | 'space') {
    const d = inp.images?.[id];
    const aspect = d?.aspect ?? 0.6;
    const step = baselines.length > 1 ? baselines[1] - baselines[0] : Math.max(capMm * 2, 5);
    const m0 = marginsFor(page ? page.index : 0);
    const full = m0.right - m0.left;
    let w = full * frac;
    let h = w * aspect;
    const pageH = step * baselines.length;
    if (h > pageH * 0.85) { h = pageH * 0.85; w = h / aspect; }
    const lines = Math.max(1, Math.ceil(h / step + 0.4));
    if (!page || slot + lines > baselines.length) newPage();
    const pg = page!;
    const m = marginsFor(pg.index);
    const top = baselines[slot] - step + (lines * step - h) / 2;
    const left = m.left + (m.right - m.left - w) / 2;
    if (d && tool !== 'space') {
      for (const p of d.paths) {
        const pts: number[] = new Array(p.length);
        for (let i = 0; i < p.length; i += 2) {
          pts[i] = left + p[i] * w;
          pts[i + 1] = top + p[i + 1] * w;
        }
        pg.strokes.push(tool === 'pencil' ? { pts, line: 0, tool: 'pencil' } : { pts, line: 0 });
      }
    }
    slot += lines;
    pg.usedLines = slot;
  }

  function renderLine(pg: PageLayout, sl: number, x0: number, gap: number, words: Word[]) {
    const baseline = baselines[sl];
    const lineNo = sl + 1;
    // дрейф строки
    const amp = 0.25 * live;
    const phase = r.next() * Math.PI * 2;
    const lambda = r.range(60, 130);
    const tilt = r.sym() * 0.004 * live;
    const drift = (u: number) => amp * Math.sin(((u - x0) / lambda) * Math.PI * 2 + phase) + tilt * (u - x0);
    let x = x0;
    let ulStart: number | null = null;
    const ulY = baseline + Math.max(descMm * 0.35, 0.5);
    const flushUnderline = (xEnd: number) => {
      if (ulStart === null) return;
      const pts: number[] = [];
      const n = Math.max(2, Math.ceil((xEnd - ulStart) / 5));
      for (let i = 0; i <= n; i++) {
        const u = ulStart + ((xEnd - ulStart) * i) / n;
        pts.push(u, ulY + drift(u));
      }
      pg.strokes.push({ pts, line: lineNo });
      ulStart = null;
    };
    words.forEach((w, wi) => {
      // связное письмо: копим один непрерывный штрих на слово
      let run: number[] = [];
      let joints: number[] = [];
      let prev: { x: number; y: number; t: [number, number] } | null = null;
      let prevStart = 0;
      const flushRun = () => {
        if (run.length >= 4) {
          pg.strokes.push({ pts: run, line: lineNo });
          if (trace && joints.length) trace.runs.push({ page: pg.index, pts: run, joints });
        }
        run = [];
        joints = [];
        prev = null;
      };
      for (const c of w) {
        if (c.item.underline && ulStart === null) ulStart = x;
        if (!c.item.underline) flushUnderline(x);
        const out = renderChar(c, x, baseline, drift, r);
        if (trace && out.strokes.length) trace.glyphs.push({ ch: c.item.ch, page: pg.index, strokes: out.strokes });
        const joinable = cursive && out.aIn !== null && out.aOut !== null && !c.item.script;
        if (joinable) {
          let main = out.strokes[0];
          if (prev !== null && run.length) {
            // концы букв у стыка срезаем: связке нужен разгон, чтобы плавно повернуть из одной буквы в другую
            const keep = Math.max(prevStart + 4, trimEnd(run, joinTrim));
            run.length = keep;
            main = main.slice(trimStart(main, joinTrim));
            joints.push(run.length / 2 - 1);
            const from = { x: run[run.length - 2], y: run[run.length - 1] };
            const tOut = strokeTangent(run, true, joinProbe) ?? [1, 0];
            const tIn = strokeTangent(main, false, joinProbe) ?? [1, 0];
            run.push(...connector(from, { x: main[0], y: main[1] }, tOut, tIn));
            joints.push(run.length / 2);
          }
          prevStart = run.length;
          run.push(...main);
          for (let i = 1; i < out.strokes.length; i++) if (i !== out.oi) pg.strokes.push({ pts: out.strokes[i], line: lineNo });
          if (out.oi) {
            // выход из буквы — другой штрих (хвостик): он начинает следующий связный штрих
            flushRun();
            prevStart = 0;
            run.push(...out.strokes[out.oi]);
          }
          prev = out.aOut;
        } else {
          flushRun();
          for (const st of out.strokes) pg.strokes.push({ pts: st, line: lineNo });
        }
        x += c.w;
      }
      flushRun();
      if (wi < words.length - 1) {
        const nextUl = words[wi + 1][0]?.item.underline;
        if (!nextUl) flushUnderline(x - letterGap);
        x += gap * (1 + r.sym() * 0.12 * live);
      }
    });
    flushUnderline(x - letterGap);
  }

  function renderChar(c: Measured, x: number, baseline: number, drift: (u: number) => number, rr: Rng) {
    const first = resolveGlyph(font, c.item.ch);
    let variant = 0;
    if (first.variants > 1) {
      variant = rr.int(first.variants);
      if (variant === lastVariant.get(c.item.ch)) variant = (variant + 1) % first.variants;
      lastVariant.set(c.item.ch, variant);
    }
    const g = variant ? resolveGlyph(font, c.item.ch, variant) : first;
    const sc = (c.item.script ? SCRIPT_SCALE : 1) * (1 + rr.sym() * 0.05 * live);
    const rot = ((rr.sym() * 3 * Math.PI) / 180) * live;
    const dx = rr.sym() * 0.3 * live;
    const dy = rr.sym() * 0.15 * live;
    const scriptDy = c.item.script === 1 ? typo.xHeight * 0.55 : c.item.script === -1 ? -typo.xHeight * 0.3 : 0;
    const k = g.k * s * sc;
    const cx = (g.glyph.w * k) / 2;
    const cy = (typo.xHeight * sc) / 2;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const tp = (ax: number, ay: number): [number, number] => {
      let X = ax * k - cx;
      let Y = ay * k - cy;
      const X2 = X * cos - Y * sin;
      const Y2 = X * sin + Y * cos;
      X = X2 + cx;
      Y = Y2 + cy;
      X += Y * slantK;
      const u = x + X + dx;
      return [u, baseline + drift(u) - (Y + scriptDy) + dy];
    };
    const strokes: number[][] = [];
    for (const st of g.glyph.s) {
      const pts: number[] = new Array(st.length);
      for (let i = 0; i < st.length; i += 2) {
        const [u, v] = tp(st[i], st[i + 1]);
        pts[i] = u;
        pts[i + 1] = v;
      }
      strokes.push(pts);
    }
    // связка идёт от настоящего конца главного штриха к настоящему началу следующего:
    // i/o шрифта лишь говорят, что буква соединяется, и могут стоять в стороне от штриха
    let aIn: { x: number; y: number; t: [number, number] } | null = null;
    let aOut: { x: number; y: number; t: [number, number] } | null = null;
    const oi = g.glyph.oi && g.glyph.oi < strokes.length ? g.glyph.oi : 0;
    if (g.glyph.i && g.glyph.o && strokes.length) {
      const m = strokes[0];
      const e = strokes[oi];
      aIn = { x: m[0], y: m[1], t: [1, 0] };
      aOut = { x: e[e.length - 2], y: e[e.length - 1], t: [1, 0] };
    }
    return { strokes, aIn, aOut, oi };
  }

  return { pages, missingChars: [...missing], chars: charCount, trace };
}

/** Габариты набора штрихов. */
export function strokesBounds(strokes: Stroke[]) {
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (const st of strokes)
    for (let i = 0; i < st.pts.length; i += 2) {
      const u = st.pts[i], v = st.pts[i + 1];
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  return { minU, minV, maxU, maxV, empty: minU === Infinity };
}
