// Правая панель: подключение, ПЕЧАТЬ / Пауза / СТОП, прогресс, скорость на ходу, ручное управление.
import { h } from './dom.ts';
import { signal } from './reactive.ts';
import { app } from '../app/state.ts';
import {
  connectSerial, connectSimulator, disconnect, hasWebSerial, startPrint, printBlockers, resumeJob, unlock, traceJob, type PrintRange,
} from '../app/actions.ts';
import { Btn, Icon, Segmented, Toggle, Slider } from './components.tsx';
import { Jog } from './Jog.tsx';
import { fmtTime } from '../app/notify.ts';

const range = signal<'all' | 'current' | 'from' | 'lines'>('all');
const fromPage = signal(1);
const lineFrom = signal(1);
const lineTo = signal(1);
// номера строк показываем в предпросмотре, пока выбран режим «Строки»
const syncLines = () => (app.printLines.value = range.peek() === 'lines' ? [lineFrom.peek(), Math.max(lineFrom.peek(), lineTo.peek())] : null);
const ovTarget = signal(100);
let ovTimer: ReturnType<typeof setTimeout> | undefined;

function rangeValue(): PrintRange {
  const r = range.peek();
  if (r === 'from') return { kind: 'from', page: Math.max(0, fromPage.peek() - 1) };
  if (r === 'lines') return { kind: 'lines', from: lineFrom.peek(), to: Math.max(lineFrom.peek(), lineTo.peek()) };
  return { kind: r };
}

function Connection() {
  const m = app.machine;
  return (
    <div class="card conn">
      {() =>
        m.conn.value === 'connected' ? (
          <div class="conn-row">
            <span class="conn-dot on" />
            <span class="conn-label">
              {() => m.transportLabel.value}
              <small>{() => (m.version.value ? 'GRBL ' + m.version.value : '')}</small>
            </span>
            <Btn small kind="ghost" onClick={() => disconnect()}>Отключить</Btn>
          </div>
        ) : m.conn.value === 'connecting' ? (
          <div class="conn-row"><span class="conn-dot wait" /> Подключение…</div>
        ) : (
          <div class="conn-actions">
            <Btn kind="primary" class="btn-block" onClick={() => connectSerial()} disabled={() => !hasWebSerial()} title="USB (CH340) или Bluetooth COM-порт">
              <Icon name="plug" /> Подключить плоттер
            </Btn>
            <Btn kind="ghost" small onClick={() => connectSimulator()} title="Виртуальная плата: проверить всё без железа">
              <Icon name="sim" size={16} /> Симулятор
            </Btn>
            {!hasWebSerial() ? <div class="note note-warn small">Откройте страницу в Google Chrome или Microsoft Edge — только они умеют работать с USB.</div> : null}
          </div>
        )
      }
      {() =>
        m.alarm.value ? (
          <div class="alarm">
            <Icon name="warn" size={16} />
            <span>{() => m.alarm.value}</span>
            <Btn small kind="danger" onClick={() => unlock()}><Icon name="unlock" size={14} /> Разблокировать</Btn>
          </div>
        ) : null
      }
    </div>
  );
}

function PrintBlock() {
  const job = app.job;
  const blockers = () => printBlockers();
  return (
    <div class="card print">
      <button
        class="print-btn"
        disabled={() => blockers().length > 0}
        title={() => blockers().join('\n')}
        onClick={() => startPrint(rangeValue())}
      >
        <Icon name="print" size={26} />
        <span>
          {() => (app.dryRun.value ? 'СУХОЙ ПРОГОН' : 'ПЕЧАТЬ')}
          <small>
            {() => {
              const n = app.pageCount.value;
              const t = app.totalEstimate.value;
              return n ? `${n} стр. · ≈ ${fmtTime(t)}` : 'нет текста';
            }}
          </small>
        </span>
      </button>
      {() => {
        const b = blockers();
        return b.length ? (
          <ul class="blockers">
            {b.map((x) => <li>{x}</li>)}
          </ul>
        ) : null;
      }}
      <div class="print-opts">
        <Segmented
          small
          value={() => range.value}
          onChange={(v) => { range.value = v; syncLines(); }}
          options={[{ value: 'all', label: 'Все' }, { value: 'current', label: 'Текущую' }, { value: 'from', label: 'С стр.' }, { value: 'lines', label: 'Строки' }]}
        />
        {() =>
          range.value === 'from' ? (
            <input class="mini-num" type="number" min="1" value={() => String(fromPage.value)} onChange={(e: Event) => (fromPage.value = Math.max(1, parseInt((e.target as HTMLInputElement).value) || 1))} />
          ) : range.value === 'lines' ? (
            <span class="row" title="Номера строк видны слева на листе. Печатается только текст этих строк текущей страницы, на своём месте">
              <span class="small">с</span>
              <input class="mini-num" type="number" min="1" value={() => String(lineFrom.value)} onChange={(e: Event) => { lineFrom.value = Math.max(1, parseInt((e.target as HTMLInputElement).value) || 1); syncLines(); }} />
              <span class="small">по</span>
              <input class="mini-num" type="number" min="1" value={() => String(lineTo.value)} onChange={(e: Event) => { lineTo.value = Math.max(1, parseInt((e.target as HTMLInputElement).value) || 1); syncLines(); }} />
            </span>
          ) : null
        }
      </div>
      <div class="print-opts">
        <Toggle value={() => app.dryRun.value} onChange={(v) => (app.dryRun.value = v)} label="Сухой прогон" hint="Пройти всё задание с поднятой ручкой — проверить размещение" />
        <Btn small kind="ghost" onClick={() => traceJob()} disabled={() => app.machine.conn.value !== 'connected' || job.active} title="Обвести рамку задания поднятой ручкой">
          <Icon name="frame" size={14} /> Рамка
        </Btn>
      </div>
    </div>
  );
}

