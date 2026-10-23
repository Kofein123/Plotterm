import { h } from '../dom.ts';
import { app, loadCustomFonts } from '../../app/state.ts';
import { exportGcode, setSimSpeed } from '../../app/actions.ts';
import { Btn, Field, Icon, Section, Segmented, Toggle, bind } from '../components.tsx';
import { downloadText, fmtTime, pickFile, stamp, toast } from '../../app/notify.ts';
import { idb } from '../../store/db.ts';
import type { CustomFontRecord } from '../../fonts/types.ts';
import { importGcode, importSvg } from './TextTab.tsx';

async function exportAll() {
  const data = {
    app: 'plotterm', version: 1, exportedAt: new Date().toISOString(),
    text: app.text.peek(), typo: app.typo.peek(), paper: app.paper.peek(), pen: app.pen.peek(), speed: app.speed.peek(),
    calib: app.calib.peek(), prefs: app.prefs.peek(), profiles: app.profiles.peek(), stats: app.stats.peek(),
    fonts: app.customFonts.peek(),
  };
  downloadText(`plotterm-settings_${stamp()}.json`, JSON.stringify(data, null, 1), 'application/json');
}

async function importAll() {
  const f = await pickFile('.json');
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'plotterm') throw new Error('это не файл настроек Plotterm');
    if (!confirm('Заменить текущие настройки, профили и шрифты данными из файла?')) return;
    if (d.text !== undefined) app.text.value = d.text;
    if (d.typo) app.typo.value = { ...app.typo.peek(), ...d.typo };
    if (d.paper) app.paper.value = { ...app.paper.peek(), ...d.paper };
    if (d.pen) app.pen.value = { ...app.pen.peek(), ...d.pen };
    if (d.speed) app.speed.value = { ...app.speed.peek(), ...d.speed };
    if (d.calib && confirm('Взять и калибровку из файла? (нужно, только если это тот же плоттер и ноль не сбивался)')) app.calib.value = { ...app.calib.peek(), ...d.calib, stale: true };
    if (d.prefs) app.prefs.value = { ...app.prefs.peek(), ...d.prefs };
    if (Array.isArray(d.profiles)) app.profiles.value = d.profiles;
    if (Array.isArray(d.fonts)) for (const fr of d.fonts as CustomFontRecord[]) await idb.set('fonts', fr.id, fr);
    await loadCustomFonts();
    toast('Настройки загружены.', 'ok');
  } catch (e: any) {
    toast('Не удалось загрузить: ' + (e?.message ?? e), 'err');
  }
}

export function MoreTab() {
  const pr = app.prefs;
  return (
    <div class="tab">
      <Section title="Подключение">
        <Field label="Скорость порта"><Segmented small value={bind(pr, 'baud').get} onChange={bind(pr, 'baud').set} options={[{ value: 115200, label: '115200' }, { value: 250000, label: '250000' }, { value: 57600, label: '57600' }]} /></Field>
        <Toggle value={bind(pr, 'autoReconnect').get} onChange={bind(pr, 'autoReconnect').set} label="Переподключаться сам при обрыве и при открытии страницы" />
        <Toggle value={bind(pr, 'keepSignals').get} onChange={bind(pr, 'keepSignals').set} label="Не трогать DTR/RTS" hint="Включите, если плата перезагружается при каждом подключении или не отвечает" />
        <Field label="Скорость ручного хода"><Segmented small value={bind(pr, 'jogFeed').get} onChange={bind(pr, 'jogFeed').set} options={[1000, 3000, 6000].map((v) => ({ value: v, label: v + ' мм/мин' }))} /></Field>
        <div class="muted small">
          Bluetooth: спарьте «BtWriter» в настройках Bluetooth Windows — появится COM-порт, его можно выбрать в «Подключить плоттер».
        </div>
      </Section>
      <Section title="Симулятор">
        <Field label="Скорость симуляции"><Segmented small value={bind(pr, 'simSpeed').get} onChange={(v) => setSimSpeed(v)} options={[1, 4, 20, 100].map((v) => ({ value: v, label: '×' + v }))} /></Field>
      </Section>
      <Section title="Безопасность">
        <Toggle value={bind(pr, 'allowUncalibrated').get} onChange={bind(pr, 'allowUncalibrated').set} label="Разрешить печать без калибровки (опасно)" hint="Без границ листа каретка может удариться о край" />
        <Toggle value={bind(pr, 'sound').get} onChange={bind(pr, 'sound').set} label="Звук при смене листа и в конце" />
      </Section>
      <Section title="Файлы">
        <div class="row wrap">
          <Btn small onClick={() => exportGcode()}><Icon name="download" size={14} /> Экспорт G-кода</Btn>
          <Btn small onClick={() => importGcode()}><Icon name="upload" size={14} /> Открыть G-код</Btn>
          <Btn small onClick={() => importSvg()}><Icon name="upload" size={14} /> Открыть SVG</Btn>
        </div>
        <div class="row wrap">
          <Btn small kind="ghost" onClick={exportAll}><Icon name="download" size={14} /> Все настройки в файл</Btn>
          <Btn small kind="ghost" onClick={importAll}><Icon name="upload" size={14} /> Загрузить из файла</Btn>
        </div>
      </Section>
      <Section title="Статистика">
        {() => {
          const s = app.stats.value;
          return (
            <div class="stats">
              <span><b>{s.meters.toFixed(1)}</b> м линий</span>
              <span><b>{s.pages}</b> страниц</span>
              <span><b>{fmtTime(s.seconds)}</b> работы</span>
              <span><b>{s.sinceRefill.toFixed(1)}</b> м с последней замены ручки</span>
            </div>
          );
        }}
        <div class="row">
          <Btn small kind="ghost" onClick={() => app.stats.patch({ sinceRefill: 0 })}>Ручку заменил</Btn>
          {() => (app.stats.value.sinceRefill > 150 ? <span class="warn-text small">Гелевого стержня обычно хватает на 150–400 м — проверьте ручку.</span> : null)}
        </div>
      </Section>
      <Section title="Горячие клавиши">
        <div class="keys">
          <span><kbd>Пробел</kbd> пауза / продолжить</span>
          <span><kbd>Esc</kbd> СТОП</span>
          <span><kbd>← → ↑ ↓</kbd> перемещение (удержание — непрерывно)</span>
          <span><kbd>PgUp</kbd> / <kbd>PgDn</kbd> Z+ / Z−</span>
          <span><kbd>Ctrl</kbd>+<kbd>P</kbd> печать</span>
        </div>
      </Section>
      <Section title="О программе">
        <div class="muted small">
          Plotterm — управление рукописным плоттером на GRBL прямо из браузера. Всё считается на вашем компьютере, текст никуда не отправляется.
          Шрифты OpenGOST тип А/Б — SIL Open Font License 1.1. Код — MIT.
        </div>
      </Section>
    </div>
  );
}
