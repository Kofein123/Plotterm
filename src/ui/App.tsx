import { h, listen } from './dom.ts';
import { app } from '../app/state.ts';
import { toasts } from '../app/notify.ts';
import { startPrint, jogStep, jogZ, jogContinuousStart, jogContinuousStop } from '../app/actions.ts';
import { Preview } from './Preview.tsx';
import { ControlPanel, statusLabel } from './ControlPanel.tsx';
import { Icon } from './components.tsx';
import { TextTab } from './tabs/TextTab.tsx';
import { FontTab } from './tabs/FontTab.tsx';
import { PaperTab } from './tabs/PaperTab.tsx';
import { PenTab } from './tabs/PenTab.tsx';
import { CalibTab } from './tabs/CalibTab.tsx';
import { HandTab } from './tabs/HandTab.tsx';
import { ConsoleTab } from './tabs/ConsoleTab.tsx';
import { MoreTab } from './tabs/MoreTab.tsx';

const TABS = [
  { id: 'text', label: 'Текст', icon: 'text', view: TextTab },
  { id: 'font', label: 'Шрифт', icon: 'font', view: FontTab },
  { id: 'paper', label: 'Бумага', icon: 'paper', view: PaperTab },
  { id: 'pen', label: 'Ручка', icon: 'pen', view: PenTab },
  { id: 'calib', label: 'Калибровка', icon: 'target', view: CalibTab },
  { id: 'hand', label: 'Мой почерк', icon: 'hand', view: HandTab },
  { id: 'console', label: 'Терминал', icon: 'terminal', view: ConsoleTab },
  { id: 'more', label: 'Ещё', icon: 'more', view: MoreTab },
];

function StatusBar() {
  const m = app.machine;
  const stateClass = () => {
    if (m.conn.value !== 'connected') return 'off';
    return ({ Idle: 'idle', Run: 'run', Jog: 'run', Hold: 'hold', Alarm: 'alarm', Door: 'alarm' } as Record<string, string>)[m.state.value] ?? 'off';
  };
  const calibText = () => {
    const c = app.calib.value;
    if (c.stale) return { cls: 'warn', text: 'Ноль мог сбиться' };
    if (c.penSet && c.zeroSet && c.cornerSet) return { cls: 'ok', text: 'Откалибровано' };
    return { cls: 'warn', text: 'Нужна калибровка' };
  };
  return (
    <header class="topbar">
      <div class="brand">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="3" y="5" width="26" height="22" rx="3" fill="none" stroke="currentColor" stroke-width="2" />
          <path d="M8 20c3-6 5-8 7-3s4 3 6-2 3-4 3-4" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" />
        </svg>
        <span>Plotterm</span>
      </div>
      <span class={() => 'pill state-' + stateClass()}>
        <span class="dot" />
        {() => (m.conn.value === 'connected' ? stateRu(m.state.value) : m.conn.value === 'connecting' ? 'Подключение…' : 'Не подключено')}
      </span>
      <button class={() => 'pill calib-' + calibText().cls} onClick={() => app.prefs.patch({ leftTab: 'calib' })} title="Открыть калибровку">
        {() => calibText().text}
      </button>
      {() => {
        const s = app.job.status.value;
        return s !== 'idle' ? <span class="pill job">{statusLabel(s)}</span> : null;
      }}
      <span class="spacer" />
      {() =>
        m.conn.value === 'connected' ? (
          <span class="topbar-pos">
            <span>X <b>{() => m.wpos.value[0].toFixed(1)}</b></span>
            <span>Y <b>{() => m.wpos.value[1].toFixed(1)}</b></span>
            <span>Z <b>{() => m.wpos.value[2].toFixed(2)}</b></span>
            <span>F <b>{() => Math.round(m.feedRate.value)}</b></span>
          </span>
        ) : null
      }
    </header>
  );
}

function stateRu(s: string) {
  return ({ Idle: 'Ожидание', Run: 'Работа', Hold: 'Пауза', Jog: 'Перемещение', Alarm: 'ALARM', Door: 'Дверь', Check: 'Проверка', Home: 'Хоминг', Sleep: 'Сон' } as Record<string, string>)[s] ?? '…';
}

function LeftPanel() {
  const tab = () => app.prefs.value.leftTab;
  return (
    <aside class="left">
      <nav class="tabs" role="tablist">
        {TABS.map((t) => (
          <button role="tab" class={() => 'tab-btn' + (tab() === t.id ? ' on' : '')} aria-selected={() => String(tab() === t.id)} onClick={() => app.prefs.patch({ leftTab: t.id })} title={t.label}>
            <Icon name={t.icon} size={18} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div class="tab-scroll">
        {() => {
          const t = TABS.find((x) => x.id === tab()) ?? TABS[0];
          return t.view();
        }}
      </div>
    </aside>
  );
}

function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {() => toasts.value.map((t) => <div class={'toast toast-' + t.kind}>{t.text}</div>)}
    </div>
  );
}

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function hotkeys() {
  const held = new Set<string>();
  const continuous = new Set<string>();
  const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  listen(window, 'keydown', (e: KeyboardEvent) => {
    const job = app.job;
    if (e.key === 'Escape' && app.machine.connected) {
      // СТОП работает всегда, даже из поля ввода
      e.preventDefault();
      job.stop();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      if (!job.active) startPrint({ kind: 'all' });
      return;
    }
    if (isTyping(e)) return;
    if (e.key === ' ') {
      const s = job.status.peek();
      if (s === 'running') { e.preventDefault(); job.pause(); }
      else if (s === 'paused' || s === 'pausing') { e.preventDefault(); job.resume(); }
      else if (s === 'sheet') { e.preventDefault(); job.nextSheet(); }
      return;
    }
    if (dirs[e.key]) {
      e.preventDefault();
      if (e.repeat) return;
      const [du, dv] = dirs[e.key];
      const step = app.prefs.peek().jogStep;
      const key = e.key;
      held.add(key);
      if (step === 0) {
        continuous.add(key);
        jogContinuousStart(du, dv);
      } else {
        jogStep(du * step, dv * step);
        // удержание дольше 0,45 с — непрерывное движение
        setTimeout(() => {
          if (held.has(key)) {
            continuous.add(key);
            jogContinuousStart(du, dv);
          }
        }, 450);
      }
      return;
    }
    if (e.key === 'PageUp') { e.preventDefault(); jogZ(app.prefs.peek().zStep); }
    if (e.key === 'PageDown') { e.preventDefault(); jogZ(-app.prefs.peek().zStep); }
  });
  listen(window, 'keyup', (e: KeyboardEvent) => {
    if (dirs[e.key] && held.has(e.key)) {
      held.delete(e.key);
      if (continuous.delete(e.key)) jogContinuousStop();
    }
  });
  listen(window, 'blur', () => {
    if (continuous.size) jogContinuousStop();
    held.clear();
    continuous.clear();
  });
  listen(window, 'beforeunload', (e: BeforeUnloadEvent) => {
    if (app.job.active) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

export function App() {
  hotkeys();
  return (
    <div class="app">
      <StatusBar />
      <main class="main">
        <LeftPanel />
        <Preview />
        <ControlPanel />
      </main>
      <Toasts />
    </div>
  );
}
