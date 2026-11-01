import { h } from '../dom.ts';
import { app, PAPER_PRESETS } from '../../app/state.ts';
import { Btn, Field, NumInput, Note, Section, Segmented, Toggle, bind } from '../components.tsx';
import { syncPaperToFrame, traceMargins } from '../../app/actions.ts';
import type { PaperTemplate } from '../../core/types.ts';

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
              <Field label="Строка через" hint="клеток между строками">
                <Segmented value={bind(p, 'gridLineCells').get} onChange={bind(p, 'gridLineCells').set} options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
              </Field>
            </div>
          ) : tpl() === 'ruled' ? (
            <Field label="Шаг линеек"><NumInput value={bind(p, 'rulePitch').get} onChange={bind(p, 'rulePitch').set} min={4} max={20} step={0.1} unit="мм" /></Field>
          ) : (
            <Field label="Межстрочный шаг"><NumInput value={bind(p, 'blankLineStep').get} onChange={bind(p, 'blankLineStep').set} min={3} max={30} step={0.5} unit="мм" /></Field>
          )
        }
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
        <Field label="Страница тетради" hint="на левой странице поля зеркалятся">
          <Segmented value={bind(p, 'side').get} onChange={bind(p, 'side').set} options={[{ value: 'right', label: 'Правая' }, { value: 'left', label: 'Левая' }, { value: 'alternate', label: 'Чередовать' }]} />
        </Field>
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
