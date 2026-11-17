// Who may use VetroAI right now, as set from the admin page (/admin).
//
// Everything lives in Firestore, written by the admin page under the security
// rules in firestore.rules:
//   moderation/{uid}     { blocked, reason, … }  readable by that person and admins
//   admins/{uid}         exists = that account is an admin (added in the console)
//   config/app           { maintenance: { on, message }, announcement }  public read
//   moderation_ips/{key} { ip, reason }          admins only; read here with the
//                                                optional service account
//
// The server reads the first two with the caller's own ID token, so it needs
// no extra credentials. Lookups are cached briefly: a block takes effect within
// a minute on the server (and at once in the app, which listens live).
//
// A lookup that fails (Firestore unreachable) lets the request through and is
// logged: an outage must not lock every user out. The Firestore rules still
// refuse a blocked account's reads and writes on their own.

const { getDoc, listDocs } = require("../utils/firestoreRest");
const serviceAccount = require("../utils/serviceAccount");
const logger = require("../utils/logger");

const BLOCK_TTL_MS = 60 * 1000;
const ADMIN_TTL_MS = 5 * 60 * 1000;
const CONFIG_TTL_MS = 30 * 1000;
const IPS_TTL_MS = 60 * 1000;

const state = {
  // Off under `node --test` unless a test turns it on, so the rest of the
  // suite never waits on Firestore.
  enabled: !process.env.NODE_TEST_CONTEXT && process.env.MODERATION_CHECKS !== "off",
  fetchImpl: (...args) => fetch(...args),
};

const blockCache = new Map(); // uid -> { value, until }
const adminCache = new Map(); // uid -> { value, until }
let configCache = { value: null, until: 0 };
let ipsCache = { value: new Map(), until: 0 };

function cached(map, key) {
  const hit = map.get(key);
  if (hit && hit.until > Date.now()) return hit;
  return null;
}

/** The moderation record for `uid` ({ blocked, reason, … }) or null. */
async function moderationFor(uid, token) {
  if (!state.enabled || !uid || !token) return null;
  const hit = cached(blockCache, uid);
  if (hit) return hit.value;
  let value = null;
  try {
    value = await getDoc(`moderation/${uid}`, token, { fetchImpl: state.fetchImpl });
  } catch (err) {
    // A blocked account's token can still read its own record, so a refusal
    // here is an outage or misconfiguration, not a block.
    logger.warn("moderation.lookupFailed", { uid, message: err.message });
  }
  blockCache.set(uid, { value, until: Date.now() + BLOCK_TTL_MS });
  return value;
}

async function isBlocked(uid, token) {
  const rec = await moderationFor(uid, token);
  return rec?.blocked === true ? rec : null;
}

/** True when `uid` has an admins/{uid} document. */
async function isAdmin(uid, token) {
  if (!uid || !token) return false;
  const hit = cached(adminCache, uid);
  if (hit) return hit.value;
  let value = false;
  try {
    value = Boolean(await getDoc(`admins/${uid}`, token, { fetchImpl: state.fetchImpl }));
  } catch (err) {
    logger.warn("moderation.adminLookupFailed", { uid, message: err.message });
  }
  adminCache.set(uid, { value, until: Date.now() + ADMIN_TTL_MS });
  return value;
}

/** config/app: { maintenance: { on, message }, announcement: {…} } or {}. */
async function appConfig() {
  if (!state.enabled) return {};
  if (configCache.until > Date.now()) return configCache.value || {};
  let value = configCache.value;
  try {
    value = (await getDoc("config/app", null, { fetchImpl: state.fetchImpl })) || {};
  } catch (err) {
    logger.warn("moderation.configLookupFailed", { message: err.message });
  }
  configCache = { value, until: Date.now() + CONFIG_TTL_MS };
  return value || {};
}

// IPs are stored under a key Firestore accepts as a document id.
const ipKey = (ip) => String(ip || "").trim().toLowerCase().replace(/^::ffff:/, "").replace(/[^0-9a-f.:]/g, "").replace(/[:.]/g, "_");

/** The block record for this IP, or null. Needs the service account. */
async function blockedIp(ip) {
  if (!state.enabled || !ip || !serviceAccount.isConfigured()) return null;
  if (ipsCache.until <= Date.now()) {
    try {
      const token = await serviceAccount.accessToken();
      const docs = await listDocs("moderation_ips", token, { fetchImpl: state.fetchImpl });
      ipsCache = { value: new Map(docs.map((d) => [d.id, d])), until: Date.now() + IPS_TTL_MS };
    } catch (err) {
      logger.warn("moderation.ipListFailed", { message: err.message });
      ipsCache = { value: ipsCache.value, until: Date.now() + IPS_TTL_MS };
    }
  }
  return ipsCache.value.get(ipKey(ip)) || null;
}

function _reset({ enabled = true, fetchImpl } = {}) {
  state.enabled = enabled;
  if (fetchImpl) state.fetchImpl = fetchImpl;
  blockCache.clear();
  adminCache.clear();
  configCache = { value: null, until: 0 };
  ipsCache = { value: new Map(), until: 0 };
}

module.exports = { isBlocked, isAdmin, appConfig, blockedIp, ipKey, _reset, _state: state };
