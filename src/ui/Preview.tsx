// Предпросмотр листа: шаблон бумаги, штрихи, порядок печати, положение пера, границы.
import { h } from './dom.ts';
import { signal, effect, onCleanup } from './reactive.ts';
import { app, textLines } from '../app/state.ts';
import { simInk, printFromStroke } from '../app/actions.ts';
import { workToPaper } from '../core/calibration.ts';
import { polyDist2 } from '../core/geometry.ts';
import type { Plan } from '../core/plan.ts';
import { Btn, Icon } from './components.tsx';
import { fmtTime } from '../app/notify.ts';

const view = signal({ scale: 3, ox: 40, oy: 40 });
let fitted = false;
export const pickMode = signal(false);
export const picked = signal<number | null>(null);

/** План, который сейчас показываем: задание (если идёт) или предпросмотр текущей страницы. */
export function shownPlan(): Plan | null {
  const st = app.job.status.value;
  const jp = app.job.pages[app.job.pageIdx.value];
  if (st !== 'idle' && jp) return jp.plan;
  return app.previewPlan.value;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000';
}

export function Preview() {
  let canvas!: HTMLCanvasElement;
  let wrap!: HTMLDivElement;
  const size = signal({ w: 800, h: 600 });
  let raf = 0;
  let colors: Record<string, string> = {};
  const readColors = () => {
    colors = {
      desk: cssVar('--desk'), paper: cssVar('--paper'), grid: cssVar('--grid'), margin: cssVar('--margin-line'),
      ink: cssVar('--ink'), done: cssVar('--ink-done'), pending: cssVar('--ink-pending'), current: cssVar('--accent'),
      bad: cssVar('--danger'), travel: cssVar('--travel'), frame: cssVar('--ok'), pen: cssVar('--danger'), sim: cssVar('--ink-sim'),
    };
  };

  const fit = () => {
    const p = app.paper.peek();
    const f = app.frame.peek();
    const W = Math.max(p.width, f.ready ? f.width : 0);
    const H = Math.max(p.height, f.ready ? f.height : 0);
    const { w, h: hh } = size.peek();
    // сверху место под панель страниц, снизу — под легенду
    const top = 58, bottom = 48;
    const scale = Math.max(0.5, Math.min((w - 40) / W, (hh - top - bottom) / H));
    view.value = { scale, ox: (w - W * scale) / 2, oy: top + (hh - top - bottom - H * scale) / 2 };
  };

  const draw = () => {
    raf = 0;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const { w, h: hh } = size.peek();
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hh * dpr);
    }
    const { scale, ox, oy } = view.peek();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.desk;
    ctx.fillRect(0, 0, w, hh);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    const px = 1 / scale; // 1 экранный пиксель в мм

    const p = app.paper.peek();
    const f = app.frame.peek();
    const rot = p.rotate180;
    const tu = (u: number) => (rot ? p.width - u : u);
    const tv = (v: number) => (rot ? p.height - v : v);

    // лист
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 12 * px * scale;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = colors.paper;
    ctx.fillRect(0, 0, p.width, p.height);
    ctx.shadowColor = 'transparent';

    // разлиновка
    const layoutPage = app.layout.peek().pages[app.currentPage.peek()];
    const mirrored = layoutPage?.mirrored ?? (p.side === 'left');
    ctx.lineWidth = Math.max(0.12, px);
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    const go = app.calib.peek().gridOrigin;
    if (p.template === 'grid') {
      const c = Math.max(1, p.cell);
      const offU = go ? ((go[0] % c) + c) % c : 0;
      const offV = go ? ((go[1] % c) + c) % c : 0;
      for (let u = offU; u <= p.width; u += c) { ctx.moveTo(tu(u), 0); ctx.lineTo(tu(u), p.height); }
      for (let v = offV; v <= p.height; v += c) { ctx.moveTo(0, tv(v)); ctx.lineTo(p.width, tv(v)); }
    } else if (p.template === 'ruled') {
      const s = Math.max(2, p.rulePitch);
      const off = go ? ((go[1] % s) + s) % s : 0;
      for (let v = off; v <= p.height; v += s) { ctx.moveTo(0, tv(v)); ctx.lineTo(p.width, tv(v)); }
    } else if (layoutPage && app.source.peek().kind === 'text') {
      ctx.setLineDash([1, 2]);
      for (const b of layoutPage.baselines) { ctx.moveTo(tu(p.marginLeft * 0), tv(b)); ctx.lineTo(tu(p.width), tv(b)); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // поля
    ctx.strokeStyle = colors.margin;
    ctx.lineWidth = Math.max(0.2, px * 1.2);
    ctx.beginPath();
    const mL = mirrored ? p.marginRight : p.marginLeft;
    const mR = mirrored ? p.marginLeft : p.marginRight;
    if (p.template !== 'a4') {
      const mu = mirrored ? mL : p.width - mR;
      ctx.moveTo(tu(mu), 0);
      ctx.lineTo(tu(mu), p.height);
    } else {
      ctx.setLineDash([2, 2]);
      ctx.rect(Math.min(tu(mL), tu(p.width - mR)), Math.min(tv(p.marginTop), tv(p.height - p.marginBottom)), p.width - mL - mR, p.height - p.marginTop - p.marginBottom);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // откалиброванная область
    if (f.ready) {
      ctx.strokeStyle = colors.frame;
      ctx.lineWidth = Math.max(0.25, px * 1.5);
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(0, 0, f.width, f.height);
      ctx.setLineDash([]);
    }

    // штрихи
    const plan = shownPlan();
    const job = app.job;
    const jobActive = job.status.peek() !== 'idle' && job.plan === plan;
    const cur = jobActive ? job.currentStroke.peek() : -1;
    const bad = new Set(plan?.outOfBounds ?? []);
    const lw = Math.max(0.3, px * 1.2);
    if (plan) {
      if (app.prefs.peek().showTravel && plan.strokes.length > 1) {
        ctx.strokeStyle = colors.travel;
        ctx.lineWidth = Math.max(0.1, px * 0.8);
        ctx.setLineDash([1.2, 1.2]);
        ctx.beginPath();
        for (let i = 1; i < plan.strokes.length; i++) {
          const a = plan.strokes[i - 1];
          const b = plan.strokes[i];
          ctx.moveTo(a[a.length - 2], a[a.length - 1]);
          ctx.lineTo(b[0], b[1]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // режим «Строки»: номера строк слева, невыбранные строки бледные
      const pl = jobActive ? null : app.printLines.peek();
      const order = textLines(plan.strokeLine.map((line) => ({ line })));
      const chosen = pl ? new Set(order.slice(pl[0] - 1, pl[1])) : null;
      const off = (i: number) => !!chosen && !chosen.has(plan.strokeLine[i]);
      if (pl) {
        const ys = new Map<number, [number, number]>();
        plan.strokes.forEach((st, i) => {
          const l = plan.strokeLine[i];
          if (l <= 0) return;
          const r = ys.get(l) ?? [Infinity, -Infinity];
          for (let j = 1; j < st.length; j += 2) { r[0] = Math.min(r[0], st[j]); r[1] = Math.max(r[1], st[j]); }
          ys.set(l, r);
        });
        ctx.font = `${Math.max(2.6, px * 11)}px sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        order.forEach((l, k) => {
          const r = ys.get(l);
          if (!r) return;
          ctx.fillStyle = chosen!.has(l) ? colors.current : colors.travel;
          ctx.fillText(String(k + 1), Math.max(4, app.paper.peek().marginLeft - 1.5), (r[0] + r[1]) / 2);
        });
      }
      const groups: [string, (i: number) => boolean][] = [
        [colors.travel, (i) => off(i)],
        [jobActive ? colors.pending : colors.ink, (i) => !off(i) && !bad.has(i) && (!jobActive || i > cur)],
        [colors.done, (i) => !bad.has(i) && jobActive && i < cur],
        [colors.current, (i) => !bad.has(i) && jobActive && i === cur],
        [colors.bad, (i) => bad.has(i)],
      ];
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [color, test] of groups) {
        ctx.strokeStyle = color;
        ctx.lineWidth = color === colors.current ? lw * 2 : color === colors.bad ? lw * 1.6 : lw;
        ctx.beginPath();
        plan.strokes.forEach((s, i) => {
          if (!test(i)) return;
          ctx.moveTo(s[0], s[1]);
          for (let j = 2; j < s.length; j += 2) ctx.lineTo(s[j], s[j + 1]);
        });
        ctx.stroke();
      }
    }

    // след симулятора
    if (simInk.segs.length && app.machine.conn.peek() === 'connected') {
      ctx.strokeStyle = colors.sim;
      ctx.lineWidth = Math.max(0.35, px * 1.6);
      ctx.beginPath();
      const s = simInk.segs;
      for (let i = 0; i < s.length; i += 4) {
        ctx.moveTo(s[i], s[i + 1]);
        ctx.lineTo(s[i + 2], s[i + 3]);
      }
      ctx.stroke();
    }

    // место продолжения / выбранная точка
    const rp = job.resumePoint.peek();
    const mark = (si: number, color: string) => {
      const s = plan?.strokes[si];
      if (!s) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s[0], s[1], Math.max(1, px * 5), 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lw * 2.4;
      ctx.moveTo(s[0], s[1]);
      for (let j = 2; j < s.length; j += 2) ctx.lineTo(s[j], s[j + 1]);
      ctx.stroke();
    };
    if (rp && job.plan === plan && job.pageIdx.peek() === rp.page) mark(rp.stroke, colors.current);
    const pk = picked.peek();
    if (pk !== null) mark(pk, colors.current);

    // перо
    if (app.machine.conn.peek() === 'connected' && app.calib.peek().zeroSet) {
      const wp = app.machine.wpos.peek();
      const [u, v] = workToPaper(f, wp[0], wp[1]);
      const down = app.isPenDown(wp[2]);
      const r = Math.max(1.2, px * 7);
      ctx.lineWidth = Math.max(0.3, px * 2);
      ctx.strokeStyle = colors.pen;
      ctx.beginPath();
      ctx.arc(u, v, r, 0, Math.PI * 2);
      ctx.moveTo(u - r * 1.8, v);
      ctx.lineTo(u - r * 0.5, v);
      ctx.moveTo(u + r * 0.5, v);
      ctx.lineTo(u + r * 1.8, v);
      ctx.moveTo(u, v - r * 1.8);
      ctx.lineTo(u, v - r * 0.5);
      ctx.moveTo(u, v + r * 0.5);
      ctx.lineTo(u, v + r * 1.8);
      ctx.stroke();
      if (down) {
        ctx.fillStyle = colors.pen;
        ctx.beginPath();
        ctx.arc(u, v, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };

  // перерисовка при изменениях
  effect(() => {
    shownPlan();
    app.printLines.value;
    app.job.currentStroke.value;
    app.job.resumePoint.value;
    app.machine.wpos.value;
    app.machine.conn.value;
    simInk.version.value;
    app.paper.value;
    app.calib.value;
    app.prefs.value;
    app.layout.value;
    app.currentPage.value;
    picked.value;
    view.value;
    size.value;
    schedule();
  });
  // при смене формата листа — вписать заново
  effect(() => {
    const p = app.paper.value;
    const f = app.frame.value;
    void p.width; void p.height; void f.width; void f.height; void f.ready;
    if (fitted) fit();
  });

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const v = view.peek();
    const k = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.max(0.3, Math.min(80, v.scale * k));
    const kk = scale / v.scale;
    view.value = { scale, ox: mx - (mx - v.ox) * kk, oy: my - (my - v.oy) * kk };
  };

  let drag: { x: number; y: number; ox: number; oy: number; moved: boolean } | null = null;
  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    const v = view.peek();
    drag = { x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) view.value = { ...view.peek(), ox: drag.ox + dx, oy: drag.oy + dy };
  };
  const onUp = (e: PointerEvent) => {
    const d = drag;
    drag = null;
    if (!d || d.moved || !pickMode.peek()) return;
    const r = canvas.getBoundingClientRect();
    const v = view.peek();
    const u = (e.clientX - r.left - v.ox) / v.scale;
    const vv = (e.clientY - r.top - v.oy) / v.scale;
    const plan = shownPlan();
    if (!plan) return;
    let best = -1;
    let bd = Infinity;
    plan.strokes.forEach((s, i) => {
      const dd = polyDist2(s, u, vv);
      if (dd < bd) { bd = dd; best = i; }
    });
    if (best >= 0 && bd < 25) picked.value = best;
  };

  const mountCanvas = (el: HTMLCanvasElement) => {
    canvas = el;
    readColors();
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      size.value = { w: Math.max(100, r.width), h: Math.max(100, r.height) };
      if (!fitted) {
        fit();
        fitted = true;
      }
    });
    queueMicrotask(() => ro.observe(wrap));
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => { readColors(); schedule(); };
    mq.addEventListener('change', onScheme);
    el.addEventListener('wheel', onWheel, { passive: false });
    onCleanup(() => { ro.disconnect(); mq.removeEventListener('change', onScheme); });
  };

  const pages = () => app.pageCount.value;
  const plan = () => shownPlan();

  return (
    <div class="preview" ref={(el: HTMLDivElement) => (wrap = el)}>
      <canvas
        ref={mountCanvas}
        class={() => (pickMode.value ? 'picking' : '')}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDblClick={() => fit()}
      />
      <div class="preview-top">
        <div class="pager">
          <button class="icon-btn" title="Предыдущая страница" disabled={() => app.currentPage.value <= 0 || app.job.active} onClick={() => (app.currentPage.value = Math.max(0, app.currentPage.peek() - 1))}>
            <Icon name="left" size={16} />
          </button>
          <span class="pager-label">
            {() => (pages() ? `Страница ${Math.min(app.currentPage.value + 1, pages())} из ${pages()}` : 'Пусто')}
          </span>
          <button class="icon-btn" title="Следующая страница" disabled={() => app.currentPage.value >= pages() - 1 || app.job.active} onClick={() => (app.currentPage.value = Math.min(pages() - 1, app.currentPage.peek() + 1))}>
            <Icon name="right" size={16} />
          </button>
        </div>
        <div class="preview-tools">
          <button class={() => 'chip' + (app.prefs.value.showTravel ? ' on' : '')} title="Показать холостые ходы (ручка поднята)" onClick={() => app.prefs.patch({ showTravel: !app.prefs.peek().showTravel })}>
            Холостой ход
          </button>
          <button
            class={() => 'chip' + (pickMode.value ? ' on' : '')}
            title="Выбрать место на листе и допечатать с него (если ручка сбилась или кончилась)"
            onClick={() => {
              pickMode.value = !pickMode.peek();
              if (!pickMode.peek()) picked.value = null;
            }}
          >
            Повторить с…
          </button>
          <button class="icon-btn" title="Вписать лист (двойной щелчок)" onClick={() => fit()}>
            <Icon name="zoom" size={16} />
          </button>
        </div>
      </div>
      {() =>
        pickMode.value ? (
          <div class="pick-bar">
            {() =>
              picked.value === null ? (
                <span>Щёлкните по букве на листе, с которой продолжить печать.</span>
              ) : (
                <span class="row">
                  <span>Выбран штрих {picked.value + 1} (строка {plan()?.strokeLine[picked.value] ?? '—'}).</span>
                  <Btn
                    kind="primary"
                    small
                    disabled={() => app.job.active}
                    onClick={() => {
                      const k = picked.peek();
                      pickMode.value = false;
                      picked.value = null;
                      if (k !== null) printFromStroke(k);
                    }}
                  >
                    Печатать отсюда
                  </Btn>
                </span>
              )
            }
          </div>
        ) : null
      }
      <div class="preview-legend">
        {() => {
          const pl = plan();
          if (!pl) return <span>Нет задания</span>;
          return (
            <span class="legend-items">
              <span title="Штрихов (подъёмов ручки)">↕ {pl.penLifts}</span>
              <span title="Длина линий">✎ {(pl.drawLength / 1000).toFixed(2)} м</span>
              <span title="Оценка времени этой страницы">⏱ {fmtTime(pl.estSeconds)}</span>
              {pl.outOfBounds.length ? <span class="legend-bad">за краем: {pl.outOfBounds.length}</span> : null}
            </span>
          );
        }}
      </div>
    </div>
  );
}
