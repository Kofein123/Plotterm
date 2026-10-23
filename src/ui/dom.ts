// JSX → настоящий DOM. Функции в props и children становятся реактивными привязками.
import { effect, createRoot, onCleanup } from './reactive.ts';

export type Child = Node | string | number | boolean | null | undefined | Child[] | (() => Child);
type Props = Record<string, any> | null;

declare global {
  namespace JSX {
    type Element = any;
    interface IntrinsicElements {
      [tag: string]: any;
    }
    interface ElementChildrenAttribute {
      children: {};
    }
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'defs', 'use']);
const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate', 'readOnly', 'multiple']);

export function Fragment(props: { children?: Child[] }): Child {
  return props.children ?? [];
}

export function h(tag: string | ((props: any) => Child), props: Props, ...children: Child[]): any {
  if (typeof tag === 'function') {
    return tag({ ...(props || {}), children });
  }
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) applyProp(el, key, props[key]);
  }
  appendChildren(el, children);
  return el;
}

function applyProp(el: Element, key: string, value: any) {
  if (key === 'children' || value === undefined) return;
  if (key === 'ref') {
    if (typeof value === 'function') value(el);
    return;
  }
  if (key.startsWith('on') && typeof value === 'function') {
    const ev = key.slice(2).toLowerCase();
    el.addEventListener(ev, value);
    return;
  }
  if (typeof value === 'function') {
    effect(() => setProp(el, key, value()));
  } else {
    setProp(el, key, value);
  }
}

function setProp(el: Element, key: string, value: any) {
  if (key === 'class' || key === 'className') {
    if (el instanceof SVGElement) el.setAttribute('class', value ?? '');
    else (el as HTMLElement).className = value ?? '';
    return;
  }
  if (key === 'classList') {
    for (const [cls, on] of Object.entries(value as Record<string, boolean>)) el.classList.toggle(cls, !!on);
    return;
  }
  if (key === 'style') {
    if (typeof value === 'string') (el as HTMLElement).style.cssText = value;
    else if (value) {
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith('--')) (el as HTMLElement).style.setProperty(k, String(v));
        else ((el as HTMLElement).style as any)[k] = v;
      }
    }
    return;
  }
  if (PROP_KEYS.has(key)) {
    const cur = (el as any)[key];
    if (key === 'value' && document.activeElement === el && String(cur) === String(value)) return;
    if (cur !== value) (el as any)[key] = key === 'value' ? (value ?? '') : value;
    return;
  }
  if (value === false || value === null) el.removeAttribute(key);
  else el.setAttribute(key, value === true ? '' : String(value));
}

function appendChildren(parent: Node, children: Child[]) {
  for (const c of children) insert(parent, c, null);
}

/** Вставить child перед marker. Возвращает вставленные узлы. */
function insert(parent: Node, child: Child, marker: Node | null): Node[] {
  if (child === null || child === undefined || child === false || child === true) return [];
  if (Array.isArray(child)) {
    const out: Node[] = [];
    for (const c of child) out.push(...insert(parent, c, marker));
    return out;
  }
  if (typeof child === 'function') {
    // динамическая область между двумя маркерами; при перерисовке всё между ними заменяется
    const start = document.createComment('');
    const end = document.createComment('');
    parent.insertBefore(start, marker);
    parent.insertBefore(end, marker);
    effect(() => {
      const value = (child as () => Child)();
      const p = end.parentNode!;
      while (start.nextSibling && start.nextSibling !== end) p.removeChild(start.nextSibling);
      const frag = document.createDocumentFragment();
      // дочерние эффекты принадлежат текущему эффекту и уничтожаются при перерисовке
      insert(frag, value, null);
      p.insertBefore(frag, end);
    });
    return [start, end];
  }
  if (child instanceof Node) {
    if (child instanceof DocumentFragment) {
      const nodes = [...child.childNodes];
      parent.insertBefore(child, marker);
      return nodes;
    }
    parent.insertBefore(child, marker);
    return [child];
  }
  const t = document.createTextNode(String(child));
  parent.insertBefore(t, marker);
  return [t];
}

/** Смонтировать компонент в контейнер. */
export function mount(container: Element, fn: () => Child) {
  return createRoot((dispose) => {
    insert(container, fn(), null);
    return dispose;
  });
}

/** Подписка на событие window/document с автоматической отпиской. */
export function listen<K extends keyof WindowEventMap>(
  target: Window | Document | HTMLElement,
  ev: K | string,
  fn: (e: any) => void,
  opts?: AddEventListenerOptions,
) {
  target.addEventListener(ev, fn, opts);
  onCleanup(() => target.removeEventListener(ev, fn, opts));
}
