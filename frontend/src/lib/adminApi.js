// Everything the admin page (/admin) reads and changes.
//
// Most of it is plain Firestore, guarded by the admin rules in
// firestore.rules: the browser can only do these things when the signed-in
// account is listed in admins/{uid}. Changing the sign-in account itself
// (disable, sign out everywhere) goes through the server (/api/admin), which
// checks the same thing again.
//
// Every change, and every look at someone's chats, is written to the audit
// log first. If the log entry can't be written, the action doesn't happen.

import {
  addDoc, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit as limitTo,
  orderBy, query, serverTimestamp, setDoc, Timestamp, where,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { resolveApiBase } from "./apiBase";

const PRODUCTION_API_BASE = "https://ai-chatbot-backend-gvvz.onrender.com/api";
const API = resolveApiBase(import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD, PRODUCTION_API_BASE);

const me = () => auth?.currentUser;

export const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

// ── Who is signed in ──────────────────────────────────────────────────────

export async function checkIsAdmin(user = me()) {
  if (!db || !user) return false;
  try {
    return (await getDoc(doc(db, "admins", user.uid))).exists();
  } catch {
    return false;
  }
}

// ── Audit log ─────────────────────────────────────────────────────────────

/** Records an admin action. Throws if it can't, so the action is not taken. */
export async function audit(action, { targetUid = null, targetEmail = null, reason = "", reference = "", details = null } = {}) {
  const user = me();
  await addDoc(collection(db, "audit"), {
    action,
    adminUid: user.uid,
    adminEmail: user.email || "",
    targetUid,
    targetEmail,
    reason: String(reason || "").slice(0, 1000),
    reference: String(reference || "").slice(0, 300),
    details: details ?? null,
    at: serverTimestamp(),
  });
}

export async function loadAudit(max = 150) {
  const snap = await getDocs(query(collection(db, "audit"), orderBy("at", "desc"), limitTo(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ── Overview numbers ──────────────────────────────────────────────────────

export async function loadStats() {
  const users = collection(db, "users");
  const weekAgo = Timestamp.fromDate(new Date(Date.now() - 7 * 864e5));
  const dayAgo = Timestamp.fromDate(new Date(Date.now() - 864e5));
  const count = async (q) => {
    try { return (await getCountFromServer(q)).data().count; } catch { return null; }
  };
  const [total, newThisWeek, activeToday, blocked] = await Promise.all([
    count(users),
    count(query(users, where("createdAt", ">=", weekAgo))),
    count(query(users, where("lastLoginAt", ">=", dayAgo))),
    count(query(collection(db, "moderation"), where("blocked", "==", true))),
  ]);
  return { total, newThisWeek, activeToday, blocked };
}

// ── Users ─────────────────────────────────────────────────────────────────

const userRow = (d) => ({ uid: d.id, ...d.data() });

/** Most recently active first. */
export async function loadRecentUsers(max = 50) {
  const snap = await getDocs(query(collection(db, "users"), orderBy("lastLoginAt", "desc"), limitTo(max)));
  return snap.docs.map(userRow);
}

export async function loadNewestUsers(max = 8) {
  const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limitTo(max)));
  return snap.docs.map(userRow);
}

/** By email (starts with), or an exact uid. */
export async function searchUsers(text) {
  const q = String(text || "").trim();
  if (!q) return loadRecentUsers();
  const results = new Map();
  const byUid = await getDoc(doc(db, "users", q)).catch(() => null);
  if (byUid?.exists()) results.set(byUid.id, userRow(byUid));
  const lower = q.toLowerCase();
  const snap = await getDocs(query(collection(db, "users"), where("email", ">=", lower), where("email", "<=", `${lower}`), limitTo(30)));
  snap.docs.forEach((d) => results.set(d.id, userRow(d)));
  return [...results.values()];
}

export async function loadBlockedUsers() {
  const snap = await getDocs(query(collection(db, "moderation"), where("blocked", "==", true), limitTo(200)));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

/** Moderation status for a list of uids: { uid: record }. */
export async function loadModerationFor(uids) {
  const out = {};
  await Promise.all(uids.map(async (uid) => {
    const s = await getDoc(doc(db, "moderation", uid)).catch(() => null);
    if (s?.exists()) out[uid] = s.data();
  }));
  return out;
}

export async function loadUserDetail(uid) {
  const [profile, moderation, note, logins, chats] = await Promise.all([
    getDoc(doc(db, "users", uid)),
    getDoc(doc(db, "moderation", uid)),
    getDoc(doc(db, "admin_notes", uid)).catch(() => null),
    getDocs(query(collection(db, "users", uid, "logins"), orderBy("lastSeen", "desc"), limitTo(50))).catch(() => null),
    getCountFromServer(collection(db, "users", uid, "sessions")).catch(() => null),
  ]);
  return {
    uid,
    profile: profile.exists() ? profile.data() : null,
    moderation: moderation.exists() ? moderation.data() : null,
    note: note?.exists() ? note.data().text || "" : "",
    logins: logins ? logins.docs.map((d) => ({ id: d.id, ...d.data() })) : [],
    chatCount: chats ? chats.data().count : null,
  };
}

// ── Moderation actions (each logged first) ────────────────────────────────

async function writeModeration(uid, fields) {
  const ref = doc(db, "moderation", uid);
  const current = await getDoc(ref);
  await setDoc(ref, {
    blocked: current.exists() ? current.data().blocked === true : false,
    ...fields,
    updatedBy: me().uid,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function blockUser(user, { publicReason, privateReason }) {
  await audit("block_user", { targetUid: user.uid, targetEmail: user.email, reason: privateReason || publicReason });
  await writeModeration(user.uid, { blocked: true, publicReason: publicReason || "", blockedAt: serverTimestamp(), email: user.email || "" });
}

export async function unblockUser(user, reason) {
  await audit("unblock_user", { targetUid: user.uid, targetEmail: user.email, reason });
  await writeModeration(user.uid, { blocked: false, publicReason: "", unblockedAt: serverTimestamp() });
}

export async function warnUser(user, text) {
  await audit("warn_user", { targetUid: user.uid, targetEmail: user.email, reason: text });
  await writeModeration(user.uid, { warning: { text: String(text).slice(0, 600), at: Timestamp.now() } });
}

export async function clearWarning(user) {
  await audit("clear_warning", { targetUid: user.uid, targetEmail: user.email });
  await writeModeration(user.uid, { warning: null });
}

export async function saveNote(user, text) {
  await audit("edit_note", { targetUid: user.uid, targetEmail: user.email });
  await setDoc(doc(db, "admin_notes", user.uid), { text: String(text).slice(0, 4000), updatedBy: me().uid, updatedAt: serverTimestamp() });
}

export async function removeDevice(user, deviceId) {
  await audit("remove_device_record", { targetUid: user.uid, targetEmail: user.email, details: { deviceId } });
  await deleteDoc(doc(db, "users", user.uid, "logins", deviceId));
}

// ── Chats, for a legal request ────────────────────────────────────────────

/** Logs who looked, why and on what authority — then returns the chats. */
export async function openChatsForRequest(user, { reason, reference }) {
  await audit("view_chats", { targetUid: user.uid, targetEmail: user.email, reason, reference });
  const snap = await getDocs(collection(db, "users", user.uid, "sessions"));
  return snap.docs
    .map((d) => {
      const data = d.data();
      return { id: d.id, title: data.title || "Untitled chat", messages: Array.isArray(data.messages) ? data.messages : [], updatedAt: toDate(data.updatedAt) };
    })
    .sort((a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0));
}

export async function logExport(user, { reason, reference, chats }) {
  await audit("export_chats", { targetUid: user.uid, targetEmail: user.email, reason, reference, details: { chats: chats.length } });
}

// ── Blocked IPs ───────────────────────────────────────────────────────────

export const ipKey = (ip) => String(ip || "").trim().toLowerCase().replace(/^::ffff:/, "").replace(/[^0-9a-f.:]/g, "").replace(/[:.]/g, "_");
export const isValidIp = (ip) => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split(".").every((n) => Number(n) <= 255)
  || (/^[0-9a-f:]+$/i.test(ip) && ip.includes(":") && ip.length <= 45);

export async function loadBlockedIps() {
  const snap = await getDocs(collection(db, "moderation_ips"));
  return snap.docs.map((d) => ({ key: d.id, ...d.data() })).sort((a, b) => (toDate(b.at)?.getTime() || 0) - (toDate(a.at)?.getTime() || 0));
}

export async function blockIp(ip, reason) {
  const clean = String(ip).trim().replace(/^::ffff:/, "");
  await audit("block_ip", { reason, details: { ip: clean } });
  await setDoc(doc(db, "moderation_ips", ipKey(clean)), { ip: clean, reason: String(reason || "").slice(0, 300), by: me().uid, at: serverTimestamp() });
}

export async function unblockIp(entry) {
  await audit("unblock_ip", { details: { ip: entry.ip } });
  await deleteDoc(doc(db, "moderation_ips", entry.key));
}

// ── App settings ──────────────────────────────────────────────────────────

export async function loadAppConfig() {
  const s = await getDoc(doc(db, "config", "app"));
  return s.exists() ? s.data() : {};
}

export async function saveAppConfig(next, what) {
  await audit("change_settings", { reason: what, details: next });
  await setDoc(doc(db, "config", "app"), { ...next, updatedBy: me().uid, updatedAt: serverTimestamp() }, { merge: true });
}

// ── Server-side controls (/api/admin) ─────────────────────────────────────

async function adminFetch(path, { method = "GET", body } = {}) {
  const token = await me()?.getIdToken();
  const res = await fetch(`${API}/admin/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.message || `Request failed (${res.status})`), { status: res.status, code: data?.data?.code });
  return data.data;
}

export const serverStatus = () => adminFetch("status");
export const loadAccount = (uid) => adminFetch(`users/${encodeURIComponent(uid)}/account`);

export async function setSignInDisabled(user, disabled, reason) {
  await audit(disabled ? "disable_sign_in" : "enable_sign_in", { targetUid: user.uid, targetEmail: user.email, reason });
  return adminFetch(`users/${encodeURIComponent(user.uid)}/disable`, { method: "POST", body: { disabled } });
}

export async function signOutEverywhere(user, reason) {
  await audit("sign_out_everywhere", { targetUid: user.uid, targetEmail: user.email, reason });
  return adminFetch(`users/${encodeURIComponent(user.uid)}/revoke`, { method: "POST", body: {} });
}

// ── Download ──────────────────────────────────────────────────────────────

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
