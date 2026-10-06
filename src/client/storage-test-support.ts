/** A scoped browser-storage boundary for persistence and failure tests. */
export function withTestStorage(check: (local: Storage, session: Storage) => void): void {
  function memoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
      get length() {
        return values.size;
      },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
      clear: () => {
        values.clear();
      },
    };
  }
  const local = memoryStorage();
  const session = memoryStorage();
  const previousLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousSession = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });
  try {
    check(local, session);
  } finally {
    if (previousLocal) Object.defineProperty(globalThis, "localStorage", previousLocal);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (previousSession) Object.defineProperty(globalThis, "sessionStorage", previousSession);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
}
