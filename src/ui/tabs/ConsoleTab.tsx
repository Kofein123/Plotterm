// Журнал и терминал GRBL: свои команды, история, $-настройки с пояснениями.
import { h } from '../dom.ts';
import { signal, effect } from '../reactive.ts';
import { app } from '../../app/state.ts';
import { SETTING_INFO } from '../../grbl/protocol.ts';
import { writeSetting, backupSettings } from '../../app/actions.ts';
import { Btn, Icon, Section, Segmented } from '../components.tsx';
import { downloadText, stamp, toast } from '../../app/notify.ts';

const history: string[] = (() => {
  try { return JSON.parse(localStorage.getItem('plotterm:history') ?? '[]'); } catch { return []; }
})();
let hIdx = history.length;
const view = signal<'log' | 'settings'>('log');

async function run(cmd: string) {
  cmd = cmd.trim();
  if (!cmd) return;
  if (!app.machine.connected) return toast('Нет связи с платой.', 'warn');
  history.push(cmd);
  while (history.length > 50) history.shift();
  hIdx = history.length;
  try { localStorage.setItem('plotterm:history', JSON.stringify(history)); } catch { /* ignore */ }
  if (/^\$\d+=/.test(cmd) && !confirm(`Изменить настройку платы ${cmd}? Перед этим лучше сохранить копию ($$).`)) return;
  if (cmd === '?' || cmd === '!' || cmd === '~') {
    await app.machine.realtime(cmd);
    return;
  }
  try {
    await app.machine.send(cmd);
    if (/^\$\d+=/.test(cmd)) app.machine.refreshSettings();
  } catch {
    /* ошибка уже в журнале */
  }
}

function LogView() {
  let box!: HTMLDivElement;
  effect(() => {
    app.machine.log.value;
    requestAnimationFrame(() => box && (box.scrollTop = box.scrollHeight));
  });
  return (
    <div class="log" ref={(el: HTMLDivElement) => (box = el)}>
      {() =>
        app.machine.log.value.slice(-300).map((e) => (
          <div class={'log-line log-' + e.dir}>
            <span class="log-dir">{e.dir === 'tx' ? '→' : e.dir === 'rx' ? '←' : e.dir === 'err' ? '!' : '·'}</span>
            <span>{e.text}</span>
          </div>
        ))
      }
    </div>
  );
}

function SettingsView() {
  return (
    <div class="settings-table">
      {() => {
        const map = app.machine.settings.value;
        if (!map.size) return <div class="muted small">Подключитесь — настройки прочитаются командой $$.</div>;
        return [...map.entries()].map(([k, v]) => {
          const info = typeof k === 'number' ? SETTING_INFO[k] : undefined;
          return (
            <div class={'set-row' + (info?.danger ? ' danger' : '')}>
              <code>${String(k)}</code>
              <input
                value={v}
                onChange={(e: Event) => {
                  const nv = (e.target as HTMLInputElement).value.trim();
                  if (nv !== v) writeSetting(k, nv);
                }}
              />
              <span class="set-name">{info ? `${info.name}${info.unit ? ', ' + info.unit : ''}` : ''}</span>
            </div>
          );
        });
      }}
    </div>
  );
}

export function ConsoleTab() {
  return (
    <div class="tab tab-console">
      <Section
        title="Плата"
        aside={<Segmented small value={() => view.value} onChange={(v) => (view.value = v)} options={[{ value: 'log', label: 'Журнал' }, { value: 'settings', label: 'Настройки $$' }]} />}
      >
        {() => (view.value === 'log' ? <LogView /> : <SettingsView />)}
        {() =>
          view.value === 'log' ? (
            <div>
              <input
                class="console-input"
                placeholder="Команда GRBL, например $$ или G0 X10 — Enter"
                onKeyDown={(e: KeyboardEvent) => {
                  const inp = e.target as HTMLInputElement;
                  if (e.key === 'Enter') { run(inp.value); inp.value = ''; }
                  else if (e.key === 'ArrowUp') { hIdx = Math.max(0, hIdx - 1); inp.value = history[hIdx] ?? ''; e.preventDefault(); }
                  else if (e.key === 'ArrowDown') { hIdx = Math.min(history.length, hIdx + 1); inp.value = history[hIdx] ?? ''; e.preventDefault(); }
                }}
              />
              <div class="row wrap">
                {['$$', '$I', '$G', '$#', '$X', '?'].map((c) => <button class="chip" onClick={() => run(c)}>{c}</button>)}
                <Btn small kind="ghost" onClick={() => downloadText(`plotterm-log_${stamp()}.txt`, app.machine.log.peek().map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.dir} ${e.text}`).join('\n'))}>
                  <Icon name="download" size={14} /> Сохранить журнал
                </Btn>
              </div>
            </div>
          ) : (
            <div class="row wrap">
              <Btn small onClick={() => app.machine.refreshSettings().catch(() => {})}>Перечитать</Btn>
              <Btn small kind="ghost" onClick={() => backupSettings()}><Icon name="download" size={14} /> Копия в файл</Btn>
              <span class="muted small">Красным — настройки, от которых зависит механика. Меняются только с подтверждением.</span>
            </div>
          )
        }
      </Section>
    </div>
  );
}
