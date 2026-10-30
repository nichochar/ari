type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const previewIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Preview sessions share an origin while keeping drafts and navigation separate. */
export function createScopedStorage(storage: StorageAccess | (() => StorageAccess), search = ''): StorageAccess {
  const previewId = new URLSearchParams(search).get('onboardingPreview');
  const prefix = previewId && previewIdPattern.test(previewId) ? `ari:preview:${previewId.toLowerCase()}:` : '';
  const cached = new Map<string, string | null>();
  const pending = new Set<string>();
  const access = () => typeof storage === 'function' ? storage() : storage;
  return {
    getItem(key) {
      if (pending.has(key)) return cached.get(key) ?? null;
      try {
        const value = access().getItem(prefix + key);
        cached.set(key, value);
        return value;
      } catch { return cached.get(key) ?? null; }
    },
    setItem(key, value) {
      cached.set(key, value);
      try { access().setItem(prefix + key, value); pending.delete(key); }
      catch { pending.add(key); }
    },
    removeItem(key) {
      cached.set(key, null);
      try { access().removeItem(prefix + key); pending.delete(key); }
      catch { pending.add(key); }
    },
  };
}

// Resolve lazily so blocked browser storage and isolated Node tests stay usable.
const scopes = new Map<string, StorageAccess>();
function currentStorage() {
  const search = typeof window === 'undefined' ? '' : window.location.search;
  let storage = scopes.get(search);
  if (!storage) {
    storage = createScopedStorage(() => window.localStorage, search);
    scopes.set(search, storage);
  }
  return storage;
}
export const appStorage: StorageAccess = {
  getItem: key => currentStorage().getItem(key),
  setItem: (key, value) => currentStorage().setItem(key, value),
  removeItem: key => currentStorage().removeItem(key),
};
