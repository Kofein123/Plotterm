// Маленькая реактивная система (сигналы + эффекты) без внешних зависимостей.

type Cleanup = () => void;

interface Owner {
  children: Computation[];
  cleanups: Cleanup[];
}

class Computation implements Owner {
  fn: () => void;
  deps = new Set<Signal<unknown>>();
  children: Computation[] = [];
  cleanups: Cleanup[] = [];
  disposed = false;
  constructor(fn: () => void) {
    this.fn = fn;
  }
  run() {
    if (this.disposed) return;
    this.clean();
    const prevObs = observer;
    const prevOwner = owner;
    observer = this;
    owner = this;
    try {
      this.fn();
    } finally {
      observer = prevObs;
      owner = prevOwner;
    }
  }
  clean() {
    for (const d of this.deps) d.subs.delete(this);
    this.deps.clear();
    for (const c of this.children) c.dispose();
    this.children = [];
    const cl = this.cleanups;
    this.cleanups = [];
    for (const f of cl) f();
  }
  dispose() {
    if (this.disposed) return;
    this.clean();
    this.disposed = true;
  }
}

let observer: Computation | null = null;
let owner: Owner | null = null;
let batchDepth = 0;
const pending = new Set<Computation>();

function flush() {
  while (pending.size) {
    const list = [...pending];
    pending.clear();
    for (const c of list) c.run();
  }
}

export class Signal<T> {
  private v: T;
  subs = new Set<Computation>();
  equals: (a: T, b: T) => boolean;
  constructor(v: T, equals?: (a: T, b: T) => boolean) {
    this.v = v;
    this.equals = equals ?? Object.is;
  }
  get value(): T {
    if (observer) {
      this.subs.add(observer);
      observer.deps.add(this as Signal<unknown>);
    }
    return this.v;
  }
  set value(nv: T) {
    if (this.equals(this.v, nv)) return;
    this.v = nv;
    this.notify();
  }
  peek(): T {
    return this.v;
  }
  /** изменить объект частично: sig.patch({a: 1}) */
  patch(this: Signal<T & object>, part: Partial<T>) {
    this.value = { ...this.v, ...part } as T & object;
  }
  notify() {
    for (const s of this.subs) pending.add(s);
    if (batchDepth === 0) flush();
  }
}

export function signal<T>(v: T, equals?: (a: T, b: T) => boolean): Signal<T> {
  return new Signal(v, equals);
}

export function effect(fn: () => void | Cleanup): Cleanup {
  const c = new Computation(() => {
    const r = fn();
    if (typeof r === 'function') onCleanup(r);
  });
  if (owner) owner.children.push(c);
  c.run();
  return () => c.dispose();
}

export function computed<T>(fn: () => T): { readonly value: T; peek(): T } {
  const s = new Signal<T>(undefined as T);
  effect(() => {
    s.value = fn();
  });
  return s;
}

export function onCleanup(f: Cleanup) {
  if (owner) owner.cleanups.push(f);
}

export function batch(fn: () => void) {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}

export function untrack<T>(fn: () => T): T {
  const prev = observer;
  observer = null;
  try {
    return fn();
  } finally {
    observer = prev;
  }
}

/** Отдельная область владения: всё, что создано внутри, уничтожается вызовом dispose. */
export function createRoot<T>(fn: (dispose: Cleanup) => T): T {
  const root: Owner = { children: [], cleanups: [] };
  const prevOwner = owner;
  const prevObs = observer;
  owner = root;
  observer = null;
  const dispose = () => {
    for (const c of root.children) c.dispose();
    root.children = [];
    for (const f of root.cleanups) f();
    root.cleanups = [];
  };
  try {
    return fn(dispose);
  } finally {
    owner = prevOwner;
    observer = prevObs;
  }
}

/** Сигнал, сохраняемый в localStorage. */
export function persisted<T>(key: string, initial: T, migrate?: (stored: any) => T): Signal<T> {
  let v = initial;
  try {
    const raw = globalThis.localStorage?.getItem('plotterm:' + key);
    if (raw != null) {
      const parsed = JSON.parse(raw);
      v = migrate
        ? migrate(parsed)
        : isPlainObject(initial) && isPlainObject(parsed)
          ? ({ ...initial, ...parsed } as T)
          : (parsed as T);
    }
  } catch {
    /* повреждённые данные — берём значения по умолчанию */
  }
  const s = signal(v);
  let timer: ReturnType<typeof setTimeout> | undefined;
  createRoot(() =>
    effect(() => {
      const cur = s.value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          globalThis.localStorage?.setItem('plotterm:' + key, JSON.stringify(cur));
        } catch {
          /* хранилище недоступно */
        }
      }, 200);
    }),
  );
  return s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
