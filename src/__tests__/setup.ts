// Test setup — mock browser APIs for node environment
import { vi } from "vitest";

// crypto (for HMAC tests)
if (!globalThis.crypto) {
  const nodeCrypto = await import("node:crypto");
  globalThis.crypto = nodeCrypto.webcrypto as any;
}

// IndexedDB mock (lightweight)
const idbStore = new Map<string, Map<string, any>>();
(globalThis as any).indexedDB = {
  open: (_name: string, _version?: number) => {
    const request: any = {};
    const db: any = {
      objectStoreNames: {
        contains: (name: string) => idbStore.has(name),
        length: idbStore.size,
        item: (i: number) => [...idbStore.keys()][i],
      },
      transaction: (storeName: string, _mode: string) => {
        if (!idbStore.has(storeName)) idbStore.set(storeName, new Map());
        const store = idbStore.get(storeName)!;
        return {
          objectStore: () => ({
            get: (key: string) => {
              const req: any = {};
              Promise.resolve().then(() => {
                if (req.onsuccess) req.onsuccess({ target: { result: store.get(key) } });
              });
              return req;
            },
            put: (value: any, key: string) => {
              store.set(key, value);
              const req: any = {};
              Promise.resolve().then(() => {
                if (req.onsuccess) req.onsuccess();
              });
              return req;
            },
            getAll: () => {
              const req: any = {};
              Promise.resolve().then(() => {
                if (req.onsuccess)
                  req.onsuccess({ target: { result: [...store.values()] } });
              });
              return req;
            },
            openCursor: () => {
              const entries = [...store.entries()];
              let idx = 0;
              const req: any = {};
              const advance = () => {
                if (idx < entries.length) {
                  Promise.resolve().then(() => {
                    req.onsuccess({
                      target: {
                        result: {
                          key: entries[idx][0],
                          value: entries[idx][1],
                          continue: () => {
                            idx++;
                            advance();
                          },
                        },
                      },
                    });
                  });
                } else {
                  Promise.resolve().then(() => {
                    req.onsuccess({ target: { result: null } });
                  });
                }
              };
              Promise.resolve().then(advance);
              return req;
            },
          }),
        };
      },
    };
    Promise.resolve().then(() => request.onsuccess?.({ target: { result: db } }));
    return request;
  },
};

// TextEncoder/TextDecoder
if (!globalThis.TextEncoder) {
  const nodeUtil = await import("node:util");
  (globalThis as any).TextEncoder = nodeUtil.TextEncoder;
}
if (!globalThis.TextDecoder) {
  const nodeUtil = await import("node:util");
  (globalThis as any).TextDecoder = nodeUtil.TextDecoder;
}
