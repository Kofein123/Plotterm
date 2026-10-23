import { h } from '../dom.ts';
import { app } from '../../app/state.ts';
import { Field, NumInput, Section, Segmented, Select, Slider, Toggle, bind, Icon } from '../components.tsx';

export function FontTab() {
  const t = app.typo;
  const fontId = bind(t, 'fontId');
  return (
    <div class="tab">
      <Section title="Шрифт">
        <Field label="Почерк" wide>
          <Select value={fontId.get} onChange={fontId.set} options={() => app.fonts.value.map((f) => ({ value: f.id, label: f.name + (f.builtin ? '' : ' — мой почерк') }))} />
        </Field>
        <div class="muted small">
          Плоттер рисует линией, поэтому нужны однолинейные шрифты. Встроены ГОСТ А и Б (кириллица, латиница, казахские буквы).
          Свой почерк — на вкладке «Мой почерк».
        </div>
        <Field label="Высота строчной буквы" hint="2–6 мм; в тетради обычно 2,5–3,5">
          <Slider min={1.5} max={7} step={0.1} value={bind(t, 'xHeight').get} onInput={bind(t, 'xHeight').set} format={(v) => v.toFixed(1) + ' мм'} />
        </Field>
        <Field label="Наклон">
          <Slider min={-10} max={30} step={1} value={bind(t, 'slant').get} onInput={bind(t, 'slant').set} format={(v) => v + '°'} />
        </Field>
        <Field label="Между буквами">
          <Slider min={0.3} max={2.5} step={0.05} value={bind(t, 'letterSpacing').get} onInput={bind(t, 'letterSpacing').set} format={(v) => '×' + v.toFixed(2)} />
        </Field>
        <Field label="Между словами">
          <Slider min={0.4} max={3} step={0.05} value={bind(t, 'wordSpacing').get} onInput={bind(t, 'wordSpacing').set} format={(v) => '×' + v.toFixed(2)} />
        </Field>
      </Section>
      <Section title="Абзацы">
        <Field label="Выравнивание">
          <Segmented value={bind(t, 'align').get} onChange={bind(t, 'align').set} options={[{ value: 'left', label: 'По левому краю' }, { value: 'justify', label: 'По ширине' }]} />
        </Field>
        <Field label="Красная строка">
          <NumInput value={bind(t, 'indent').get} onChange={bind(t, 'indent').set} min={0} max={40} step={1} unit="мм" />
        </Field>
        <Toggle value={bind(t, 'hyphenate').get} onChange={bind(t, 'hyphenate').set} label="Переносить слова по слогам" />
      </Section>
      <Section title="Живость почерка">
        <Field label="Живость" hint="0 — ровно как по линейке, 10 — заметно «от руки»">
          <Slider min={0} max={10} step={1} value={bind(t, 'liveliness').get} onInput={bind(t, 'liveliness').set} />
        </Field>
        <Field label="Зерно" hint="тот же текст с тем же зерном выглядит одинаково">
          <span class="row">
            <NumInput value={bind(t, 'seed').get} onChange={(v) => t.patch({ seed: Math.round(v) })} min={0} step={1} width={90} />
            <button class="icon-btn" title="Другое зерно" onClick={() => t.patch({ seed: Math.floor(Math.random() * 100000) })}>
              <Icon name="dice" size={16} />
            </button>
          </span>
        </Field>
      </Section>
    </div>
  );
}
