import { h } from '../dom.ts';
import { app, SAMPLE_TEXT, saveImages, type SubjectProfile } from '../../app/state.ts';
import { docxToDocument, missingImages, pdfToDocument } from '../../io/document.ts';
import { vectorize } from '../../io/vectorize.ts';
import { imageFileToGray } from '../../io/image.ts';
import { Btn, Icon, Note, Section } from '../components.tsx';
import { readTextFile, svgToStrokes } from '../../io/importers.ts';
import { pickFile, toast, fmtTime } from '../../app/notify.ts';

async function importText() {
  const f = await pickFile('.pdf,.docx,.txt,.md,.markdown,text/plain,application/pdf');
  if (!f) return;
  const name = f.name.toLowerCase();
  try {
    if (name.endsWith('.pdf') || name.endsWith('.docx')) {
      toast(`Читаю «${f.name}»: текст и рисунки…`, 'info', 4000);
      const buf = await f.arrayBuffer();
      const d = name.endsWith('.pdf') ? await pdfToDocument(buf, (m) => toast(m, 'info', 1500)) : await docxToDocument(buf);
      await saveImages(d.images.map((im) => ({ ...im, id: im.id })));
      app.text.value = d.text;
      app.source.value = { kind: 'text' };
      app.currentPage.value = 0;
      const marked = [...d.text.matchAll(/\(img:[\w-]+ (место|карандаш)\)/g)];
      toast(
        `Загружено: ${f.name} · рисунков ${d.images.length}` +
          (marked.length ? ` (из них ${marked.filter((m) => m[1] === 'место').length} — место под распечатку, ${marked.filter((m) => m[1] === 'карандаш').length} — карандашом)` : '') +
          '. Проверьте текст и страницы в предпросмотре.',
        'ok',
        8000,
      );
      return;
    }
    const t = await readTextFile(f);
    app.text.value = t;
    app.source.value = { kind: 'text' };
    toast(`Загружено: ${f.name}`, 'ok');
  } catch (e: any) {
    toast('Не удалось прочитать файл: ' + (e?.message ?? e), 'err');
  }
}

/** Картинка (фото схемы, скриншот) → линии; в текст вставляется строка-рисунок. */
async function insertPicture(insert: (s: string) => void) {
  const f = await pickFile('image/*');
  if (!f) return;
  try {
    const g = await imageFileToGray(f, 1800);
    const d = vectorize(g);
    if (!d.paths.length) return toast('На картинке не нашлось линий.', 'warn');
    const id = 'r' + Date.now().toString(36);
    await saveImages([{ id, name: f.name, ...d }]);
    insert(`\n![](img:${id} 70%)\n`);
    toast(`Рисунок «${f.name}»: ${d.paths.length} линий. В строке можно поменять ширину (70 %) и добавить «карандаш» или «место».`, 'ok', 8000);
  } catch (e: any) {
    toast('Не удалось открыть картинку: ' + (e?.message ?? e), 'err');
  }
}

export async function importSvg() {
  const f = await pickFile('.svg,image/svg+xml');
  if (!f) return;
  try {
    const p = app.paper.peek();
    const strokes = svgToStrokes(await f.text(), {
      width: 0, left: p.marginLeft, top: p.marginTop,
      maxWidth: p.width - p.marginLeft - p.marginRight, maxHeight: p.height - p.marginTop - p.marginBottom,
    });
    if (!strokes.length) return toast('В SVG не нашлось линий.', 'warn');
    app.source.value = { kind: 'drawing', name: f.name, strokes };
    app.currentPage.value = 0;
    toast(`Рисунок «${f.name}»: ${strokes.length} линий, вписан в поля листа.`, 'ok');
  } catch (e: any) {
    toast('Не удалось открыть SVG: ' + (e?.message ?? e), 'err');
  }
}

export async function importGcode() {
  const f = await pickFile('.gcode,.nc,.ngc,.txt,.tap');
  if (!f) return;
  const lines = (await f.text()).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^%/.test(l));
  app.source.value = { kind: 'gcode', name: f.name, lines };
  app.currentPage.value = 0;
  toast(`G-код «${f.name}»: ${lines.length} строк. Будет отправлен как есть — проверьте предпросмотр.`, 'warn', 8000);
}

function applyProfile(p: SubjectProfile) {
  app.typo.value = { ...p.typo };
  app.paper.value = { ...p.paper };
  app.speed.value = { ...p.speed };
  app.pen.value = { ...p.pen };
  toast(`Профиль «${p.name}» применён.`, 'ok');
}

function saveProfile() {
  const name = prompt('Название профиля (например: «Физика, клетка»):');
  if (!name) return;
  const p: SubjectProfile = { name, typo: { ...app.typo.peek() }, paper: { ...app.paper.peek() }, speed: { ...app.speed.peek() }, pen: { ...app.pen.peek() } };
  app.profiles.value = [...app.profiles.peek().filter((x) => x.name !== name), p];
  toast(`Профиль «${name}» сохранён.`, 'ok');
}

