import { DB_NAME, DB_VERSION, S } from './state';
import { recordTombstone, scheduleSyncMutation } from './sync';

export function initDB(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (event: any) => reject('IndexedDB Error: ' + event.target?.errorCode);
        request.onsuccess = (event: any) => { S.db = event.target.result; resolve(S.db); };
        request.onupgradeneeded = (event: any) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains('boards')) {
                database.createObjectStore('boards', { keyPath: 'id' });
            }
            if (!database.objectStoreNames.contains('cards')) {
                const cardStore = database.createObjectStore('cards', { keyPath: 'id' });
                cardStore.createIndex('boardId', 'boardId', { unique: false });
                cardStore.createIndex('isTrash', 'isTrash', { unique: false });
            }
            if (!database.objectStoreNames.contains('assets')) {
                database.createObjectStore('assets', { keyPath: 'id' });
            }
            if (!database.objectStoreNames.contains('connections')) {
                database.createObjectStore('connections', { keyPath: 'id' });
            }
            if (!database.objectStoreNames.contains('kv')) {
                database.createObjectStore('kv', { keyPath: 'id' });
            }
        };
    });
}

export function dbPut(store: string, item: any, skipTouch = false): Promise<any> {
    if (!skipTouch && item && typeof item === 'object' && store !== 'assets') {
        item.updatedAt = Date.now();
    }
    return new Promise<any>((resolve, reject) => {
        const tx = S.db.transaction([store], 'readwrite');
        const req = tx.objectStore(store).put(item);
        req.onsuccess = () => {
            if (!skipTouch) scheduleSyncMutation();
            resolve(req.result);
        };
        req.onerror = (e) => reject(e);
    });
}

export function dbGet(store: string, id: any): Promise<any> {
    return new Promise<any>((resolve, reject) => {
        const tx = S.db.transaction([store], 'readonly');
        const req = tx.objectStore(store).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e);
    });
}

export function dbGetAll(store: string): Promise<any[]> {
    return new Promise<any[]>((resolve, reject) => {
        const tx = S.db.transaction([store], 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e);
    });
}

export function dbDelete(store: string, id: any, skipTouch = false): Promise<void> {
    if (!skipTouch && (store === 'boards' || store === 'cards' || store === 'connections')) {
        recordTombstone(store, id);
    }
    return new Promise<void>((resolve, reject) => {
        const tx = S.db.transaction([store], 'readwrite');
        const req = tx.objectStore(store).delete(id);
        req.onsuccess = () => {
            if (!skipTouch) scheduleSyncMutation();
            resolve();
        };
        req.onerror = (e) => reject(e);
    });
}
