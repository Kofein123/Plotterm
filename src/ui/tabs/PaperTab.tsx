import { h } from '../dom.ts';
import { app, PAPER_PRESETS } from '../../app/state.ts';
import { Btn, Field, NumInput, Note, Section, Segmented, Toggle, bind } from '../components.tsx';
import { flipPageSide, syncPaperToFrame, traceMargins } from '../../app/actions.ts';
import type { PaperSettings, PaperTemplate } from '../../core/types.ts';

export function PaperTab() {
  const p = app.paper;
  const tpl = () => p.value.template;
  const choose = (k: PaperTemplate) => {
    if (k === 'custom') p.patch({ template: 'custom' });
    else p.patch(PAPER_PRESETS[k].p);
    // размер — с настоящего листа, если он откалиброван целиком (шаблон меняет только разлиновку и поля)
    const f = app.frame.peek();
    if (f.width >= 100 && f.height >= 100) syncPaperToFrame();
  };
  return (
    <div class="tab">
      <Section title="Бумага">
        <div class="paper-cards">
          {(['a4', 'grid', 'ruled', 'custom'] as PaperTemplate[]).map((k) => (
            <button class={() => 'paper-card' + (tpl() === k ? ' on' : '')} onClick={() => choose(k)}>
              <span class={'paper-thumb thumb-' + k} />
              <b>{k === 'custom' ? 'Свой шаблон' : PAPER_PRESETS[k].name}</b>
              <small>{k === 'custom' ? 'любой размер и шаг' : PAPER_PRESETS[k].hint}</small>
            </button>
          ))}
        </div>
        <div class="grid2">
          <Field label="Ширина"><NumInput value={bind(p, 'width').get} onChange={bind(p, 'width').set} min={20} max={400} unit="мм" /></Field>
          <Field label="Высота"><NumInput value={bind(p, 'height').get} onChange={bind(p, 'height').set} min={20} max={400} unit="мм" /></Field>
        </div>
        <Toggle
          value={() => p.value.autoFit !== false}
          onChange={(v: boolean) => p.patch({ autoFit: v })}
          label="Подгонять текст под лист"
          hint="После шага 3 калибровки буквы, поля и разлиновка меняются вместе с размером листа, чтобы на странице помещалось столько же"
        />
        {() => {
          const f = app.frame.value;
          const pp = p.value;
          if (!f.ready) return <div class="muted small">Пройдите шаги 2–3 калибровки — размер возьмётся с настоящего листа.</div>;
          return Math.abs(pp.width - f.width) > 1 || Math.abs(pp.height - f.height) > 1 ? (
            <Note kind="warn">
              По калибровке лист {f.width.toFixed(1)}×{f.height.toFixed(1)} мм, а здесь {pp.width}×{pp.height}. Поля отсчитываются от краёв листа, поэтому на бумаге текст сдвинется или уйдёт за край.
              {f.width < 100 || f.height < 100 ? ' Похоже, шаг 3 сделан не в углу листа: повторите шаги 2–3 — ноль точно в левом верхнем углу листа, край в правом нижнем.' : ''}
              <div class="row" style="margin-top:6px"><Btn small kind="primary" onClick={() => syncPaperToFrame()}>Взять размер с калибровки</Btn></div>
            </Note>
          ) : (
            <div class="muted small">✓ Размер совпадает с откалиброванным листом.</div>
          );
        }}
      </Section>
      <Section title="Строки">
        {() =>
          tpl() === 'grid' ? (
            <div class="grid2">
              <Field label="Клетка"><NumInput value={bind(p, 'cell').get} onChange={bind(p, 'cell').set} min={2} max={15} step={0.1} unit="мм" /></Field>
              <Field label="Строка через" hint="клеток между строками: 1 — вдвое плотнее и вдвое меньше листов">
                <Segmented value={bind(p, 'gridLineCells').get} onChange={bind(p, 'gridLineCells').set} options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
              </Field>
            </div>
          ) : tpl() === 'ruled' ? (
            <Field label="Шаг линеек"><NumInput value={bind(p, 'rulePitch').get} onChange={bind(p, 'rulePitch').set} min={4} max={20} step={0.1} unit="мм" /></Field>
          ) : (
            <Field label="Межстрочный шаг"><NumInput value={bind(p, 'blankLineStep').get} onChange={bind(p, 'blankLineStep').set} min={3} max={30} step={0.5} unit="мм" /></Field>
          )
        }
        {() => {
          const pg = app.layout.value.pages[0];
          return pg ? (
            <div class="muted small">
              {pg.totalLines} строк на странице, всего {app.pageCount.value} стр. Плотнее — меньший шаг строк, буква поменьше («Почерк» → высота строчной) и выключенная пустая строка между абзацами.
            </div>
          ) : null;
        }}
        {() =>
          tpl() === 'grid' || tpl() === 'ruled' ? (
            <div class="muted small">
              {app.calib.value.gridOrigin
                ? '✓ Линии сетки привязаны (калибровка → «Линия сетки»): буквы встанут на линии.'
                : 'Чтобы буквы стояли точно на линиях, на вкладке «Калибровка» укажите одну линию сетки.'}
            </div>
          ) : null
        }
      </Section>
      <Section title="Поля">
        <div class="grid2">
          <Field label="Сверху"><NumInput value={bind(p, 'marginTop').get} onChange={bind(p, 'marginTop').set} min={0} max={100} unit="мм" /></Field>
          <Field label="Снизу"><NumInput value={bind(p, 'marginBottom').get} onChange={bind(p, 'marginBottom').set} min={0} max={100} unit="мм" /></Field>
          <Field label="Слева"><NumInput value={bind(p, 'marginLeft').get} onChange={bind(p, 'marginLeft').set} min={0} max={100} unit="мм" /></Field>
          <Field label="Справа"><NumInput value={bind(p, 'marginRight').get} onChange={bind(p, 'marginRight').set} min={0} max={100} unit="мм" /></Field>
        </div>
        <Toggle
          value={() => !!p.value.spread}
          onChange={(v: boolean) => {
            const cur = p.peek();
            const f = app.frame.peek();
            // если лист откалиброван, его ширина И ЕСТЬ весь разворот — тогда ничего не удваиваем,
            // просто делим его пополам; иначе ширина задана для одной страницы
            const measured = f.ready && f.width >= 100 && Math.abs(f.width - cur.width) <= 2;
            const width = measured ? cur.width : v ? Math.round(cur.width * 2) : Math.max(50, Math.round(cur.width / 2));
            p.patch({ spread: v, width });
          }}
          label="Тетрадь лежит разворотом (две страницы)"
          hint="Плоттер напишет сначала левую страницу, потом правую, и попросит перевернуть лист только после обеих. Ноль ставьте в левый верхний угол всего разворота, край — в правый нижний"
        />
        {() => {
          const pp = p.value;
          if (!pp.spread) return null;
          const f = app.frame.value;
          const half = (pp.width / 2).toFixed(1);
          if (f.ready && f.height > f.width * 1.1)
            return (
              <Note kind="warn">
                По калибровке лист {f.width.toFixed(1)} × {f.height.toFixed(1)} мм — он выше, чем шире, то есть измерена одна страница, а
                не разворот. Повторите шаг 3: «Здесь край» ставится в правый нижний угол ПРАВОЙ страницы, тогда ширина станет примерно
                вдвое больше высоты страницы.
              </Note>
            );
          return f.ready && Math.abs(f.width - pp.width) > 2 ? (
            <Note kind="warn">
              Ширина разворота в программе {pp.width} мм, а по калибровке лист {f.width.toFixed(1)} мм. Ноль и край должны стоять по углам
              ВСЕГО разворота: ноль — левый верхний угол левой страницы, край — правый нижний угол правой.
              <div class="row" style="margin-top:6px"><Btn small kind="primary" onClick={() => syncPaperToFrame()}>Взять размер с калибровки</Btn></div>
            </Note>
          ) : (
            <div class="muted small">Разворот {pp.width} мм: страница — половина по {half} мм. Чётные страницы пишутся слева, нечётные справа.</div>
          );
        }}
        <Field label="Красная линия (широкое поле)" hint="правая страница тетради — линия справа, левая — слева; «Чередовать» переносит её сама через страницу">
          <Segmented
            value={bind(p, 'side').get}
            onChange={(v: PaperSettings['side']) => {
              // «Нет» — тетрадь без красной линии: поля с обеих сторон одинаковые, по узкому
              if (v !== 'none') return p.patch({ side: v });
              const cur = p.peek();
              // поля одинаковые по узкому, но не впритык к краю: иначе буквы уезжают за лист
              const narrow = Math.max(5, Math.min(cur.marginLeft, cur.marginRight));
              p.patch({ side: v, marginLeft: narrow, marginRight: narrow });
            }}
            options={[{ value: 'right', label: 'Справа' }, { value: 'left', label: 'Слева' }, { value: 'alternate', label: 'Чередовать' }, { value: 'none', label: 'Нет' }]} />
        </Field>
        <div class="row wrap">
          <Btn small kind="ghost" onClick={() => flipPageSide()} title="Перенести широкое поле с красной линией на другую сторону">⇆ Линию на другую сторону</Btn>
          {() => {
            const pp = p.value;
            if (pp.spread) return <span class="muted small">Разворот: красная линия стоит у внешнего края каждой половины.</span>;
            if (pp.side === 'none') return <span class="muted small">Тетрадь без красной линии: поля слева и справа одинаковые, текст идёт во всю ширину.</span>;
            const pi = app.currentPage.value;
            const m = app.layout.value.pages[pi]?.mirrored ?? (pp.side === 'left' || (pp.side === 'alternate' && (pp.leftFirst ? pi % 2 === 0 : pi % 2 === 1)));
            return <span class="muted small">Сейчас на странице {pi + 1} красная линия {m ? 'слева' : 'справа'}.</span>;
          }}
        </div>
        {() =>
          p.value.side === 'alternate' && !p.value.spread ? (
            <Toggle value={() => !!p.value.leftFirst} onChange={(v: boolean) => p.patch({ leftFirst: v })} label="Начать с левой страницы" hint="Если первая страница тетради — левая: линия пойдёт слева, справа, слева…" />
          ) : null
        }
        <div class="row wrap">
          <Btn small kind="ghost" onClick={() => traceMargins()} disabled={() => app.machine.conn.value !== 'connected' || app.job.active} title="Ручка поднята: каретка проедет по границе полей">
            Показать поля на листе
          </Btn>
          <span class="muted small">каретка с поднятой ручкой проедет по границе полей — видно, где будет текст</span>
        </div>
        <Toggle value={bind(p, 'rotate180').get} onChange={bind(p, 'rotate180').set} label="Повернуть на 180° (оборот листа)" hint="Для обратной стороны: лист кладётся развёрнутым, текст печатается вверх ногами относительно станка" />
      </Section>
      <Section title="Дописать на начатой странице">
        <Field label="Начать с строки №" hint="первые строки первой страницы останутся пустыми">
          <NumInput value={bind(p, 'startLine').get} onChange={(v) => p.patch({ startLine: Math.max(1, Math.round(v)) })} min={1} max={200} step={1} />
        </Field>
        {() => {
          const pg = app.layout.value.pages[0];
          return pg ? <div class="muted small">На странице {pg.totalLines} строк.</div> : null;
        }}
      </Section>
    </div>
  );
}
