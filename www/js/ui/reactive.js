// Маленькая реактивная система (сигналы + эффекты) без внешних зависимостей.
class Computation {
    fn;
    deps = new Set();
    children = [];
    cleanups = [];
    disposed = false;
    constructor(fn) {
        this.fn = fn;
    }
    run() {
        if (this.disposed)
            return;
        this.clean();
        const prevObs = observer;
        const prevOwner = owner;
        observer = this;
        owner = this;
        try {
            this.fn();
        }
        finally {
            observer = prevObs;
            owner = prevOwner;
        }
    }
    clean() {
        for (const d of this.deps)
            d.subs.delete(this);
        this.deps.clear();
        for (const c of this.children)
            c.dispose();
        this.children = [];
        const cl = this.cleanups;
        this.cleanups = [];
        for (const f of cl)
            f();
    }
    dispose() {
        if (this.disposed)
            return;
        this.clean();
        this.disposed = true;
    }
}
let observer = null;
let owner = null;
let batchDepth = 0;
const pending = new Set();
function flush() {
    while (pending.size) {
        const list = [...pending];
        pending.clear();
        for (const c of list)
            c.run();
    }
}
export class Signal {
    v;
    subs = new Set();
    equals;
    constructor(v, equals) {
        this.v = v;
        this.equals = equals ?? Object.is;
    }
    get value() {
        if (observer) {
            this.subs.add(observer);
            observer.deps.add(this);
        }
        return this.v;
    }
    set value(nv) {
        if (this.equals(this.v, nv))
            return;
        this.v = nv;
        this.notify();
    }
    peek() {
        return this.v;
    }
    /** изменить объект частично: sig.patch({a: 1}) */
    patch(part) {
        this.value = { ...this.v, ...part };
    }
    notify() {
        for (const s of this.subs)
            pending.add(s);
        if (batchDepth === 0)
            flush();
    }
}
export function signal(v, equals) {
    return new Signal(v, equals);
}
export function effect(fn) {
    const c = new Computation(() => {
        const r = fn();
        if (typeof r === 'function')
            onCleanup(r);
    });
    if (owner)
        owner.children.push(c);
    c.run();
    return () => c.dispose();
}
export function computed(fn) {
    const s = new Signal(undefined);
    effect(() => {
        s.value = fn();
    });
    return s;
}
export function onCleanup(f) {
    if (owner)
        owner.cleanups.push(f);
}
export function batch(fn) {
    batchDepth++;
    try {
        fn();
    }
    finally {
        batchDepth--;
        if (batchDepth === 0)
            flush();
    }
}
export function untrack(fn) {
    const prev = observer;
    observer = null;
    try {
        return fn();
    }
    finally {
        observer = prev;
    }
}
/** Отдельная область владения: всё, что создано внутри, уничтожается вызовом dispose. */
export function createRoot(fn) {
    const root = { children: [], cleanups: [] };
    const prevOwner = owner;
    const prevObs = observer;
    owner = root;
    observer = null;
    const dispose = () => {
        for (const c of root.children)
            c.dispose();
        root.children = [];
        for (const f of root.cleanups)
            f();
        root.cleanups = [];
    };
    try {
        return fn(dispose);
    }
    finally {
        owner = prevOwner;
        observer = prevObs;
    }
}
/** Сигнал, сохраняемый в localStorage. */
export function persisted(key, initial, migrate) {
    let v = initial;
    try {
        const raw = globalThis.localStorage?.getItem('plotterm:' + key);
        if (raw != null) {
            const parsed = JSON.parse(raw);
            v = migrate
                ? migrate(parsed)
                : isPlainObject(initial) && isPlainObject(parsed)
                    ? { ...initial, ...parsed }
                    : parsed;
        }
    }
    catch {
        /* повреждённые данные — берём значения по умолчанию */
    }
    const s = signal(v);
    let timer;
    createRoot(() => effect(() => {
        const cur = s.value;
        clearTimeout(timer);
        timer = setTimeout(() => {
            try {
                globalThis.localStorage?.setItem('plotterm:' + key, JSON.stringify(cur));
            }
            catch {
                /* хранилище недоступно */
            }
        }, 200);
    }));
    return s;
}
function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
