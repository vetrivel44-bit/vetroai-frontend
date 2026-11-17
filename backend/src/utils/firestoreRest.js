// A small Firestore REST client.
//
// The server has no Admin SDK (see utils/firebaseToken.js for why). It reads
// and writes Firestore the way the app does: with the signed-in person's own
// ID token, so the same security rules apply to the server as to the browser.
// Admin-only work (reading the IP blocklist) uses the optional service
// account token instead (utils/serviceAccount.js).

const { config } = require("../config/env");

const TIMEOUT_MS = 3000;

const docsBase = () =>
  `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.firebaseProjectId)}/databases/(default)/documents`;

function docUrl(path) {
  return `${docsBase()}/${String(path).split("/").map(encodeURIComponent).join("/")}`;
}

// Firestore's typed values → plain JS.
function fromValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return Boolean(v.booleanValue);
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("stringValue" in v) return v.stringValue;
  if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  return null;
}

function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromValue(v);
  return out;
}

// Plain JS → Firestore's typed values. A Date becomes a timestamp.
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === "object") return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}

function toFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = toValue(v);
  return out;
}

const authHeaders = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

/**
 * One document's fields, or null when it does not exist.
 * Throws when it can't be read (network, rules), so callers decide what a
 * failure means for them.
 */
async function getDoc(path, token, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(docUrl(path), { headers: authHeaders(token), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error(`Firestore read ${res.status}`), { status: res.status });
  const body = await res.json();
  return fromFields(body.fields);
}

/** Writes the given fields (others are kept). */
async function patchDoc(path, data, token, { fetchImpl = fetch } = {}) {
  const mask = Object.keys(data).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
  const res = await fetchImpl(`${docUrl(path)}?${mask}`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFields(data) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw Object.assign(new Error(`Firestore write ${res.status}`), { status: res.status });
}

/** Every document in a collection (first page, up to `pageSize`): [{ id, ...fields }]. */
async function listDocs(path, token, { pageSize = 300, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${docUrl(path)}?pageSize=${pageSize}`, { headers: authHeaders(token), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return [];
  if (!res.ok) throw Object.assign(new Error(`Firestore list ${res.status}`), { status: res.status });
  const body = await res.json();
  return (body.documents || []).map((d) => ({ id: d.name.split("/").pop(), ...fromFields(d.fields) }));
}

module.exports = { getDoc, patchDoc, listDocs, fromFields, toFields };
