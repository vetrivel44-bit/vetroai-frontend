// Firestore side of Dispatch (see lib/dispatchCore.js for what it is).
//
//   users/{uid}/dispatch/{id}   one request from the phone, and how it went
//   users/{uid}/devices/{id}    a computer that accepts requests, and when it was last seen
//
// Both sit under the user's own uid, so firestore.rules' "only your own
// subtree" covers them; nothing goes through the backend.
import {
  collection, deleteDoc, doc, onSnapshot, orderBy, query, runTransaction, setDoc, updateDoc,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { clipToBytes } from "./dispatchCore.js";

export const dispatchReady = () => db != null;

const DEVICE_KEY = "vetroai_dispatch_device";
/** A stable id for this browser / desktop app, kept across reloads. */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `dev_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "dev_unsaved";
  }
}

const dispatchCol = (uid) => collection(db, "users", uid, "dispatch");
const dispatchDoc = (uid, id) => doc(db, "users", uid, "dispatch", id);
const deviceDoc = (uid, id) => doc(db, "users", uid, "devices", id);

export async function sendDispatch(uid, { text, target = "any", from = "" }) {
  const id = `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(dispatchDoc(uid, id), {
    id,
    text: clipToBytes(String(text).trim()),
    target,
    from,
    status: "queued",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return id;
}

export const updateDispatch = (uid, id, patch) => updateDoc(dispatchDoc(uid, id), { ...patch, updatedAt: Date.now() });
export const removeDispatch = (uid, id) => deleteDoc(dispatchDoc(uid, id));

/**
 * Takes a queued request for this computer. A transaction, so two computers
 * that are both on never run the same request twice.
 */
export async function claimDispatch(uid, id, deviceId) {
  return runTransaction(db, async (tx) => {
    const ref = dispatchDoc(uid, id);
    const snap = await tx.get(ref);
    const d = snap.data();
    if (!snap.exists() || d.status !== "queued" || d.cancelRequested) return null;
    const claimed = { status: "claimed", claimedBy: deviceId, claimedAt: Date.now(), updatedAt: Date.now() };
    tx.update(ref, claimed);
    return { ...d, ...claimed };
  });
}

/** Every request, newest first. Returns the unsubscribe function. */
export function watchDispatches(uid, onChange, onError) {
  const q = query(dispatchCol(uid), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), onError);
}

export function watchDevices(uid, onChange, onError) {
  return onSnapshot(collection(db, "users", uid, "devices"), (snap) => onChange(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), onError);
}

export const heartbeat = (uid, device) => setDoc(deviceDoc(uid, device.id), { ...device, lastSeen: Date.now() }, { merge: true });
export const forgetDevice = (uid, id) => deleteDoc(deviceDoc(uid, id));

/**
 * The phone says it opened this computer's pairing code, so the computer can
 * show "phone connected". A phone never accepts tasks, so it is never online
 * as a computer.
 */
export const announcePhone = (uid, { id, name, pairedWith }) =>
  setDoc(deviceDoc(uid, id), { id, name, kind: "phone", accepting: false, pairedWith, pairedAt: Date.now(), lastSeen: Date.now() }, { merge: true });
