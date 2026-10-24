// localStorage is only ever a cache here (chats, spaces and artifacts are
// mirrored to Firestore), but plenty of call sites write to it without a
// try/catch. Once the ~5 MB quota fills up, the first such write throws
// QuotaExceededError during render and the whole app lands on the error
// screen — and stays there after a reload, because storage is still full.
//
// installStorageGuard() wraps Storage.prototype.setItem so a full quota never
// throws: it first frees disposable caches (largest first) and retries, and if
// the value still does not fit the write is dropped with a warning.

// Caches that can be rebuilt or are nice-to-have. User chats, spaces and
// artifacts are deliberately not listed.
const DISPOSABLE_PREFIXES = [
  "vsj_company_logo_",
  "vetroai_design_history",
  "vetroai_call_assistant_history_",
  "vetroai_cowork_tasks_",
  "vetroai_pg_code_",
  "vsj3_hist",
  "vetroai_scratchpad",
  "vetroai_deleted_",
];

export const isQuotaError = (err) =>
  !!err && (
    err.name === "QuotaExceededError" ||
    err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    err.code === 22 ||
    err.code === 1014
  );

/** Remove disposable cache entries, largest first, skipping `keepKey`. Returns removed keys. */
export function evictDisposable(storage, keepKey, removeItem) {
  const candidates = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key == null || key === keepKey) continue;
    if (!DISPOSABLE_PREFIXES.some((p) => key.startsWith(p))) continue;
    candidates.push({ key, size: (storage.getItem(key) || "").length });
  }
  candidates.sort((a, b) => b.size - a.size);
  for (const { key } of candidates) removeItem.call(storage, key);
  return candidates.map((c) => c.key);
}

export function installStorageGuard(StorageCtor = typeof Storage !== "undefined" ? Storage : null) {
  if (!StorageCtor || StorageCtor.prototype.__vetroQuotaGuard) return;
  const proto = StorageCtor.prototype;
  const rawSetItem = proto.setItem;
  const rawRemoveItem = proto.removeItem;

  proto.setItem = function guardedSetItem(key, value) {
    try {
      return rawSetItem.call(this, key, value);
    } catch (err) {
      if (!isQuotaError(err)) throw err;
    }
    try {
      if (evictDisposable(this, String(key), rawRemoveItem).length) {
        return rawSetItem.call(this, key, value);
      }
    } catch (err) {
      if (!isQuotaError(err)) throw err;
    }
    console.warn(`[storage] quota exceeded; skipped saving "${key}" locally`);
  };
  Object.defineProperty(proto, "__vetroQuotaGuard", { value: true });
}
