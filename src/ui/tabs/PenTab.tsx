import { h } from '../dom.ts';
import { app } from '../../app/state.ts';
import { SPEED_PROFILES, feedOf } from '../../core/types.ts';
import { Btn, Field, NumInput, Note, Section, Segmented, bind } from '../components.tsx';
import { measurePenLift, printPattern } from '../../app/actions.ts';

export function PenTab() {
  const s = app.speed;
  const pen = app.pen;
  return (
    <div class="tab">
      <Section title="Скорость письма">
        <div class="speed-cards">
          {(['draft', 'normal', 'neat'] as const).map((k) => (
            <button class={() => 'speed-card' + (s.value.profile === k ? ' on' : '')} onClick={() => s.patch({ profile: k })}>
              <b>{SPEED_PROFILES[k].name}</b>
              <span>{SPEED_PROFILES[k].feed} мм/мин</span>
              <small>{SPEED_PROFILES[k].hint}</small>
            </button>
          ))}
          <button class={() => 'speed-card' + (s.value.profile === 'custom' ? ' on' : '')} onClick={() => s.patch({ profile: 'custom' })}>
            <b>Своя</b>
            <span>{() => s.value.customFeed} мм/мин</span>
            <small>подобрать тестом</small>
          </button>
        </div>
        {() =>
          s.value.profile === 'custom' ? (
            <Field label="Скорость письма"><NumInput value={bind(s, 'customFeed').get} onChange={bind(s, 'customFeed').set} min={100} max={12000} step={100} unit="мм/мин" /></Field>
          ) : null
        }
        {() => {
          const lim = app.limits.value.rapid;
          return feedOf(s.value) > lim ? <Note kind="warn">Плата разрешает не больше {lim} мм/мин ($110/$111) — скорость будет ограничена.</Note> : null;
        }}
        <div class="muted small">
          Предел задают механика и ручка: гелевая пишет на скорости, шариковая теряет линию. Напечатайте полосу скоростей и выберите,
          где качество ещё устраивает.
        </div>
        <Btn small onClick={() => printPattern('speed')}>Напечатать полосу скоростей</Btn>
      </Section>
      <Section title="Ручка (ось Z)">
        <Field label="Нажим" hint="на сколько опустить ниже касания; пружина держит ручку">
          <NumInput value={bind(pen, 'pressure').get} onChange={bind(pen, 'pressure').set} min={0} max={3} step={0.05} unit="мм" />
        </Field>
        <Field label="Скорость опускания" hint="мягче — меньше клякс и стука">
          <NumInput value={bind(pen, 'zDownFeed').get} onChange={bind(pen, 'zDownFeed').set} min={50} max={5000} step={50} unit="мм/мин" />
        </Field>
        <Field label="Пауза после опускания" hint="чтобы чернила успели пойти">
          <NumInput value={bind(pen, 'dwellMs').get} onChange={bind(pen, 'dwellMs').set} min={0} max={1000} step={10} unit="мс" />
        </Field>
        <div class="row wrap">
          <Btn small onClick={() => measurePenLift()}>Замерить подъём ручки</Btn>
        </div>
        {() => {
          const c = app.calib.value;
          return c.penSet ? (
            <div class="muted small">Ручка поднята при Z = {c.upZ}, касание при Z = 0. При письме Z = {(c.upZ >= 0 ? -1 : 1) * pen.value.pressure}.</div>
          ) : (
            <Note kind="warn">Положение ручки ещё не настроено: вкладка «Калибровка», шаг 1.</Note>
          );
        }}
      </Section>
      <Section title="Оптимизация">
        <Field label="Холостой ход" hint="0 — максимальная скорость платы (G0)">
          <NumInput value={bind(s, 'travelFeed').get} onChange={bind(s, 'travelFeed').set} min={0} max={12000} step={500} unit="мм/мин" />
        </Field>
        <Field label="Не поднимать ручку, если зазор меньше" hint="соседние штрихи пишутся одним движением">
          <NumInput value={bind(s, 'joinTolerance').get} onChange={bind(s, 'joinTolerance').set} min={0} max={1} step={0.05} unit="мм" />
        </Field>
        <Field label="Упрощение линий" hint="меньше мелких отрезков — плата не тормозит">
          <NumInput value={bind(s, 'simplify').get} onChange={bind(s, 'simplify').set} min={0} max={0.3} step={0.01} unit="мм" />
        </Field>
        <Field label="После печати">
          <Segmented value={bind(s, 'park').get} onChange={bind(s, 'park').set} options={[{ value: 'zero', label: 'В угол (ноль)' }, { value: 'away', label: 'Вниз листа' }, { value: 'none', label: 'Остаться' }]} />
        </Field>
      </Section>
    </div>
  );
}
