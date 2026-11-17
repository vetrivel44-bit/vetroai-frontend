import React, { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { AlertTriangle, Info, LogOut, Megaphone, ShieldOff, Wrench, X } from "lucide-react";
import { auth, db } from "../firebase";
import { signOutUser } from "../lib/firebaseAuth";
import { checkIsAdmin } from "../lib/adminApi";
import { resolveApiBase } from "../lib/apiBase";
import "./ModerationGate.css";

// What the admin page (/admin) decides, shown to everyone else, live:
//   - a suspended account sees a full-screen notice and can only sign out
//   - a warning from an admin shows as a banner until dismissed
//   - the announcement banner and maintenance mode (config/app)
// It also tells the server where this account is signed in (users/{uid}/logins).
//
// The server and the Firestore rules enforce all of this on their own; this
// is what the person sees.

const PRODUCTION_API_BASE = "https://ai-chatbot-backend-gvvz.onrender.com/api";
const API = resolveApiBase(import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD, PRODUCTION_API_BASE);
const DEVICE_KEY = "vetro_device_id";
const PING_EVERY_MS = 15 * 60 * 1000;

function store(fn, fallback = null) {
  try { return fn(window.localStorage); } catch { return fallback; }
}

function deviceId() {
  let id = store((s) => s.getItem(DEVICE_KEY));
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
    store((s) => s.setItem(DEVICE_KEY, id));
  }
  return id;
}

async function pingDevice(user) {
  try {
    const token = await user.getIdToken();
    await fetch(`${API}/auth/device`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: deviceId() }),
    });
  } catch { /* offline: try again next time */ }
}

const stampOf = (v) => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : 0);
const hash = (s) => [...String(s || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7).toString(36);

export default function ModerationGate() {
  const [user, setUser] = useState(null);
  const [moderation, setModeration] = useState(null);
  const [config, setConfig] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [dismissed, setDismissed] = useState(() => store((s) => JSON.parse(s.getItem("vetro_dismissed_notices") || "{}"), {}) || {});

  useEffect(() => (auth ? onAuthStateChanged(auth, setUser) : undefined), []);

  // This account's moderation record, and whether it is an admin.
  useEffect(() => {
    setModeration(null);
    setIsAdmin(false);
    if (!db || !user) return undefined;
    checkIsAdmin(user).then(setIsAdmin);
    return onSnapshot(doc(db, "moderation", user.uid), (s) => setModeration(s.exists() ? s.data() : null), () => setModeration(null));
  }, [user]);

  // Announcement and maintenance, for everyone.
  useEffect(() => {
    if (!db) return undefined;
    return onSnapshot(doc(db, "config", "app"), (s) => setConfig(s.exists() ? s.data() : null), () => setConfig(null));
  }, []);

  // Where this account is signed in.
  useEffect(() => {
    if (!user) return undefined;
    pingDevice(user);
    const timer = setInterval(() => { if (document.visibilityState === "visible") pingDevice(user); }, PING_EVERY_MS);
    return () => clearInterval(timer);
  }, [user]);

  const dismiss = (key) => {
    const next = { ...dismissed, [key]: true };
    setDismissed(next);
    store((s) => s.setItem("vetro_dismissed_notices", JSON.stringify(next)));
  };

  if (moderation?.blocked === true) {
    return (
      <div className="vmg-screen" role="alertdialog" aria-modal="true" aria-labelledby="vmg-blocked-title">
        <div className="vmg-panel">
          <span className="vmg-icon is-danger"><ShieldOff size={26} /></span>
          <h1 id="vmg-blocked-title">Your account has been suspended</h1>
          <p>You can't use VetroAI with this account right now.</p>
          {moderation.publicReason && <p className="vmg-reason"><strong>Reason:</strong> {moderation.publicReason}</p>}
          <p className="vmg-small">If you think this is a mistake, contact VetroAI support with the email address you signed in with.</p>
          <button type="button" className="vmg-btn" onClick={() => signOutUser()}><LogOut size={16} /> Sign out</button>
        </div>
      </div>
    );
  }

  if (config?.maintenance?.on === true && !isAdmin) {
    return (
      <div className="vmg-screen" role="alertdialog" aria-modal="true" aria-labelledby="vmg-maint-title">
        <div className="vmg-panel">
          <span className="vmg-icon"><Wrench size={26} /></span>
          <h1 id="vmg-maint-title">We'll be right back</h1>
          <p>{config.maintenance.message || "VetroAI is down for maintenance. Please try again soon."}</p>
          <button type="button" className="vmg-btn" onClick={() => window.location.reload()}>Try again</button>
        </div>
      </div>
    );
  }

  const banners = [];
  const warning = moderation?.warning;
  if (warning?.text) {
    const key = `w${stampOf(warning.at)}`;
    if (!dismissed[key]) banners.push({ key, tone: "danger", icon: AlertTriangle, title: "A message from the VetroAI team", text: warning.text });
  }
  const ann = config?.announcement;
  if (ann?.on && ann?.text) {
    const key = `a${hash(ann.text)}`;
    if (!dismissed[key]) banners.push({ key, tone: ann.level === "warning" ? "warn" : "info", icon: ann.level === "warning" ? Megaphone : Info, text: ann.text });
  }
  if (config?.maintenance?.on === true && isAdmin) {
    banners.push({ key: "maint-admin", tone: "warn", icon: Wrench, text: "Maintenance mode is on: everyone else sees the maintenance screen.", sticky: true });
  }
  if (!banners.length) return null;

  return (
    <div className="vmg-banners" role="region" aria-label="Notices">
      {banners.map(({ key, tone, icon: Icon, title, text, sticky }) => (
        <div key={key} className={`vmg-banner is-${tone}`} role="status">
          <Icon size={17} className="vmg-banner-icon" />
          <div className="vmg-banner-text">{title && <strong>{title}</strong>}<span>{text}</span></div>
          {!sticky && <button type="button" className="vmg-banner-close" onClick={() => dismiss(key)} aria-label="Dismiss"><X size={15} /></button>}
        </div>
      ))}
    </div>
  );
}
