// «Мой почерк»: рисуете буквы мышью или стилусом, по 3–5 вариантов каждой; недостающие берутся из базового шрифта.
import { h } from '../dom.ts';
import { signal, effect, computed } from '../reactive.ts';
import { app, saveCustomFont, deleteCustomFont } from '../../app/state.ts';
import { BUILTIN_FONTS, CUSTOM_X_HEIGHT, resolveGlyph } from '../../fonts/fonts.ts';
import type { CustomFontRecord, GlyphData } from '../../fonts/types.ts';
import { Btn, Field, Icon, NumInput, Note, Section, Select, Segmented } from '../components.tsx';
import { downloadText, pickFile, toast } from '../../app/notify.ts';
import { importSvgFont } from '../../io/svgfont.ts';
import { importOutlineFont } from '../../io/outlinefont.ts';
import { templateSvg } from '../../io/template.ts';
import { readTemplate } from '../../io/templateImport.ts';
import { imageFileToGray } from '../../io/image.ts';

const GROUPS: Record<string, string> = {
  lower: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
  upper: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
  digits: '0123456789',
  punct: '.,:;!?-—()«»"\'/+=%№',
  kaz: 'әғқңөұүһіӘҒҚҢӨҰҮҺІ',
  latin: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
};
const GROUP_NAMES: { value: string; label: string }[] = [
  { value: 'lower', label: 'строчные' }, { value: 'upper', label: 'прописные' }, { value: 'digits', label: 'цифры' },
  { value: 'punct', label: 'знаки' }, { value: 'kaz', label: 'қазақ' }, { value: 'latin', label: 'latin' },
];

const editing = signal<CustomFontRecord | null>(null);
const group = signal('lower');
const ch = signal('а');
const strokes = signal<number[][]>([]);
const hasEditing = computed(() => editing.value !== null);

// геометрия холста редактора
const CW = 420, CH = 320;
const PX = 1.1; // пикселей на единицу шрифта (x-height = 100 ед.)
const BASE_Y = 220;
const LEFT_X = 90;
const toCanvas = (x: number, y: number): [number, number] => [LEFT_X + x * PX, BASE_Y - y * PX];
const toUnits = (cx: number, cy: number): [number, number] => [(cx - LEFT_X) / PX, (BASE_Y - cy) / PX];

function normalize(st: number[][], letterGap: number): GlyphData | null {
  const all = st.flat();
  if (!all.length) return null;
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < all.length; i += 2) {
    minX = Math.min(minX, all[i]);
    maxX = Math.max(maxX, all[i]);
  }
  void letterGap;
  return {
    w: Math.round((maxX - minX) * 10) / 10,
    s: st.map((s) => s.map((v, i) => Math.round((i % 2 === 0 ? v - minX : v) * 10) / 10)),
  };
}

