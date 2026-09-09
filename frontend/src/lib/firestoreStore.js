// Firestore-backed persistence for per-user app data.
//
// Data model — everything is scoped under the signed-in user's uid so a single
// security rule ("you may only touch your own subtree") covers all of it:
//
//   users/{uid}                     profile { uid, email, name, picture, ... }
//   users/{uid}/sessions/{id}       one chat conversation
//   users/{uid}/spaces/{id}         one project / space
//   users/{uid}/artifacts/{id}      one saved artifact
//   users/{uid}/prefs/app           single doc of small scalar preferences
//
// The app keeps these as plain arrays in React state and re-persists the whole
// array on every change (including on every streamed chunk). Mirroring that
// straight to Firestore would mean thousands of writes per conversation, so
// writes here are debounced and diffed: only documents whose serialised content
// actually changed are written, and ids that disappeared are deleted.
//
// localStorage remains the synchronous cache — it makes reloads instant and
// keeps the app fully usable while offline or signed out. Firestore is the
// durable copy that follows the user across devices.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase.js";

/** Collections that are stored as one document per array item. */
export const LIST_KINDS = ["sessions", "spaces", "artifacts"];

const SYNC_DELAY_MS = 1500;
// Firestore's hard limit is 1 MiB per document; stay clear of it so an
// oversized chat is skipped rather than failing the whole batch.
const MAX_DOC_BYTES = 900_000;
const MAX_BATCH_OPS = 450; // Firestore allows 500 per batch.

const pending = new Map();     // `${uid}:${kind}` -> { timer, uid, kind, list }
const lastSynced = new Map();  // `${uid}:${kind}` -> Map(id -> serialised item)

const keyOf = (uid, kind) => `${uid}:${kind}`;
const listRef = (uid, kind) => collection(db, "users", uid, kind);

const swallow = (err) => {
  if (import.meta.env.DEV) console.warn("[firestore]", err);
};

/**
 * Strip values Firestore rejects (undefined) and anything not worth storing.
 * Functions, symbols and DOM nodes can end up on state objects; JSON round-trip
 * drops them and also gives us the serialised form we diff on.
 */
function serialise(item) {
  try {
    return JSON.stringify(item);
  } catch {
    return null; // circular — skip this item rather than throw
  }
}

/**
 * Write an array to Firestore as one document per item, deleting documents
 * whose ids are no longer present. Only changed items are written.
 */
async function pushList(uid, kind, list) {
  const k = keyOf(uid, kind);
  const previous = lastSynced.get(k) || new Map();
  const next = new Map();
  const ops = [];

  for (const item of list) {
    const id = item?.id != null ? String(item.id) : null;
    if (!id) continue;
    const json = serialise(item);
    if (json == null) continue;
    if (json.length > MAX_DOC_BYTES) {
      swallow(new Error(`${kind}/${id} is ${json.length} bytes — too large for Firestore, skipped`));
      // Keep the previous serialisation so we do not retry it every sync.
      next.set(id, previous.get(id) ?? json);
      continue;
    }
    next.set(id, json);
    if (previous.get(id) !== json) {
      ops.push({ type: "set", id, data: JSON.parse(json) });
    }
  }

  for (const id of previous.keys()) {
    if (!next.has(id)) ops.push({ type: "delete", id });
  }

  if (!ops.length) {
    lastSynced.set(k, next);
    return;
  }

  for (let i = 0; i < ops.length; i += MAX_BATCH_OPS) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + MAX_BATCH_OPS)) {
      const ref = doc(db, "users", uid, kind, op.id);
      if (op.type === "delete") batch.delete(ref);
      else batch.set(ref, { ...op.data, updatedAt: serverTimestamp() });
    }
    await batch.commit();
  }

  // Only record success — a failed commit must be retried on the next sync.
  lastSynced.set(k, next);
}

/**
 * Queue a list for syncing. Returns immediately; the write lands after a quiet
 * period so a burst of updates (streaming a reply) collapses into one batch.
 */
export function syncList(uid, kind, list) {
  if (!uid || !LIST_KINDS.includes(kind)) return;
  const k = keyOf(uid, kind);
  const existing = pending.get(k);
  if (existing) clearTimeout(existing.timer);
  const snapshot = Array.isArray(list) ? [...list] : [];
  const timer = setTimeout(() => {
    pending.delete(k);
    pushList(uid, kind, snapshot).catch(swallow);
  }, SYNC_DELAY_MS);
  pending.set(k, { timer, uid, kind, list: snapshot });
}

/**
 * Write every queued list now instead of waiting out the debounce. Called on
 * sign-out and when the page is hidden, so the last few seconds of a
 * conversation are not lost when the tab goes away.
 */
export async function flushPending() {
  const queued = [...pending.values()];
  for (const entry of queued) clearTimeout(entry.timer);
  pending.clear();
  await Promise.all(
    queued.map((entry) => pushList(entry.uid, entry.kind, entry.list).catch(swallow))
  );
}

/** Write a list immediately, bypassing the debounce. */
export const syncNow = (uid, kind, list) =>
  uid && LIST_KINDS.includes(kind)
    ? pushList(uid, kind, Array.isArray(list) ? [...list] : []).catch(swallow)
    : Promise.resolve();

/** Small scalar preferences, kept together in one document. */
export async function savePrefs(uid, prefs) {
  if (!uid) return;
  try {
    await setDoc(
      doc(db, "users", uid, "prefs", "app"),
      { ...prefs, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    swallow(err);
  }
}

/** Create/refresh the user profile document on every sign-in. */
export async function upsertUserProfile(user) {
  if (!user?.uid) return;
  try {
    const ref = doc(db, "users", user.uid);
    const existing = await getDoc(ref);
    await setDoc(
      ref,
      {
        uid: user.uid,
        email: user.email || "",
        name: user.displayName || "",
        picture: user.photoURL || "",
        lastLoginAt: serverTimestamp(),
        ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
  } catch (err) {
    swallow(err);
  }
}

/**
 * Load everything for a user. Returns null on failure (offline, rules) so the
 * caller can fall back to its localStorage cache rather than wiping state.
 */
export async function loadUserData(uid) {
  if (!uid) return null;
  try {
    const [sessions, spaces, artifacts, prefsSnap] = await Promise.all([
      ...LIST_KINDS.map((kind) => getDocs(listRef(uid, kind))),
      getDoc(doc(db, "users", uid, "prefs", "app")),
    ]);

    const toArray = (snap) =>
      snap.docs.map((d) => {
        // Drop the server timestamp — it is bookkeeping, not app state, and a
        // Firestore Timestamp object does not survive JSON round-tripping.
        const data = d.data();
        delete data.updatedAt;
        return { ...data, id: d.id };
      });

    const result = {
      sessions: toArray(sessions),
      spaces: toArray(spaces),
      artifacts: toArray(artifacts),
      prefs: prefsSnap.exists() ? prefsSnap.data() : {},
    };

    // Seed the diff cache so the first sync after load does not rewrite
    // every document we just read.
    for (const kind of LIST_KINDS) {
      const map = new Map();
      for (const item of result[kind]) {
        const json = serialise(item);
        if (json != null) map.set(String(item.id), json);
      }
      lastSynced.set(keyOf(uid, kind), map);
    }

    return result;
  } catch (err) {
    swallow(err);
    return null;
  }
}

/** Forget cached diff state — call on sign-out so the next user starts clean. */
export function resetSyncState() {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  lastSynced.clear();
}
