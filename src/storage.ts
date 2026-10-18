type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const previewIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Preview sessions share an origin while keeping drafts and navigation separate. */
export function createScopedStorage(storage: StorageAccess, search = ''): StorageAccess {
  const previewId = new URLSearchParams(search).get('onboardingPreview');
  const prefix = previewId && previewIdPattern.test(previewId) ? `ari:preview:${previewId.toLowerCase()}:` : '';
  return {
    getItem: key => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: key => storage.removeItem(prefix + key),
  };
}

// Resolve lazily so the helper also works in isolated Node tests without a DOM.
function currentStorage() { return createScopedStorage(window.localStorage, window.location.search); }
export const appStorage: StorageAccess = {
  getItem: key => currentStorage().getItem(key),
  setItem: (key, value) => currentStorage().setItem(key, value),
  removeItem: key => currentStorage().removeItem(key),
};