function glyphSvg(g: GlyphData, size = 44) {
  const pad = 10;
  const minY = -60, maxY = 160;
  const w = Math.max(g.w, 40) + pad * 2;
  const hgt = maxY - minY;
  const d = g.s
    .map((s) => {
      const pts: string[] = [];
      for (let i = 0; i < s.length; i += 2) pts.push(`${(s[i] + pad).toFixed(1)},${(maxY - s[i + 1]).toFixed(1)}`);
      return 'M' + pts.join(' L');
    })
    .join(' ');
  return (
    <svg width={size * (w / hgt)} height={size} viewBox={`0 0 ${w} ${hgt}`}>
      <line x1="0" x2={w} y1={maxY} y2={maxY} stroke="var(--grid)" stroke-width="2" />
      <path d={d} fill="none" stroke="var(--ink)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function newFont() {
  const name = prompt('Название шрифта (например: «Мой почерк»):', 'Мой почерк');
  if (!name) return;
  const rec: CustomFontRecord = { id: 'custom-' + Date.now().toString(36), name, baseFontId: app.typo.peek().fontId.startsWith('custom') ? 'gost-a' : app.typo.peek().fontId, glyphs: {}, letterSpacing: 12, wordSpacing: 45, updatedAt: Date.now() };
  saveCustomFont(rec).then(() => {
    editing.value = structuredClone(rec);
    toast('Шрифт создан. Рисуйте буквы — каждую 3–5 раз, чтобы почерк был живым.', 'ok', 7000);
  });
}

async function persist() {
  const r = editing.peek();
  if (r) await saveCustomFont(r);
}

function saveVariant() {
  const r = editing.peek();
  if (!r) return;
  const g = normalize(strokes.peek(), r.letterSpacing);
  if (!g) return toast('Сначала нарисуйте букву.', 'warn');
  const list = r.glyphs[ch.peek()] ?? [];
  r.glyphs[ch.peek()] = [...list, g];
  editing.value = { ...r };
  strokes.value = [];
  persist();
  if ((r.glyphs[ch.peek()]?.length ?? 0) >= 3) nextChar();
}

function nextChar() {
  const chars = [...GROUPS[group.peek()]];
  const i = chars.indexOf(ch.peek());
  ch.value = chars[(i + 1) % chars.length];
  strokes.value = [];
}

function deleteVariant(i: number) {
  const r = editing.peek();
  if (!r) return;
  const list = (r.glyphs[ch.peek()] ?? []).slice();
  list.splice(i, 1);
  r.glyphs[ch.peek()] = list;
  if (!list.length) delete r.glyphs[ch.peek()];
  editing.value = { ...r };
  persist();
}

function Editor() {
  let canvas!: HTMLCanvasElement;
  let drawing: number[] | null = null;
  const redraw = () => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CW * dpr;
    canvas.height = CH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue('--paper');
    ctx.fillRect(0, 0, CW, CH);
    const base = BUILTIN_FONTS.find((f) => f.id === editing.peek()?.baseFontId) ?? BUILTIN_FONTS[0];
    const k = CUSTOM_X_HEIGHT / base.xHeight;
    const lines: [number, string, string][] = [
      [0, 'база', css.getPropertyValue('--ink')],
      [CUSTOM_X_HEIGHT, 'x', css.getPropertyValue('--grid-strong')],
      [base.capHeight * k, 'прописные', css.getPropertyValue('--grid')],
      [-base.descender * k, 'хвосты', css.getPropertyValue('--grid')],
    ];
    ctx.font = '11px system-ui, sans-serif';
    for (const [y, label, color] of lines) {
      const [, cy] = toCanvas(0, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = y === 0 ? 1.5 : 1;
      ctx.setLineDash(y === 0 ? [] : [5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(CW, cy);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(label, 4, cy - 3);
    }
    ctx.setLineDash([]);
    // образец из базового шрифта
    const ref = resolveGlyph(base, ch.peek());
    if (!ref.missing) {
      ctx.strokeStyle = css.getPropertyValue('--ghost');
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const s of ref.glyph.s) {
        for (let i = 0; i < s.length; i += 2) {
          const [x, y] = toCanvas(s[i] * k + 20, s[i + 1] * k);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    // нарисованное
    ctx.strokeStyle = css.getPropertyValue('--ink');
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const s of [...strokes.peek(), ...(drawing ? [drawing] : [])]) {
      for (let i = 0; i < s.length; i += 2) {
        const [x, y] = toCanvas(s[i], s[i + 1]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  };
  effect(() => {
    strokes.value; ch.value; editing.value;
    requestAnimationFrame(redraw);
  });
  const pos = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return toUnits(((e.clientX - r.left) / r.width) * CW, ((e.clientY - r.top) / r.height) * CH);
  };
  return (
    <canvas
      class="glyph-canvas"
      style={`aspect-ratio:${CW}/${CH}`}
      ref={(el: HTMLCanvasElement) => { canvas = el; requestAnimationFrame(redraw); }}
      onPointerDown={(e: PointerEvent) => {
        canvas.setPointerCapture(e.pointerId);
        drawing = [...pos(e)];
      }}
      onPointerMove={(e: PointerEvent) => {
        if (!drawing) return;
        const [x, y] = pos(e);
        const lx = drawing[drawing.length - 2], ly = drawing[drawing.length - 1];
        if (Math.hypot(x - lx, y - ly) >= 1.5) {
          drawing.push(x, y);
          redraw();
        }
      }}
      onPointerUp={() => {
        if (drawing && drawing.length >= 2) {
          if (drawing.length === 2) drawing.push(drawing[0] + 0.6, drawing[1]);
          strokes.value = [...strokes.peek(), drawing];
        }
        drawing = null;
      }}
    />
  );
}

async function exportFont() {
  const r = editing.peek();
  if (!r) return;
  downloadText(`${r.name}.plotterm-font.json`, JSON.stringify(r), 'application/json');
}

export const importBusy = signal<string | null>(null);

export async function importFont() {
  const f = await pickFile('.ttf,.otf,.woff,.woff2,.svg,.json,font/ttf,font/otf,font/woff,font/woff2');
  if (!f) return;
  try {
    let rec: CustomFontRecord;
    const lower = f.name.toLowerCase();
    if (/\.(ttf|otf|woff2?)$/.test(lower)) {
      importBusy.value = 'Читаю шрифт…';
      rec = await importOutlineFont(f, (d, t) => (importBusy.value = `Перевожу буквы в линии: ${d} из ${t}`));
    } else if (lower.endsWith('.svg')) {
      rec = importSvgFont(await f.text(), f.name.replace(/\.svg$/i, ''));
    } else {
      rec = JSON.parse(await f.text());
      if (!rec.glyphs || !rec.name) throw new Error('это не файл шрифта Plotterm');
      rec.id = 'custom-' + Date.now().toString(36);
    }
    await saveCustomFont(rec);
    editing.value = structuredClone(rec);
    app.typo.patch({ fontId: rec.id, letterSpacing: 1, wordSpacing: 1, ...(/\.(ttf|otf|woff2?)$/.test(lower) ? { slant: 0 } : {}) });
    const cyr = [...'абвгдежзийклмнопрстуфхцчшщъыьэюя'].filter((c) => rec.glyphs[c]).length;
    toast(
      `Шрифт «${rec.name}» добавлен и выбран: ${Object.keys(rec.glyphs).length} символов` +
        (cyr < 32 ? `, кириллицы ${cyr}/32 — недостающие буквы возьмутся из ГОСТ.` : ', вся кириллица на месте.'),
      cyr < 20 ? 'warn' : 'ok',
      9000,
    );
  } catch (e: any) {
    toast('Не удалось импортировать: ' + (e?.message ?? e), 'err');
  } finally {
    importBusy.value = null;
  }
}

function downloadTemplate() {
  downloadText('plotterm-list-shablon.svg', templateSvg(), 'image/svg+xml');
  toast('Распечатайте лист в масштабе 100 % («реальный размер»), заполните ручкой и сфотографируйте целиком сверху.', 'info', 9000);
}

/** Фото заполненного листа-шаблона → варианты букв в шрифт, который сейчас открыт (или в новый). */
export async function importTemplatePhoto() {
  const f = await pickFile('image/*');
  if (!f) return;
  try {
    importBusy.value = 'Читаю фото листа…';
    const gray = await imageFileToGray(f);
    importBusy.value = 'Ищу метки и снимаю буквы…';
    await new Promise((r) => setTimeout(r, 0));
    const res = readTemplate(gray);
    if (res.filled < 3) throw new Error('на листе почти нет букв — проверьте, что фото резкое и без бликов');
    let rec = editing.peek();
    if (!rec) {
      rec = { id: 'custom-' + Date.now().toString(36), name: 'Мой почерк', baseFontId: 'gost-b', glyphs: {}, letterSpacing: 12, wordSpacing: 110, updatedAt: Date.now() };
    }
    const glyphs = { ...rec.glyphs };
    for (const [ch, vs] of Object.entries(res.glyphs)) glyphs[ch] = [...(glyphs[ch] ?? []), ...vs];
    rec = { ...rec, glyphs };
    await saveCustomFont(rec);
    editing.value = structuredClone(rec);
    app.typo.patch({ fontId: rec.id });
    toast(`С листа снято ${res.filled} букв, шрифт «${rec.name}» выбран. Каждый новый лист добавляет варианты.`, 'ok', 9000);
  } catch (e: any) {
    toast('Не получилось прочитать лист: ' + (e?.message ?? e), 'err');
  } finally {
    importBusy.value = null;
  }
}

export function HandTab() {
  return (
    <div class="tab">
      <Section title="Мой почерк" aside={<Btn small onClick={newFont}>Нарисовать новый</Btn>}>
        {() => (importBusy.value ? <Note kind="info">{importBusy.value}</Note> : null)}
        <div class="muted small">
          Обычный шрифт (.ttf/.otf/.woff, например сделанный из вашего почерка в Calligraphr) программа сама переведёт
          в линию по центру штриха — плоттер пишет одной линией, без обводки контура.
        </div>
        <div class="muted small">
          Единственный способ, чтобы конспект выглядел написанным вами: нарисуйте буквы мышью или стилусом, каждую 3–5 раз —
          при печати варианты чередуются. Недостающие символы возьмутся из базового шрифта.
        </div>
        {() =>
          app.customFonts.value.length ? (
            <div class="font-list">
              {app.customFonts.value.map((f) => (
                <span class={() => 'font-item' + (editing.value?.id === f.id ? ' on' : '')}>
                  <button class="chip" onClick={() => { editing.value = structuredClone(f); strokes.value = []; }}>
                    {f.name} · {Object.keys(f.glyphs).length} симв.
                  </button>
                  <button class="chip" title="Писать этим шрифтом" onClick={() => app.typo.patch({ fontId: f.id })}>
                    {() => (app.typo.value.fontId === f.id ? '✓ выбран' : 'выбрать')}
                  </button>
                  <button class="icon-btn" title="Удалить шрифт" onClick={() => { if (confirm(`Удалить шрифт «${f.name}»?`)) { deleteCustomFont(f.id); if (editing.peek()?.id === f.id) editing.value = null; } }}>
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              ))}
            </div>
          ) : null
        }
        <div class="row wrap">
          <Btn small kind="primary" onClick={importFont} disabled={() => !!importBusy.value} title=".ttf, .otf, .woff — любой шрифт; .svg — однолинейный (Hershey Text, EMS); .json — экспорт Plotterm">
            <Icon name="upload" size={14} /> Загрузить шрифт (.ttf .otf .woff)
          </Btn>
          {() => (editing.value ? <Btn small kind="ghost" onClick={exportFont}><Icon name="download" size={14} /> Экспорт</Btn> : null)}
        </div>
        <div class="muted small">
          Проще всего — лист-шаблон: распечатать, написать по букве в клетке своей ручкой, сфотографировать.
          Каждый заполненный лист добавляет ещё один вариант каждой буквы.
        </div>
        <div class="row wrap">
          <Btn small onClick={downloadTemplate}><Icon name="download" size={14} /> Лист-шаблон А4</Btn>
          <Btn small kind="primary" onClick={importTemplatePhoto} disabled={() => !!importBusy.value} title="JPEG или PNG; лист целиком, четыре чёрные метки по углам должны быть видны">
            <Icon name="upload" size={14} /> Фото заполненного листа
          </Btn>
        </div>
      </Section>
      {() =>
        hasEditing.value ? (
          <Section title={() => `Рисуем: «${editing.value?.name ?? ''}»`}>
            <Segmented small value={() => group.value} onChange={(v) => { group.value = v; ch.value = [...GROUPS[v]][0]; strokes.value = []; }} options={GROUP_NAMES} />
            <div class="char-grid">
              {() =>
                [...GROUPS[group.value]].map((c) => {
                  const n = editing.value?.glyphs[c]?.length ?? 0;
                  return (
                    <button class={() => 'char' + (ch.value === c ? ' on' : '') + (n ? ' has' : '')} onClick={() => { ch.value = c; strokes.value = []; }}>
                      {c}
                      {n ? <sup>{n}</sup> : null}
                    </button>
                  );
                })
              }
            </div>
            <div class="editor-head">
              <span class="big-char">{() => ch.value}</span>
              <span class="muted small">Серый — образец. Рисуйте поверх, буква стоит на базовой линии.</span>
            </div>
            <Editor />
            <div class="row wrap">
              <Btn small onClick={() => (strokes.value = strokes.peek().slice(0, -1))}><Icon name="undo" size={14} /> Штрих</Btn>
              <Btn small onClick={() => (strokes.value = [])}>Очистить</Btn>
              <Btn small kind="primary" onClick={saveVariant}>Сохранить вариант</Btn>
              <Btn small kind="ghost" onClick={nextChar}>Следующая →</Btn>
            </div>
            <div class="variants">
              {() =>
                (editing.value?.glyphs[ch.value] ?? []).map((g, i) => (
                  <span class="variant">
                    {glyphSvg(g)}
                    <button class="icon-btn" title="Удалить вариант" onClick={() => deleteVariant(i)}><Icon name="trash" size={12} /></button>
                  </span>
                ))
              }
            </div>
            <div class="grid2">
              <Field label="Между буквами" hint="единиц (x-высота = 100)">
                <NumInput value={() => editing.value?.letterSpacing ?? 12} onChange={(v) => { const r = editing.peek()!; editing.value = { ...r, letterSpacing: v }; persist(); }} min={-20} max={80} step={1} />
              </Field>
              <Field label="Пробел">
                <NumInput value={() => editing.value?.wordSpacing ?? 45} onChange={(v) => { const r = editing.peek()!; editing.value = { ...r, wordSpacing: v }; persist(); }} min={10} max={200} step={1} />
              </Field>
              <Field label="Базовый шрифт" hint="для недостающих символов">
                <Select value={() => editing.value?.baseFontId ?? 'gost-a'} onChange={(v) => { const r = editing.peek()!; editing.value = { ...r, baseFontId: v }; persist(); }} options={BUILTIN_FONTS.map((f) => ({ value: f.id, label: f.name }))} />
              </Field>
            </div>
            {() => {
              const r = editing.value!;
              const need = [...(GROUPS.lower + GROUPS.upper)].filter((c) => !(r.glyphs[c]?.length));
              return need.length ? (
                <Note kind="info">Ещё не нарисовано: {need.length} букв. Их возьмёт базовый шрифт — смешение стилей будет заметно.</Note>
              ) : (
                <Note kind="ok">Все русские буквы нарисованы.</Note>
              );
            }}
          </Section>
        ) : null
      }
    </div>
  );
}