export function TextTab() {
  let ta!: HTMLTextAreaElement;
  const insert = (s: string) => {
    const a = ta.selectionStart, b = ta.selectionEnd;
    const v = ta.value;
    ta.value = v.slice(0, a) + s + v.slice(b);
    ta.selectionStart = ta.selectionEnd = a + s.length;
    app.text.value = ta.value;
    ta.focus();
  };
  return (
    <div class="tab">
      {() =>
        app.source.value.kind !== 'text' ? (
          <Note kind="warn">
            Сейчас на листе {app.source.value.kind === 'drawing' ? 'рисунок' : 'G-код'} «{(app.source.value as any).name}».{' '}
            <a href="#" onClick={(e: Event) => { e.preventDefault(); app.source.value = { kind: 'text' }; }}>Вернуться к тексту</a>
          </Note>
        ) : null
      }
      <Section
        title="Текст конспекта"
        aside={
          <span class="row">
            <Btn small kind="ghost" onClick={() => importText()} title="PDF, Word (.docx), .txt, .md — вместе с рисунками"><Icon name="upload" size={14} /> Файл лекции</Btn>
          </span>
        }
      >
        <textarea
          class="text-input"
          ref={(el: HTMLTextAreaElement) => (ta = el)}
          spellcheck={true}
          lang="ru"
          placeholder="Вставьте или напечатайте текст…"
          value={() => app.text.value}
          onInput={(e: Event) => {
            app.text.value = (e.target as HTMLTextAreaElement).value;
            if (app.source.peek().kind !== 'text') app.source.value = { kind: 'text' };
          }}
        />
        <div class="text-tools">
          <button class="chip" title="Заголовок по центру" onClick={() => insert('# ')}># Заголовок</button>
          <button class="chip" title="Степень" onClick={() => insert('^{}')}>x²</button>
          <button class="chip" title="Индекс" onClick={() => insert('_{}')}>x₁</button>
          <button class="chip" title="Корень" onClick={() => insert('√')}>√</button>
          <button class="chip" title="Подчеркнуть" onClick={() => insert('____')}>подчеркнуть</button>
          <button class="chip" title="Новая страница" onClick={() => insert('\n===\n')}>новая стр.</button>
          <button class="chip" title="Рисунок из фото или картинки: плоттер нарисует его линиями" onClick={() => insertPicture(insert)}>+ рисунок</button>
        </div>
        <div class="text-stats muted">
          {() => {
            const l = app.layout.value;
            const n = l.pages.length;
            return `${l.chars} знаков · ${n} стр. · ≈ ${fmtTime(app.totalEstimate.value)}`;
          }}
        </div>
        {() => {
          const miss = missingImages(app.text.value, app.images.value);
          return miss.length ? <Note kind="warn">Нет рисунков: {miss.join(', ')} — на их месте останется пустое место. Загрузите файл лекции заново на этом устройстве.</Note> : null;
        }}
        <div class="muted small">
          Рисунок — строка <code>![подпись](img:…)</code>: добавьте «50%», чтобы сделать уже, «карандаш» — нарисовать карандашом после текста
          страницы (плоттер попросит сменить ручку), «место» — оставить место под распечатку.
        </div>
        {() =>
          app.layout.value.missingChars.length ? (
            <Note kind="warn">В шрифте нет символов: {app.layout.value.missingChars.join(' ')} — они заменены.</Note>
          ) : null
        }
        <div class="muted small">Орфографию подчёркивает браузер (красная волна) — исправьте до печати, чтобы не тратить лист.</div>
      </Section>
      <Section title="Профили под предмет" aside={<Btn small kind="ghost" onClick={saveProfile}>Сохранить текущие</Btn>}>
        {() =>
          app.profiles.value.length ? (
            <div class="profiles">
              {app.profiles.value.map((p) => (
                <span class="profile">
                  <button class="chip" onClick={() => applyProfile(p)} title="Применить: шрифт, бумага, ручка, скорость">{p.name}</button>
                  <button class="icon-btn" title="Удалить" onClick={() => { if (confirm(`Удалить профиль «${p.name}»?`)) app.profiles.value = app.profiles.peek().filter((x) => x !== p); }}>
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div class="muted small">Сохраните шрифт, бумагу, ручку и скорость одной кнопкой — например «Физика, клетка, 4 мм» — и выбирайте в один клик.</div>
          )
        }
      </Section>
      <Section title="Другое на лист">
        <div class="row wrap">
          <Btn small onClick={() => importSvg()}><Icon name="upload" size={14} /> Рисунок SVG</Btn>
          <Btn small onClick={() => importGcode()}><Icon name="upload" size={14} /> Готовый G-код</Btn>
          <Btn small kind="ghost" onClick={() => { if (confirm('Вернуть пример текста?')) app.text.value = SAMPLE_TEXT; }}>Пример текста</Btn>
        </div>
      </Section>
    </div>
  );
}
