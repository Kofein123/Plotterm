import { h } from '../dom.ts';
import { app } from '../../app/state.ts';
import { SPEED_PROFILES, feedOf } from '../../core/types.ts';
import { Btn, Field, NumInput, Note, Section, Segmented, Toggle, bind } from '../components.tsx';
import { measurePenLift, printPattern, writeSetting } from '../../app/actions.ts';
import { fmtTime } from '../../app/notify.ts';

/** Куда уходит время текущей страницы: письмо / подъёмы ручки / переезды. */
function TimeBreakdown() {
  return (
    <div>
      {() => {
        const p = app.previewPlan.value;
        if (!p || !p.estSeconds) return <div class="muted small">Нет задания.</div>;
        const parts: [string, number, string][] = [
          ['письмо', p.timeDraw ?? 0, 'var(--primary)'],
          ['подъёмы ручки', p.timePen ?? 0, 'var(--accent)'],
          ['переезды', p.timeTravel ?? 0, 'var(--travel)'],
        ];
        const sum = parts.reduce((a, x) => a + x[1], 0) || 1;
        return (
          <div class="tbreak">
            <div class="tbreak-bar">
              {parts.map(([, v, c]) => <span style={`width:${((v / sum) * 100).toFixed(1)}%;background:${c}`} />)}
            </div>
            <div class="tbreak-legend">
              {parts.map(([n, v, c]) => (
                <span><i style={`background:${c}`} />{n} {fmtTime(v)} ({Math.round((v / sum) * 100)}%)</span>
              ))}
            </div>
            <div class="muted small">Страница ≈ {fmtTime(p.estSeconds)}, подъёмов ручки: {p.penLifts}.</div>
          </div>
        );
      }}
    </div>
  );
}

export function PenTab() {
  const s = app.speed;
  const pen = app.pen;
  return (
    <div class="tab">
      <Section title="Скорость письма">
        <div class="speed-cards">
          {(['turbo', 'draft', 'normal', 'neat'] as const).map((k) => (
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
      <Section title="Быстрее">
        <TimeBreakdown />
        <Field label="Низкий подъём между буквами" hint="внутри строки на короткий переезд ручка поднимается невысоко — это главный выигрыш по времени; 0 — выкл.">
          <NumInput value={bind(pen, 'hopLift').get} onChange={(v) => pen.patch({ hopLift: v === 0 ? 0 : Math.max(0.3, v) })} min={0} max={5} step={0.1} unit="мм" />
        </Field>
        <Field label="Короткий переезд — до">
          <NumInput value={bind(pen, 'hopDistance').get} onChange={bind(pen, 'hopDistance').set} min={0} max={50} step={1} unit="мм" />
        </Field>
        <Toggle value={bind(pen, 'zDownRapid').get} onChange={bind(pen, 'zDownRapid').set} label="Опускать ручку на полной скорости (G0)" hint="Быстрее, но ручка сильнее стукает; на пружине обычно нормально" />
        {() => {
          const m = app.machine;
          const j = m.settings.value.get(11);
          const jv = j === undefined ? NaN : parseFloat(j);
          return Number.isFinite(jv) && jv < 0.04 ? (
            <Note kind="info">
              Повороты: у платы $11 = {jv} мм — на каждом изгибе буквы она почти останавливается. Значение 0,05 заметно ускоряет
              письмо без потери точности для ручки.{' '}
              <Btn small kind="primary" onClick={() => writeSetting(11, '0.050')}>Записать $11=0.05</Btn>
            </Note>
          ) : null;
        }}
        <div class="muted small">
          Проверка: «Напечатать полосу скоростей» выше и «Пробный абзац» на вкладке «Калибровка». Если буквы рвутся или
          ручка пропускает линию — сбавьте скорость или включите обычное опускание.
        </div>
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
