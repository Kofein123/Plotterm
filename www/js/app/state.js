// Состояние приложения: настройки (сохраняются в браузере), шрифты, вёрстка, плата, задание.
import { signal, persisted, effect, computed, createRoot, batch } from "../ui/reactive.js";
import { DEFAULT_CALIBRATION, sheetFrame, workToPaper } from "../core/calibration.js";
import { layoutText } from "../core/layout.js";
import { buildPlan, DEFAULT_LIMITS } from "../core/plan.js";
import { BUILTIN_FONTS, fromCustom } from "../fonts/fonts.js";
import { Machine } from "../grbl/machine.js";
import { JobRunner } from "../grbl/job.js";
import { idb } from "../store/db.js";
import { parseGcodePaths } from "../io/importers.js";
export const SAMPLE_TEXT = `# Конспект
Это пример. Вставьте сюда свой текст — он будет написан ручкой на листе.
Пустая строка пропускает строку, «===» начинает новую страницу, строка с «# » — заголовок по центру.
Формулы: E = mc^2, a_1 + a_{12}, √x. Подчёркивание: __важно__.
Қазақша да болады: әліппе, ғылым, қала, өнер.`;
export const PAPER_PRESETS = {
    a4: { name: 'Чистый лист A4', hint: '210×297', p: { template: 'a4', width: 210, height: 297, marginTop: 15, marginBottom: 15, marginLeft: 20, marginRight: 15, blankLineStep: 8 } },
    grid: { name: 'Тетрадь в клетку', hint: 'клетка 5 мм, поле справа', p: { template: 'grid', width: 165, height: 205, marginTop: 5, marginBottom: 5, marginLeft: 5, marginRight: 25, cell: 5, gridLineCells: 2 } },
    ruled: { name: 'Тетрадь в линейку', hint: 'линия 8 мм, поле справа', p: { template: 'ruled', width: 165, height: 205, marginTop: 8, marginBottom: 5, marginLeft: 5, marginRight: 22, rulePitch: 8 } },
};
const DEFAULT_PAPER = {
    template: 'a4', width: 210, height: 297, marginTop: 15, marginBottom: 15, marginLeft: 20, marginRight: 15,
    blankLineStep: 8, cell: 5, gridLineCells: 2, rulePitch: 8, side: 'right', rotate180: false, startLine: 1,
};
const DEFAULT_TYPO = {
    fontId: 'gost-a', xHeight: 3, slant: 12, letterSpacing: 1, wordSpacing: 1, align: 'left', hyphenate: true, indent: 10, liveliness: 3, seed: 1,
};
const DEFAULT_PEN = { pressure: 0.4, zDownFeed: 3000, dwellMs: 0, zDownRapid: false, hopLift: 0.8, hopDistance: 6 };
const DEFAULT_SPEED = { profile: 'normal', customFeed: 4000, travelFeed: 0, joinTolerance: 0.15, simplify: 0.05, park: 'zero' };
const DEFAULT_PREFS = {
    jogStep: 1, jogFeed: 3000, zStep: 0.5, zFeed: 600, simSpeed: 4, showTravel: false, keepSignals: false,
    autoReconnect: true, allowUncalibrated: false, sound: true, timeFactor: 1, leftTab: 'text', baud: 115200,
};
export const app = createRoot(() => {
    const text = persisted('text', SAMPLE_TEXT);
    const typo = persisted('typo', DEFAULT_TYPO);
    const paper = persisted('paper', DEFAULT_PAPER);
    const pen = persisted('pen', DEFAULT_PEN);
    const speed = persisted('speed', DEFAULT_SPEED);
    const calib = persisted('calib', DEFAULT_CALIBRATION);
    const prefs = persisted('prefs', DEFAULT_PREFS);
    const stats = persisted('stats', { meters: 0, seconds: 0, pages: 0, sinceRefill: 0 });
    const profiles = persisted('profiles', []);
    const source = signal({ kind: 'text' });
    const customFonts = signal([]);
    const fonts = computed(() => [...BUILTIN_FONTS, ...customFonts.value.map((r) => fromCustom(r))]);
    const font = computed(() => fonts.value.find((f) => f.id === typo.value.fontId) ?? BUILTIN_FONTS[0]);
    const frame = computed(() => sheetFrame(calib.value));
    // вёрстка с небольшой задержкой, чтобы не пересчитывать на каждую букву
    const layout = signal({ pages: [], missingChars: [], chars: 0 });
    let layoutTimer;
    effect(() => {
        const inp = { text: text.value, font: font.value, typo: typo.value, paper: paper.value, gridOrigin: calib.value.gridOrigin };
        clearTimeout(layoutTimer);
        layoutTimer = setTimeout(() => {
            layout.value = layoutText(inp);
        }, 120);
    });
    const machine = new Machine();
    const limits = computed(() => {
        const s = machine.settings.value;
        const num = (k, d) => {
            const v = parseFloat(s.get(k) ?? '');
            return Number.isFinite(v) && v > 0 ? v : d;
        };
        return {
            rapid: Math.min(num(110, DEFAULT_LIMITS.rapid), num(111, DEFAULT_LIMITS.rapid)),
            accel: Math.min(num(120, DEFAULT_LIMITS.accel), num(121, DEFAULT_LIMITS.accel)),
            zRate: num(112, DEFAULT_LIMITS.zRate),
            zAccel: num(122, DEFAULT_LIMITS.zAccel),
        };
    });
    const currentPage = signal(0);
    const dryRun = signal(false);
    /** страницы для печати/предпросмотра в текущем режиме */
    const pageStrokes = computed(() => {
        const src = source.value;
        if (src.kind === 'drawing')
            return [src.strokes];
        if (src.kind === 'gcode')
            return [[]];
        return layout.value.pages.map((p) => p.strokes);
    });
    const pageCount = computed(() => pageStrokes.value.length);
    function planFor(pageIdx, opts = {}) {
        const src = source.peek();
        if (src.kind === 'gcode')
            return gcodePlan(src.lines);
        const strokes = pageStrokes.peek()[pageIdx];
        if (!strokes)
            return null;
        const p = paper.peek();
        const f = frame.peek();
        const fr = f.ready ? f : { ...f, width: p.width, height: p.height };
        return buildPlan({
            strokes,
            pageW: p.width,
            pageH: p.height,
            rotate180: p.rotate180,
            frame: fr,
            calib: calib.peek(),
            pen: pen.peek(),
            speed: speed.peek(),
            limits: limits.peek(),
            dryRun: !!opts.dryRun,
            reorder: true,
            title: src.kind === 'drawing' ? src.name : `страница ${pageIdx + 1}`,
            timeFactor: prefs.peek().timeFactor,
        });
    }
    /** план текущей страницы для предпросмотра (порядок, холостые ходы, границы, время) */
    const previewPlan = signal(null);
    let planTimer;
    effect(() => {
        // зависимости
        pageStrokes.value;
        currentPage.value;
        paper.value;
        calib.value;
        pen.value;
        speed.value;
        limits.value;
        source.value;
        prefs.value.timeFactor;
        clearTimeout(planTimer);
        planTimer = setTimeout(() => {
            const n = pageStrokes.peek().length;
            if (currentPage.peek() >= n && n > 0)
                currentPage.value = n - 1;
            previewPlan.value = planFor(Math.min(currentPage.peek(), Math.max(0, n - 1)));
        }, 60);
    });
    /** оценка времени всех страниц */
    const totalEstimate = signal(0);
    let estTimer;
    effect(() => {
        pageStrokes.value;
        speed.value;
        pen.value;
        limits.value;
        prefs.value.timeFactor;
        clearTimeout(estTimer);
        estTimer = setTimeout(() => {
            let t = 0;
            for (let i = 0; i < pageStrokes.peek().length; i++)
                t += planFor(i)?.estSeconds ?? 0;
            totalEstimate.value = t;
        }, 400);
    });
    const isPenDown = (z) => {
        const c = calib.peek();
        const dir = c.upZ >= 0 ? 1 : -1;
        return z * dir < Math.min(0.2, Math.abs(c.upZ) * 0.35);
    };
    const job = new JobRunner(machine, {
        upZ: () => calib.peek().upZ,
        toPaper: (x, y) => workToPaper(frame.peek(), x, y),
        penDownAt: isPenDown,
        onPageDone: (est, actual) => {
            // учимся только на настоящем плоттере (симулятор может идти в ускоренном режиме)
            if (machine.transport?.kind === 'serial' && est > 30 && actual > 10) {
                const ratio = actual / est;
                const tf = prefs.peek().timeFactor * (0.6 + 0.4 * ratio);
                prefs.patch({ timeFactor: Math.max(0.4, Math.min(2.5, tf)) });
            }
        },
    });
    return {
        text, typo, paper, pen, speed, calib, prefs, stats, profiles, source,
        customFonts, fonts, font, frame, layout, machine, limits, currentPage, dryRun,
        pageStrokes, pageCount, planFor, previewPlan, totalEstimate, job, isPenDown,
    };
});
/** План для чужого G-кода: штрихи только для предпросмотра. */
function gcodePlan(lines) {
    const { strokes, lineStroke } = parseGcodePaths(lines, (z) => app.isPenDown(z));
    const f = app.frame.peek();
    const paperStrokes = strokes.map((s) => {
        const out = [];
        for (let i = 0; i < s.pts.length; i += 2)
            out.push(...workToPaper(f, s.pts[i], s.pts[i + 1]));
        return out;
    });
    const outOfBounds = [];
    paperStrokes.forEach((s, i) => {
        for (let j = 0; j < s.length; j += 2)
            if (s[j] < -0.3 || s[j + 1] < -0.3 || s[j] > f.width + 0.3 || s[j + 1] > f.height + 0.3) {
                outOfBounds.push(i);
                break;
            }
    });
    const strokeStart = strokes.map((s) => s.startLine);
    return {
        strokes: paperStrokes, strokeLine: strokes.map(() => 0), gcode: lines, strokeStart, lineStroke,
        outOfBounds, drawLength: 0, travelLength: 0, penLifts: strokes.length, estSeconds: 0, strokeTime: strokes.map(() => 0),
    };
}
// --- пользовательские шрифты ---
export async function loadCustomFonts() {
    try {
        const list = await idb.all('fonts');
        app.customFonts.value = list.sort((a, b) => a.name.localeCompare(b.name));
    }
    catch {
        /* IndexedDB недоступна (приватный режим) */
    }
}
export async function saveCustomFont(rec) {
    rec.updatedAt = Date.now();
    await idb.set('fonts', rec.id, rec);
    const list = app.customFonts.peek().filter((f) => f.id !== rec.id);
    app.customFonts.value = [...list, structuredClone(rec)].sort((a, b) => a.name.localeCompare(b.name));
}
export async function deleteCustomFont(id) {
    await idb.del('fonts', id);
    batch(() => {
        app.customFonts.value = app.customFonts.peek().filter((f) => f.id !== id);
        if (app.typo.peek().fontId === id)
            app.typo.patch({ fontId: 'gost-a' });
    });
}
