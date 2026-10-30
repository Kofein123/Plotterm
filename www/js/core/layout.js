import { resolveGlyph } from "../fonts/fonts.js";
import { parseMarkup } from "./markup.js";
import { hyphenPoints } from "./hyphen.js";
import { rng } from "./rng.js";
import { connector, isHighExit } from "./cursive.js";
const SCRIPT_SCALE = 0.62;
/** Базовые линии всех строк страницы. */
export function pageBaselines(paper, capMm, descMm, gridOrigin) {
    let step;
    let origin;
    if (paper.template === 'grid') {
        step = Math.max(1, paper.cell * Math.max(1, paper.gridLineCells));
        origin = gridOrigin ? gridOrigin[1] : 0;
    }
    else if (paper.template === 'ruled') {
        step = Math.max(2, paper.rulePitch);
        origin = gridOrigin ? gridOrigin[1] : 0;
    }
    else {
        step = Math.max(1, paper.blankLineStep);
        origin = paper.marginTop + capMm;
    }
    const minFirst = paper.marginTop + capMm * 0.9;
    let b = origin + Math.ceil((minFirst - origin) / step - 1e-9) * step;
    const out = [];
    const maxB = paper.height - paper.marginBottom - descMm * 0.3;
    while (b <= maxB + 1e-9 && out.length < 500) {
        out.push(b);
        b += step;
    }
    return out;
}
export function layoutText(inp) {
    const { font, typo, paper } = inp;
    const s = typo.xHeight / font.xHeight;
    const capMm = font.capHeight * s;
    const descMm = font.descender * s;
    // у импортированных шрифтов собственный интервал 0 — тогда регулятор работает от 30 % x-высоты
    const letterGap = (font.letterSpacing + (typo.letterSpacing - 1) * (font.letterSpacing || font.xHeight * 0.3)) * s;
    const spaceW = font.wordSpacing * s * typo.wordSpacing;
    const live = Math.max(0, Math.min(10, typo.liveliness)) / 10;
    const r = rng(typo.seed);
    const missing = new Set();
    let charCount = 0;
    const lastVariant = new Map();
    const slantK = Math.tan((typo.slant * Math.PI) / 180);
    const cursive = typo.cursive !== false;
    const trace = inp.trace ? { glyphs: [], runs: [] } : undefined;
    const charWidth = (it) => {
        const g = resolveGlyph(font, it.ch);
        if (g.missing)
            missing.add(it.ch);
        const sc = it.script ? SCRIPT_SCALE : 1;
        return (g.glyph.w * g.k * s + letterGap) * sc;
    };
    const hyphenItem = (u) => {
        const item = { ch: '-', script: 0, underline: u };
        return { item, w: charWidth(item) };
    };
    const baselines = pageBaselines(paper, capMm, descMm, inp.gridOrigin);
    const pages = [];
    const marginsFor = (pi) => {
        const mirrored = paper.side === 'left' || (paper.side === 'alternate' && pi % 2 === 1);
        return mirrored
            ? { left: paper.marginRight, right: paper.width - paper.marginLeft, mirrored }
            : { left: paper.marginLeft, right: paper.width - paper.marginRight, mirrored };
    };
    let page = null;
    let slot = 0;
    const newPage = () => {
        const m = marginsFor(pages.length);
        page = { index: pages.length, strokes: [], usedLines: 0, totalLines: baselines.length, mirrored: m.mirrored, baselines };
        pages.push(page);
        slot = pages.length === 1 ? Math.max(0, Math.min(baselines.length - 1, paper.startLine - 1)) : 0;
        page.usedLines = slot;
    };
    const takeSlot = () => {
        if (!page || slot >= baselines.length)
            newPage();
        const res = { page: page, slot };
        slot++;
        page.usedLines = slot;
        return res;
    };
    if (!baselines.length)
        return { pages: [], missingChars: [], chars: 0 };
    const paragraphs = parseMarkup(inp.text);
    for (const para of paragraphs) {
        if (para.kind === 'page') {
            if (page)
                slot = baselines.length; // следующая строка начнёт новую страницу
            continue;
        }
        if (para.kind === 'blank') {
            takeSlot();
            continue;
        }
        // слова
        const words = [];
        let cur = [];
        for (const it of para.chars) {
            if (it.ch === ' ' && it.script === 0) {
                if (cur.length)
                    words.push(cur);
                cur = [];
            }
            else {
                cur.push({ item: it, w: charWidth(it) });
                charCount++;
            }
        }
        if (cur.length)
            words.push(cur);
        if (!words.length) {
            takeSlot();
            continue;
        }
        // разбиение на строки (ширина берётся по первой странице — поля симметричны по ширине)
        const m0 = marginsFor(pages.length ? pages.length - 1 : 0);
        // наклонённые буквы выступают вправо на высоту прописной × tg(наклона)
        const slantPad = Math.max(0, capMm * slantK);
        const full = m0.right - m0.left - slantPad;
        const lines = [];
        let line = { words: [], heading: para.heading, firstOfPara: true, lastOfPara: false };
        let lineW = 0;
        const avail = () => full - (line.firstOfPara && !para.heading ? typo.indent : 0);
        const pushLine = () => {
            lines.push(line);
            line = { words: [], heading: para.heading, firstOfPara: false, lastOfPara: false };
            lineW = 0;
        };
        const wordW = (w) => w.reduce((a, c) => a + c.w, 0);
        const queue = [...words];
        while (queue.length) {
            const w = queue.shift();
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
                if (done)
                    continue;
            }
            if (line.words.length) {
                pushLine();
                queue.unshift(w);
                continue;
            }
            // слово длиннее строки — режем по символам
            let acc = 0;
            let cut = 0;
            while (cut < w.length && acc + w[cut].w <= avail())
                acc += w[cut++].w;
            cut = Math.max(1, cut);
            line.words.push(w.slice(0, cut));
            lineW = acc;
            pushLine();
            if (cut < w.length)
                queue.unshift(w.slice(cut));
        }
        if (line.words.length)
            lines.push(line);
        if (lines.length)
            lines[lines.length - 1].lastOfPara = true;
        // размещение
        for (const lb of lines) {
            const { page: pg, slot: sl } = takeSlot();
            const m = marginsFor(pg.index);
            const width = m.right - m.left - Math.max(0, capMm * slantK);
            const indent = lb.firstOfPara && !lb.heading ? typo.indent : 0;
            const natural = lb.words.reduce((a, w) => a + wordW(w), 0) + spaceW * Math.max(0, lb.words.length - 1);
            let x = m.left + indent;
            let gap = spaceW;
            if (lb.heading)
                x = m.left + Math.max(0, (width - natural) / 2);
            else if (typo.align === 'justify' && !lb.lastOfPara && lb.words.length > 1) {
                const g = spaceW + (width - indent - natural) / (lb.words.length - 1);
                if (g <= spaceW * 3.5)
                    gap = g;
            }
            renderLine(pg, sl, x, gap, lb.words);
        }
    }
    function renderLine(pg, sl, x0, gap, words) {
        const baseline = baselines[sl];
        const lineNo = sl + 1;
        // дрейф строки
        const amp = 0.25 * live;
        const phase = r.next() * Math.PI * 2;
        const lambda = r.range(60, 130);
        const tilt = r.sym() * 0.004 * live;
        const drift = (u) => amp * Math.sin(((u - x0) / lambda) * Math.PI * 2 + phase) + tilt * (u - x0);
        let x = x0;
        let ulStart = null;
        const ulY = baseline + Math.max(descMm * 0.35, 0.5);
        const flushUnderline = (xEnd) => {
            if (ulStart === null)
                return;
            const pts = [];
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
            let run = [];
            let joints = [];
            let prev = null;
            const flushRun = () => {
                if (run.length >= 4) {
                    pg.strokes.push({ pts: run, line: lineNo });
                    if (trace && joints.length)
                        trace.runs.push({ page: pg.index, pts: run, joints });
                }
                run = [];
                joints = [];
                prev = null;
            };
            for (const c of w) {
                if (c.item.underline && ulStart === null)
                    ulStart = x;
                if (!c.item.underline)
                    flushUnderline(x);
                const out = renderChar(c, x, baseline, drift, r);
                if (trace && out.strokes.length)
                    trace.glyphs.push({ ch: c.item.ch, page: pg.index, strokes: out.strokes });
                const joinable = cursive && out.aIn !== null && out.aOut !== null && !c.item.script;
                if (joinable) {
                    if (prev !== null && run.length) {
                        joints.push(run.length / 2 - 1);
                        run.push(...connector(prev, out.aIn, prev.high));
                        joints.push(run.length / 2);
                    }
                    run.push(...out.strokes[0]);
                    for (let i = 1; i < out.strokes.length; i++)
                        pg.strokes.push({ pts: out.strokes[i], line: lineNo });
                    prev = out.aOut;
                }
                else {
                    flushRun();
                    for (const st of out.strokes)
                        pg.strokes.push({ pts: st, line: lineNo });
                }
                x += c.w;
            }
            flushRun();
            if (wi < words.length - 1) {
                const nextUl = words[wi + 1][0]?.item.underline;
                if (!nextUl)
                    flushUnderline(x - letterGap);
                x += gap * (1 + r.sym() * 0.12 * live);
            }
        });
        flushUnderline(x - letterGap);
    }
    function renderChar(c, x, baseline, drift, rr) {
        const first = resolveGlyph(font, c.item.ch);
        let variant = 0;
        if (first.variants > 1) {
            variant = rr.int(first.variants);
            if (variant === lastVariant.get(c.item.ch))
                variant = (variant + 1) % first.variants;
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
        const tp = (ax, ay) => {
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
        const strokes = [];
        for (const st of g.glyph.s) {
            const pts = new Array(st.length);
            for (let i = 0; i < st.length; i += 2) {
                const [u, v] = tp(st[i], st[i + 1]);
                pts[i] = u;
                pts[i + 1] = v;
            }
            strokes.push(pts);
        }
        let aIn = null;
        let aOut = null;
        if (g.glyph.i && g.glyph.o && strokes.length) {
            const pi = tp(g.glyph.i[0], g.glyph.i[1]);
            const po = tp(g.glyph.o[0], g.glyph.o[1]);
            aIn = { x: pi[0], y: pi[1], high: isHighExit(g.glyph.i[1], font.xHeight) };
            aOut = { x: po[0], y: po[1], high: isHighExit(g.glyph.o[1], font.xHeight) };
        }
        return { strokes, aIn, aOut };
    }
    return { pages, missingChars: [...missing], chars: charCount, trace };
}
/** Габариты набора штрихов. */
export function strokesBounds(strokes) {
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const st of strokes)
        for (let i = 0; i < st.pts.length; i += 2) {
            const u = st.pts[i], v = st.pts[i + 1];
            if (u < minU)
                minU = u;
            if (u > maxU)
                maxU = u;
            if (v < minV)
                minV = v;
            if (v > maxV)
                maxV = v;
        }
    return { minU, minV, maxU, maxV, empty: minU === Infinity };
}
