// Single write path for per-user app data.
//
// Every save goes to localStorage synchronously (so reloads are instant and the
// app still works signed out or offline) and is mirrored to Firestore for the
// signed-in user, debounced inside firestoreStore.
import { syncList, savePrefs, recordDeletions, LIST_KINDS } from "./firestoreStore.js";

// Firestore is keyed by uid; localStorage is keyed by email (`userKey`) so that
// existing on-device data survives this migration. Holding the uid in module
// scope keeps the call sites in App.jsx to a single argument-compatible swap.
let currentUid = null;

export const setSyncUid = (uid) => { currentUid = uid || null; };
export const getSyncUid = () => currentUid;

const localKey = (kind, userKey) => `vetroai_${kind}_${userKey}`;

/** Persist one of the list-shaped collections (sessions / spaces / artifacts). */
export function persistList(userKey, kind, list) {
  if (userKey) {
    try {
      localStorage.setItem(localKey(kind, userKey), JSON.stringify(list));
    } catch {
      // Quota exceeded or storage disabled — Firestore below is still the
      // durable copy, so this is not fatal.
    }
  }
  if (currentUid && LIST_KINDS.includes(kind)) syncList(currentUid, kind, list);
}

// ─── deletions ────────────────────────────────────────────────────────────
// Ids the user deleted are remembered ("tombstones") on this device and in
// Firestore, and filtered out whenever lists from two places are merged —
// otherwise a deleted chat still cached on another device came back.
const tombKey = (kind, userKey) => `vetroai_deleted_${kind}_${userKey}`;
const MAX_TOMBSTONES = 5000;

export function readTombstones(userKey, kind) {
  if (!userKey) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(tombKey(kind, userKey)) || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Remember ids locally (union with what is there). Returns the full set. */
export function rememberTombstones(userKey, kind, ids) {
  const merged = [...new Set([...readTombstones(userKey, kind), ...(ids || []).map(String)])].slice(-MAX_TOMBSTONES);
  if (userKey) {
    try { localStorage.setItem(tombKey(kind, userKey), JSON.stringify(merged)); } catch { /* storage full */ }
  }
  return merged;
}

/** Items of `kind` were deleted: remember it here and in the cloud, and remove the cloud copies now. */
export function persistDeletion(userKey, kind, ids) {
  if (!ids?.length) return;
  rememberTombstones(userKey, kind, ids);
  if (currentUid) recordDeletions(currentUid, kind, ids);
}

export { mergeLists } from "./listMerge.js";

/** Read a list back from the local cache. Firestore is loaded separately. */
export function readLocalList(userKey, kind) {
  if (!userKey) return null;
  try {
    const raw = localStorage.getItem(localKey(kind, userKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist a small scalar preference (currently the selected space). */
export function persistPref(userKey, name, value) {
  if (userKey) {
    const key = `vetroai_${name}_${userKey}`;
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch {
      // see persistList
    }
  }
  if (currentUid) savePrefs(currentUid, { [name]: value ?? null });
}