function RunBlock() {
  const job = app.job;
  const st = () => job.status.value;
  return (
    <div class="card run">
      <div class="run-head">
        <b>{() => statusLabel(st())}</b>
        <span class="muted">{() => job.title.value}</span>
      </div>
      <div class="progress"><div class="progress-bar" style={() => `width:${(job.progress.value * 100).toFixed(1)}%`} /></div>
      <div class="run-meta">
        <span>{() => `${Math.round(job.progress.value * 100)}%`}</span>
        <span>{() => {
          const plan = job.plan;
          const k = job.currentStroke.value;
          const line = plan && k >= 0 ? plan.strokeLine[Math.min(k, plan.strokeLine.length - 1)] : 0;
          const pg = job.pages[job.pageIdx.value];
          return pg ? `стр. ${pg.pageNo + 1} (${job.pageIdx.value + 1}/${job.pages.length})${line ? ', строка ' + line : ''}` : '';
        }}</span>
        <span title="прошло / осталось">{() => `${fmtTime(job.elapsed.value)} / ≈${fmtTime(job.eta.value)}`}</span>
      </div>
      {() => (job.message.value ? <div class="run-msg">{job.message.value}</div> : null)}
      <div class="run-btns">
        {() =>
          st() === 'running' ? (
            <Btn onClick={() => job.pause()} title="Пауза после текущего штриха (пробел)"><Icon name="pause" /> Пауза</Btn>
          ) : st() === 'paused' || st() === 'pausing' ? (
            <Btn kind="ok" onClick={() => job.resume()} title="Продолжить (пробел)"><Icon name="play" /> Продолжить</Btn>
          ) : st() === 'sheet' ? (
            <Btn kind="ok" onClick={() => job.nextSheet()}><Icon name="play" /> Лист заменён, дальше</Btn>
          ) : null
        }
        <Btn kind="danger" class="stop-btn" onClick={() => job.stop()} disabled={() => st() === 'stopping'} title="СТОП: остановить, поднять ручку (Esc)">
          <Icon name="stop" /> СТОП
        </Btn>
      </div>
      <div class="ov">
        <span class="muted">Скорость на ходу</span>
        <Slider
          min={50}
          max={150}
          step={10}
          value={() => ovTarget.value}
          onInput={(v) => {
            ovTarget.value = v;
            clearTimeout(ovTimer);
            ovTimer = setTimeout(() => app.machine.setFeedOverride(ovTarget.peek()), 150);
          }}
          format={(v) => v + '%'}
        />
      </div>
    </div>
  );
}

function ResumeBlock() {
  const job = app.job;
  return (
    <div class="card resume">
      <div><b>{() => statusLabel(job.status.value)}</b></div>
      {() => (job.message.value ? <div class="run-msg">{job.message.value}</div> : null)}
      <div class="run-btns">
        {() =>
          job.resumePoint.value && job.status.value !== 'done' ? (
            <Btn kind="primary" onClick={() => resumeJob()} disabled={() => app.machine.conn.value !== 'connected'}>
              <Icon name="play" /> Продолжить с места остановки
            </Btn>
          ) : null
        }
        <Btn kind="ghost" small onClick={() => job.reset()}>Закрыть</Btn>
      </div>
    </div>
  );
}

export function statusLabel(s: string) {
  return ({
    idle: 'Готов', running: 'Печатает', pausing: 'Пауза…', paused: 'Пауза', sheet: 'Смените лист', stopping: 'Остановка…',
    stopped: 'Остановлено', done: 'Готово', error: 'Ошибка', interrupted: 'Связь прервалась',
  } as Record<string, string>)[s] ?? s;
}

export function ControlPanel() {
  const job = app.job;
  return (
    <aside class="right">
      <Connection />
      {() => {
        const s = job.status.value;
        if (s === 'running' || s === 'pausing' || s === 'paused' || s === 'sheet' || s === 'stopping') return <RunBlock />;
        if (s === 'stopped' || s === 'error' || s === 'interrupted' || s === 'done') return [<ResumeBlock />, <PrintBlock />];
        return <PrintBlock />;
      }}
      <div class="card">
        <div class="card-title">Ручное управление</div>
        <Jog />
      </div>
    </aside>
  );
}
