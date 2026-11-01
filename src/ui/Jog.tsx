// Ручное перемещение: XY стрелками, Z (ручка) вверх/вниз, шаг, положение.
import { h } from './dom.ts';
import { app } from '../app/state.ts';
import { jogStep, jogZ, jogContinuousStart, jogContinuousStop, penUp, penDown, goZero, clampJog, calibFlipAxis, calibSwapAxes } from '../app/actions.ts';
import { workToPaper } from '../core/calibration.ts';
import { Icon, Segmented, Toggle } from './components.tsx';

const STEPS = [0.1, 1, 10, 0];

function JogBtn(props: { du: number; dv: number; icon: string; title: string }) {
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let continuous = false;
  const down = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const step = app.prefs.peek().jogStep;
    if (step === 0) {
      continuous = true;
      jogContinuousStart(props.du, props.dv);
      return;
    }
    jogStep(props.du * step, props.dv * step);
    // удержание кнопки > 0,5 с — непрерывное движение
    holdTimer = setTimeout(() => {
      continuous = true;
      jogContinuousStart(props.du, props.dv);
    }, 500);
  };
  const up = () => {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    if (continuous) jogContinuousStop();
    continuous = false;
  };
  return (
    <button class="jog-btn" title={props.title} onPointerDown={down} onPointerUp={up} onPointerCancel={up}>
      <Icon name={props.icon} size={20} />
    </button>
  );
}

export function Jog(props: { compact?: boolean }) {
  const m = app.machine;
  const paperPos = () => {
    const w = m.wpos.value;
    const f = app.frame.value;
    return workToPaper(f, w[0], w[1]);
  };
  return (
    <div class={'jog' + (props.compact ? ' jog-compact' : '')}>
      <div class="jog-grid">
        <span />
        <JogBtn du={0} dv={-1} icon="up" title="Вверх по листу (↑)" />
        <span />
        <JogBtn du={-1} dv={0} icon="left" title="Влево (←)" />
        <button class="jog-btn jog-home" title="К нулю (угол листа), ручка вверх" onClick={() => goZero()}>
          <Icon name="home" size={18} />
        </button>
        <JogBtn du={1} dv={0} icon="right" title="Вправо (→)" />
        <span />
        <JogBtn du={0} dv={1} icon="down" title="Вниз по листу (↓)" />
        <span />
      </div>
      <div class="jog-z">
        <span class="jog-z-label">Z ручки</span>
        <button class="jog-btn" title="Z+ на шаг (PageUp)" onClick={() => jogZ(app.prefs.peek().zStep)}>Z+</button>
        <button class="jog-btn" title="Z− на шаг (PageDown)" onClick={() => jogZ(-app.prefs.peek().zStep)}>Z−</button>
        <Segmented
          small
          value={() => app.prefs.value.zStep}
          onChange={(v) => app.prefs.patch({ zStep: v })}
          options={[{ value: 0.1, label: '0.1' }, { value: 0.5, label: '0.5' }, { value: 2, label: '2' }]}
        />
      </div>
      <div class="jog-pen">
        <button class="btn btn-small" disabled={() => !app.calib.value.penSet} onClick={() => penUp()} title="Поднять ручку в сохранённое положение">Ручка ↑</button>
        <button class="btn btn-small" disabled={() => !app.calib.value.penSet} onClick={() => penDown()} title="Опустить ручку на бумагу с нажимом">Ручка ↓</button>
      </div>
      <div class="jog-step">
        <span class="muted">Шаг XY</span>
        <Segmented
          small
          value={() => app.prefs.value.jogStep}
          onChange={(v) => app.prefs.patch({ jogStep: v })}
          options={STEPS.map((s) => ({ value: s, label: s === 0 ? '∞' : String(s), title: s === 0 ? 'непрерывно, пока держите' : s + ' мм' }))}
        />
      </div>
      <div class="pos">
        <div class="pos-row">
          <span>X</span><b>{() => m.wpos.value[0].toFixed(2)}</b>
          <span>Y</span><b>{() => m.wpos.value[1].toFixed(2)}</b>
          <span>Z</span><b>{() => m.wpos.value[2].toFixed(2)}</b>
        </div>
        {() =>
          app.frame.value.ready ? (
            <div class="pos-paper" title="Положение на листе от левого верхнего угла, мм">
              на листе {() => `${paperPos()[0].toFixed(1)} × ${paperPos()[1].toFixed(1)}`} ·{' '}
              {() => (app.isPenDown(m.wpos.value[2]) ? 'ручка внизу' : 'ручка вверху')}
            </div>
          ) : null
        }
      </div>
      {() =>
        app.calib.value.cornerSet ? (
          <Toggle value={() => clampJog.value} onChange={(v) => (clampJog.value = v)} label="Не выезжать за лист" hint="После калибровки каретка не уйдёт за границы листа" />
        ) : (
          <div class="jog-flip">
            <div class="muted small">
              До калибровки — осторожно у краёв. Каретка поехала не туда, куда стрелка? Если ← → двигают ручку вверх-вниз по тетради —
              «Повернуть оси»; если просто в обратную сторону — переверните ось.
            </div>
            <div class="row wrap">
              <button class="btn btn-small" title="Тетрадь стоит поперёк осей станка" onClick={() => calibSwapAxes()}>↻ Повернуть оси</button>
              <button class="btn btn-small" title="← и → поменяются местами" onClick={() => calibFlipAxis(0)}>⇆ лево/право</button>
              <button class="btn btn-small" title="↑ и ↓ поменяются местами" onClick={() => calibFlipAxis(1)}>⇅ верх/низ</button>
            </div>
          </div>
        )
      }
    </div>
  );
}
