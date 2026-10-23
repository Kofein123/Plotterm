import { h, type Child } from '../dom.ts';
import { signal } from '../reactive.ts';
import { app } from '../../app/state.ts';
import {
  calibPenTouch, calibPenUp, calibZero, calibCorner, calibSkew, calibSkewReset, calibGridOrigin, calibResetAll,
  traceSheet, printPattern, writeSetting, backupSettings, penUp, penDown,
} from '../../app/actions.ts';
import { Btn, Field, Icon, NumInput, Note, Section } from '../components.tsx';
import { Jog } from '../Jog.tsx';

function Step(props: { n: number; title: string; done: () => boolean; children?: Child }) {
  return (
    <div class={() => 'step' + (props.done() ? ' done' : '')}>
      <div class="step-num">{() => (props.done() ? <Icon name="check" size={16} /> : String(props.n))}</div>
      <div class="step-body">
        <b>{props.title}</b>
        {props.children}
      </div>
    </div>
  );
}

const measuredX = signal(100);
const measuredY = signal(100);

export function CalibTab() {
  const c = app.calib;
  const conn = () => app.machine.conn.value === 'connected';
  return (
    <div class="tab">
      {() => (!conn() ? <Note kind="warn">Подключите плоттер (или симулятор), чтобы калибровать.</Note> : null)}
      {() =>
        c.value.stale ? (
          <Note kind="warn">Плата перезагружалась или каретку сдвигали — ноль мог сбиться. Повторите шаги 2 и 3 (шаг 1 тоже, если ручку трогали).</Note>
        ) : null
      }
      <Section title="Мастер калибровки — около минуты">
        <div class="muted small">
          У плоттера нет концевиков, поэтому после включения он не знает, где каретка. Покажите ему ручку и лист — и программа не даст
          каретке выйти за край.
        </div>
        <Step n={1} title="Ручка: где касается и где поднята" done={() => c.value.penSet}>
          <div class="muted small">Кнопками Z+/Z− опустите ручку до касания бумаги → «Касается». Потом поднимите на 1–3 мм → «Поднята».</div>
          <div class="row wrap">
            <Btn small kind="primary" disabled={() => !conn()} onClick={() => calibPenTouch()}>Ручка касается</Btn>
            <Btn small kind="primary" disabled={() => !conn()} onClick={() => calibPenUp()}>Ручка поднята</Btn>
          </div>
          <Field label="Нажим после касания" hint="0,3–0,5 мм обычно хватает">
            <NumInput value={() => app.pen.value.pressure} onChange={(v) => app.pen.patch({ pressure: v })} min={0} max={3} step={0.05} unit="мм" />
          </Field>
          {() =>
            c.value.penSet ? (
              <div class="row">
                <Btn small onClick={() => penDown()}>Проверить: опустить</Btn>
                <Btn small onClick={() => penUp()}>поднять</Btn>
              </div>
            ) : null
          }
        </Step>
        <Step n={2} title="Ноль — левый верхний угол листа" done={() => c.value.zeroSet && !c.value.stale}>
          <div class="muted small">Стрелками подведите ручку к левому верхнему углу области письма и нажмите «Здесь ноль».</div>
          <Btn small kind="primary" disabled={() => !conn()} onClick={() => calibZero()}>Здесь ноль</Btn>
        </Step>
        <Step n={3} title="Край — противоположный угол" done={() => c.value.cornerSet && !c.value.stale}>
          <div class="muted small">Отведите каретку в правый нижний угол листа и нажмите «Здесь край». Направление осей программа поймёт сама.</div>
          <Btn small kind="primary" disabled={() => !conn() || !c.value.zeroSet} onClick={() => calibCorner()}>Здесь край</Btn>
          {() => {
            const f = app.frame.value;
            return f.ready ? <div class="ok-text small">Лист {f.width.toFixed(1)} × {f.height.toFixed(1)} мм{f.theta ? `, перекос ${((f.theta * 180) / Math.PI).toFixed(2)}°` : ''}</div> : null;
          }}
        </Step>
        <div class="card-inline">
          <Jog compact />
        </div>
      </Section>

      <Section title="Проверки и дополнения">
        <div class="row wrap">
          <Btn small disabled={() => !app.frame.value.ready} onClick={() => traceSheet()}><Icon name="frame" size={14} /> Обвести лист</Btn>
        </div>
        <Field label="Перекос листа" hint="точка дальше по верхнему краю — текст повернётся под лист" wide>
          <span class="row">
            <Btn small disabled={() => !conn() || !c.value.zeroSet} onClick={() => calibSkew()}>Точка на верхнем крае</Btn>
            {() => (c.value.skewPoint ? <Btn small kind="ghost" onClick={() => calibSkewReset()}>Сбросить</Btn> : null)}
          </span>
        </Field>
        <Field label="Линия сетки / линейки" hint="подведите ручку к любой линии (для клетки — к узлу) — строки встанут на линии" wide>
          <span class="row">
            <Btn small disabled={() => !conn() || !app.frame.value.ready} onClick={() => calibGridOrigin()}>Здесь линия</Btn>
            {() => (c.value.gridOrigin ? <Btn small kind="ghost" onClick={() => c.patch({ gridOrigin: null })}>Сбросить</Btn> : null)}
          </span>
        </Field>
        <Btn small kind="ghost" onClick={() => calibResetAll()}>Сбросить калибровку</Btn>
      </Section>

      <Section title="Тестовые узоры">
        <div class="row wrap">
          <Btn small onClick={() => printPattern('square')}>Квадрат 100 мм</Btn>
          <Btn small onClick={() => printPattern('cross')}>Крест</Btn>
          <Btn small onClick={() => printPattern('grid')}>Сетка</Btn>
          <Btn small onClick={() => printPattern('speed')}>Скорости</Btn>
          <Btn small onClick={() => printPattern('paragraph')}>Пробный абзац</Btn>
        </div>
      </Section>

      <Section title="Масштаб (один раз)">
        <div class="muted small">Напечатайте квадрат 100 мм, измерьте линейкой стороны и введите. Программа предложит новые $100 и $101.</div>
        <div class="grid2">
          <Field label="Измерено по X"><NumInput value={() => measuredX.value} onChange={(v) => (measuredX.value = v)} min={50} max={150} step={0.1} unit="мм" /></Field>
          <Field label="Измерено по Y"><NumInput value={() => measuredY.value} onChange={(v) => (measuredY.value = v)} min={50} max={150} step={0.1} unit="мм" /></Field>
        </div>
        {() => {
          const m = app.machine;
          const sx = m.settingNum(100, 80);
          const sy = m.settingNum(101, 80);
          void m.settings.value;
          const nx = (sx * 100) / measuredX.value;
          const ny = (sy * 100) / measuredY.value;
          const same = Math.abs(measuredX.value - 100) < 0.05 && Math.abs(measuredY.value - 100) < 0.05;
          return same ? (
            <div class="muted small">Сейчас $100 = {sx}, $101 = {sy}.</div>
          ) : (
            <div class="row wrap">
              <span class="small">Новые: $100 = <b>{nx.toFixed(3)}</b>, $101 = <b>{ny.toFixed(3)}</b></span>
              <Btn small kind="primary" disabled={() => !conn()} onClick={async () => { await writeSetting(100, nx.toFixed(3)); await writeSetting(101, ny.toFixed(3)); }}>
                Записать в плату
              </Btn>
            </div>
          );
        }}
        <Btn small kind="ghost" disabled={() => !conn()} onClick={() => backupSettings()}><Icon name="download" size={14} /> Копия настроек $$</Btn>
      </Section>
      <Section title="Концевики">
        <div class="muted small">
          Хоминг выключен ($22=0), поэтому ноль задаётся вручную. В статусе платы {() => (app.machine.pins.value ? `видно Pn:${app.machine.pins.value}` : 'входы концевиков сейчас не активны')}
          — если на плате есть разъёмы X/Y limit, можно поставить микропереключатели и включить «домой» одной кнопкой ($22=1).
        </div>
      </Section>
    </div>
  );
}
