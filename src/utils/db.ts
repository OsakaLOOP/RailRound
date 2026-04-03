// src/utils/db.js
const DB_NAME = 'RailLOOPDB';
const DB_VERSION = 1;
const STORE_FILES = 'files';
const STORE_SEGMENTS = 'segments';

interface DB {
  dbPromise: Promise<IDBDatabase> | null;
  open(): Promise<IDBDatabase>;
  get(storeName: string, key: string): Promise<any>;
  set(storeName: string, key: string, value: any): Promise<void>;
  delete(storeName: string, key: string): Promise<void>;
  clear(storeName: string): Promise<void>;
  STORE_FILES: string;
  STORE_SEGMENTS: string;
}

export const db: DB = {
  dbPromise: null,

  open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          db.createObjectStore(STORE_FILES); // key: fileName
        }
        if (!db.objectStoreNames.contains(STORE_SEGMENTS)) {
          db.createObjectStore(STORE_SEGMENTS); // key: lineKey_fromId_toId
        }
      };

      request.onsuccess = (event: any) => {
        resolve(event.target.result);
      };

      request.onerror = (event: any) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
    return this.dbPromise;
  },

  async get(storeName: string, key: string): Promise<any> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async set(storeName: string, key: string, value: any): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async delete(storeName: string, key: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async clear(storeName: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  STORE_FILES,
  STORE_SEGMENTS
};
