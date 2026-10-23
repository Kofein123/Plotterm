// Небольшая обёртка над IndexedDB: хранилище «ключ → значение» по коллекциям.
const DB_NAME = 'plotterm';
const STORES = ['fonts', 'kv'];
let dbp = null;
function db() {
    if (!dbp) {
        dbp = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                for (const s of STORES)
                    if (!req.result.objectStoreNames.contains(s))
                        req.result.createObjectStore(s);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return dbp;
}
function tx(store, mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}
export const idb = {
    get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
    set: (store, key, value) => tx(store, 'readwrite', (s) => s.put(value, key)),
    del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
    all: (store) => tx(store, 'readonly', (s) => s.getAll()),
};
