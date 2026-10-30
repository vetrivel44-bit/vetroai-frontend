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

// Per-account copies of chats, spaces, artifacts and memories. All of them are
// mirrored to Firestore, so the copies belonging to *other* accounts that once
// signed in on this browser (and copies keyed by a raw auth token, an old bug)
// can be dropped when space runs out; they reload from Firestore on sign-in.
const ACCOUNT_CACHE_PREFIXES = ["vetroai_sessions_", "vetroai_spaces_", "vetroai_artifacts_", "vetroai_memories_"];
let activeAccountKey = null;

/** Tell the guard whose caches must be kept (the signed-in account's userKey). */
export const setActiveAccountKey = (key) => { activeAccountKey = key ? String(key) : null; };

/** A JWT ("eyJ…" header.payload.signature). Never a valid storage namespace. */
export const looksLikeJwt = (value) => typeof value === "string" && /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(value);

const accountCacheOwner = (key) => {
  const prefix = ACCOUNT_CACHE_PREFIXES.find((p) => key.startsWith(p));
  return prefix ? key.slice(prefix.length) : null;
};

/**
 * Remove other accounts' cached lists (and token-keyed ones), largest first.
 * The account being written (`keepKey`'s owner) and the active account are kept.
 */
export function evictOtherAccounts(storage, keepKey, removeItem, activeKey = activeAccountKey) {
  const keepOwner = accountCacheOwner(String(keepKey || ""));
  const candidates = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key == null || key === keepKey) continue;
    const owner = accountCacheOwner(key);
    if (owner == null) continue;
    const stale = looksLikeJwt(owner) || (activeKey || keepOwner ? owner !== activeKey && owner !== keepOwner : false);
    if (!stale) continue;
    candidates.push({ key, size: (storage.getItem(key) || "").length });
  }
  candidates.sort((a, b) => b.size - a.size);
  for (const { key } of candidates) removeItem.call(storage, key);
  return candidates.map((c) => c.key);
}

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
    try {
      if (evictOtherAccounts(this, String(key), rawRemoveItem).length) {
        return rawSetItem.call(this, key, value);
      }
    } catch (err) {
      if (!isQuotaError(err)) throw err;
    }
    console.warn(`[storage] quota exceeded; skipped saving "${key}" locally`);
  };
  Object.defineProperty(proto, "__vetroQuotaGuard", { value: true });

  // Caches keyed by a raw auth token are always junk; clear them on startup.
  try {
    const store = typeof localStorage !== "undefined" ? localStorage : null;
    if (store) {
      const junk = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        const owner = key && accountCacheOwner(key);
        if (owner && looksLikeJwt(owner)) junk.push(key);
      }
      junk.forEach((key) => rawRemoveItem.call(store, key));
    }
  } catch { /* storage unavailable */ }
}
