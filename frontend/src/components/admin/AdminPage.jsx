import React, { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  AlertTriangle, ArrowLeft, Ban, CheckCircle2, ChevronRight, ClipboardList, Copy, Download, Eye, FileLock2, Globe,
  LayoutDashboard, LogOut, Megaphone, Monitor, Moon, RefreshCw, Search, Settings, ShieldCheck, ShieldOff,
  Smartphone, StickyNote, Sun, Trash2, UserCheck, Users, Wrench, X, XCircle,
} from "lucide-react";
import { auth } from "../../firebase";
import { consumeRedirectResult, signInWithGoogle, signOutUser } from "../../lib/firebaseAuth";
import * as api from "../../lib/adminApi";
import "./admin.css";

// VetroAI's admin page, at /admin. Only accounts listed in admins/{uid} (added
// by hand in the Firebase console) get past the door, and the Firestore rules
// and the server check that again for everything this page does. Every change
// and every look at someone's chats is written to the audit log first.

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "ips", label: "Blocked IPs", icon: Globe },
  { id: "settings", label: "App controls", icon: Settings },
  { id: "audit", label: "Audit log", icon: ClipboardList },
  { id: "safety", label: "Stay safe", icon: ShieldCheck },
];

const ACTION_LABELS = {
  block_user: "Blocked user", unblock_user: "Unblocked user", warn_user: "Sent warning", clear_warning: "Cleared warning",
  edit_note: "Edited private note", remove_device_record: "Removed device record", view_chats: "Opened chats",
  export_chats: "Exported chats", block_ip: "Blocked IP", unblock_ip: "Unblocked IP", change_settings: "Changed app controls",
  disable_sign_in: "Disabled sign-in", enable_sign_in: "Enabled sign-in", sign_out_everywhere: "Signed out everywhere",
};

// ── Small helpers ─────────────────────────────────────────────────────────

const fmtDate = (v) => {
  const d = api.toDate(v);
  return d ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
};
function ago(v) {
  const d = api.toDate(v);
  if (!d) return "—";
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const units = [[31536000, "y"], [2592000, "mo"], [604800, "w"], [86400, "d"], [3600, "h"], [60, "m"]];
  for (const [n, u] of units) if (s >= n) return `${Math.floor(s / n)}${u} ago`;
  return "just now";
}
const initials = (u) => (u?.name || u?.email || "?").trim().split(/[\s@.]+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("vetroai_theme") || "dark"; } catch { return "dark"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("vetroai_theme", theme); } catch { /* private mode */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

function Avatar({ user, size = 34 }) {
  const [broken, setBroken] = useState(false);
  if (user?.picture && !broken) {
    return <img className="vadm-avatar" src={user.picture} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <span className="vadm-avatar is-initials" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(user)}</span>;
}

function Pill({ tone = "neutral", children }) {
  return <span className={`vadm-pill is-${tone}`}>{children}</span>;
}

function Empty({ icon: Icon = Users, title, children }) {
  return (
    <div className="vadm-empty">
      <Icon size={26} />
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}

function Spinner({ label = "Loading…" }) {
  return <div className="vadm-loading"><span className="vadm-spin" />{label}</div>;
}

function errorText(err) {
  const msg = String(err?.message || err || "Something went wrong");
  if (/permission|insufficient/i.test(msg)) return "Firestore refused this. Have the new firestore.rules been deployed? (See docs/admin.md.)";
  if (/requires an index/i.test(msg)) return "Firestore needs an index for this list. Open the browser console for the link that creates it.";
  return msg;
}

// A dialog that asks for the details an action needs, then runs it.
function ActionDialog({ dialog, onClose }) {
  const [values, setValues] = useState(() => Object.fromEntries((dialog.fields || []).map((f) => [f.name, f.initial ?? (f.type === "checkbox" ? false : "")])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = (dialog.fields || []).every((f) => !f.required || (f.type === "checkbox" ? values[f.name] === true : String(values[f.name]).trim()));

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const submit = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await dialog.run(values);
      onClose(true);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="vadm-modal-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="vadm-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="vadm-dialog-title">
        <div className="vadm-modal-head">
          {dialog.icon && <span className={`vadm-modal-icon is-${dialog.tone || "neutral"}`}><dialog.icon size={20} /></span>}
          <h2 id="vadm-dialog-title">{dialog.title}</h2>
          <button type="button" className="vadm-icon-btn" onClick={() => onClose()} disabled={busy} aria-label="Close"><X size={17} /></button>
        </div>
        {dialog.body && <div className="vadm-modal-body">{dialog.body}</div>}
        {(dialog.fields || []).map((f) => (
          <label key={f.name} className={`vadm-field${f.type === "checkbox" ? " is-check" : ""}`}>
            {f.type === "checkbox" ? (
              <>
                <input type="checkbox" checked={values[f.name]} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))} />
                <span>{f.label}</span>
              </>
            ) : (
              <>
                <span className="vadm-field-label">{f.label}{f.required && <em> required</em>}</span>
                {f.type === "textarea"
                  ? <textarea rows={f.rows || 3} value={values[f.name]} placeholder={f.placeholder} maxLength={f.max || 1000} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
                  : <input type="text" value={values[f.name]} placeholder={f.placeholder} maxLength={f.max || 300} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />}
                {f.hint && <small>{f.hint}</small>}
              </>
            )}
          </label>
        ))}
        {error && <p className="vadm-error"><AlertTriangle size={15} /> {error}</p>}
        <div className="vadm-modal-actions">
          <button type="button" className="vadm-btn" onClick={() => onClose()} disabled={busy}>Cancel</button>
          <button type="submit" className={`vadm-btn is-${dialog.tone === "danger" ? "danger" : "primary"}`} disabled={!ready || busy}>
            {busy ? "Working…" : dialog.confirm || "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Sign-in and the door ──────────────────────────────────────────────────

function Door({ state, onSignIn }) {
  return (
    <div className="vadm-door">
      <div className="vadm-door-card">
        <span className="vadm-brand-mark"><ShieldCheck size={26} /></span>
        {state === "loading" && <Spinner label="Checking your access…" />}
        {state === "signed-out" && (
          <>
            <h1>VetroAI Admin</h1>
            <p>Sign in with your admin account to continue.</p>
            <button type="button" className="vadm-btn is-primary is-wide" onClick={onSignIn}>Sign in with Google</button>
            <p className="vadm-muted vadm-small vadm-door-alt">Use email and password? <a href="/">Sign in on VetroAI</a>, then open this page again.</p>
          </>
        )}
        {state === "denied" && (
          <>
            <h1>Admins only</h1>
            <p>This account doesn't have access to the admin page.</p>
            <div className="vadm-row is-center">
              <a className="vadm-btn" href="/"><ArrowLeft size={15} /> Back to VetroAI</a>
              <button type="button" className="vadm-btn" onClick={() => signOutUser()}><LogOut size={15} /> Switch account</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────

function Stat({ label, value, icon: Icon, tone }) {
  return (
    <div className={`vadm-stat is-${tone || "neutral"}`}>
      <span className="vadm-stat-icon"><Icon size={18} /></span>
      <span className="vadm-stat-value">{value == null ? "—" : value.toLocaleString()}</span>
      <span className="vadm-stat-label">{label}</span>
    </div>
  );
}

function Overview({ server, onOpenUser, me, go }) {
  const [stats, setStats] = useState(null);
  const [newest, setNewest] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [s, n] = await Promise.all([api.loadStats(), api.loadNewestUsers(8)]);
      setStats(s);
      setNewest(n);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="vadm-stack">
      <div className="vadm-stats">
        <Stat label="Total users" value={stats?.total} icon={Users} />
        <Stat label="New this week" value={stats?.newThisWeek} icon={UserCheck} tone="good" />
        <Stat label="Signed in today" value={stats?.activeToday} icon={Monitor} tone="info" />
        <Stat label="Blocked" value={stats?.blocked} icon={Ban} tone="danger" />
      </div>
      {error && <p className="vadm-error"><AlertTriangle size={15} /> {error}</p>}

      <div className="vadm-grid-2">
        <section className="vadm-card">
          <div className="vadm-card-head">
            <h3>Your account</h3>
          </div>
          <p className="vadm-muted">Check every device and IP address your own account is signed in from. If you see one you don't recognise, sign out everywhere and change your password.</p>
          <button type="button" className="vadm-btn is-primary" onClick={() => onOpenUser({ uid: me.uid, email: me.email, name: me.displayName, picture: me.photoURL })}>
            <Monitor size={15} /> See where I'm signed in
          </button>
        </section>

        <section className="vadm-card">
          <div className="vadm-card-head"><h3>Server</h3></div>
          <ul className="vadm-checks">
            <li className={server?.ok ? "is-ok" : "is-bad"}>
              {server?.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {server?.ok ? "The server recognises you as an admin" : `Server check failed${server?.error ? `: ${server.error}` : ""}`}
            </li>
            <li className={server?.serviceAccount ? "is-ok" : "is-warn"}>
              {server?.serviceAccount ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              {server?.serviceAccount ? "Service account set: account disable, sign-out-everywhere and IP blocking work" : "No service account yet: disabling sign-in, signing out everywhere and IP blocking need it"}
            </li>
            <li className={server?.maintenance ? "is-warn" : "is-ok"}>
              {server?.maintenance ? <Wrench size={16} /> : <CheckCircle2 size={16} />}
              {server?.maintenance ? "Maintenance mode is ON" : "VetroAI is open to everyone"}
            </li>
          </ul>
          {!server?.serviceAccount && <button type="button" className="vadm-link" onClick={() => go("safety")}>How to set it up <ChevronRight size={14} /></button>}
        </section>
      </div>

      <section className="vadm-card">
        <div className="vadm-card-head">
          <h3>Newest users</h3>
          <button type="button" className="vadm-icon-btn" onClick={load} title="Refresh" aria-label="Refresh"><RefreshCw size={15} /></button>
        </div>
        {!newest ? <Spinner /> : newest.length === 0 ? <Empty title="No users yet" /> : (
          <ul className="vadm-list">
            {newest.map((u) => (
              <li key={u.uid}>
                <button type="button" className="vadm-list-row" onClick={() => onOpenUser(u)}>
                  <Avatar user={u} size={30} />
                  <span className="vadm-list-main"><strong>{u.name || u.email || u.uid}</strong><small>{u.email}</small></span>
                  <span className="vadm-muted vadm-nowrap">joined {ago(u.createdAt)}</span>
                  <ChevronRight size={16} className="vadm-chev" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Users ─────────────────────────────────────────────────────────────────

function UsersTab({ onOpenUser, refreshKey }) {
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("all");
  const [rows, setRows] = useState(null);
  const [mod, setMod] = useState({});
  const [error, setError] = useState("");

  const run = useCallback(async (q, f) => {
    setRows(null);
    setError("");
    try {
      if (f === "blocked") {
        const blocked = await api.loadBlockedUsers();
        const profiles = await Promise.all(blocked.map(async (b) => {
          const found = (await api.searchUsers(b.uid))[0];
          return found || { uid: b.uid, email: b.email || "", name: "" };
        }));
        setMod(Object.fromEntries(blocked.map((b) => [b.uid, b])));
        setRows(profiles);
        return;
      }
      const list = await api.searchUsers(q);
      // Statuses first, so a blocked user never shows as "Active" for a moment.
      setMod(await api.loadModerationFor(list.map((u) => u.uid)));
      setRows(list);
    } catch (err) {
      setError(errorText(err));
      setRows([]);
    }
  }, []);

  useEffect(() => { run("", filter); }, [run, filter, refreshKey]);

  return (
    <div className="vadm-stack">
      <form className="vadm-toolbar" onSubmit={(e) => { e.preventDefault(); setFilter("all"); run(text, "all"); }}>
        <label className="vadm-search">
          <Search size={16} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by email (starts with) or paste a user id" aria-label="Search users" />
          {text && <button type="button" className="vadm-icon-btn" onClick={() => { setText(""); run("", filter); }} aria-label="Clear search"><X size={14} /></button>}
        </label>
        <button type="submit" className="vadm-btn is-primary">Search</button>
        <div className="vadm-seg" role="tablist" aria-label="Filter users">
          {[["all", "Recently active"], ["blocked", "Blocked"]].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={filter === id} className={filter === id ? "is-on" : ""} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      </form>
      {error && <p className="vadm-error"><AlertTriangle size={15} /> {error}</p>}

      <section className="vadm-card is-flush">
        {!rows ? <Spinner /> : rows.length === 0 ? <Empty title={filter === "blocked" ? "Nobody is blocked" : "No users found"}>{filter === "all" && text ? "Email search matches the start of the address, e.g. \"ravi\" finds ravi@gmail.com." : null}</Empty> : (
          <div className="vadm-table-wrap">
            <table className="vadm-table">
              <thead><tr><th>User</th><th>Status</th><th className="vadm-hide-sm">Joined</th><th className="vadm-hide-sm">Last sign-in</th><th aria-label="Open" /></tr></thead>
              <tbody>
                {rows.map((u) => {
                  const m = mod[u.uid];
                  return (
                    <tr key={u.uid} onClick={() => onOpenUser(u)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onOpenUser(u); }}>
                      <td>
                        <span className="vadm-user-cell">
                          <Avatar user={u} size={30} />
                          <span className="vadm-list-main"><strong>{u.name || u.email || u.uid}</strong><small>{u.email || u.uid}</small></span>
                        </span>
                      </td>
                      <td>
                        {m?.blocked ? <Pill tone="danger">Blocked</Pill> : m?.warning?.text ? <Pill tone="warn">Warned</Pill> : <Pill tone="good">Active</Pill>}
                      </td>
                      <td className="vadm-hide-sm vadm-muted">{ago(u.createdAt)}</td>
                      <td className="vadm-hide-sm vadm-muted">{ago(u.lastLoginAt)}</td>
                      <td><ChevronRight size={16} className="vadm-chev" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ── One user ──────────────────────────────────────────────────────────────

function ChatViewer({ user, chats, request, onClose, toast }) {
  const [open, setOpen] = useState(null);
  const exportAll = async () => {
    try {
      await api.logExport(user, { ...request, chats });
      api.downloadJson(`vetroai-chats-${user.uid}-${new Date().toISOString().slice(0, 10)}.json`, {
        exportedAt: new Date().toISOString(),
        exportedBy: auth.currentUser?.email,
        legalReference: request.reference,
        requestedBy: request.authority,
        reason: request.reason,
        user: { uid: user.uid, email: user.email, name: user.name || "" },
        chats: chats.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt?.toISOString() || null, messages: c.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content), time: m.timestamp || m.time || null })) })),
      });
      toast("Export downloaded and logged");
    } catch (err) {
      toast(errorText(err), "danger");
    }
  };
  return (
    <div className="vadm-modal-wrap">
      <div className="vadm-modal is-wide" role="dialog" aria-modal="true" aria-labelledby="vadm-chats-title">
        <div className="vadm-modal-head">
          <span className="vadm-modal-icon is-warn"><FileLock2 size={20} /></span>
          <h2 id="vadm-chats-title">Chats of {user.email || user.uid}</h2>
          <button type="button" className="vadm-icon-btn" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>
        <p className="vadm-banner is-warn"><AlertTriangle size={15} /> Opened for: <strong>{request.reference}</strong> ({request.authority}). This view is logged. Share only what the request asks for.</p>
        <div className="vadm-row">
          <span className="vadm-muted">{chats.length} chat{chats.length === 1 ? "" : "s"} saved to the cloud. Chats the person deleted, or never synced, aren't here.</span>
          <button type="button" className="vadm-btn is-primary" onClick={exportAll} disabled={!chats.length}><Download size={15} /> Download export</button>
        </div>
        <div className="vadm-chats">
          {chats.length === 0 ? <Empty icon={FileLock2} title="No saved chats" /> : chats.map((c) => (
            <div key={c.id} className={`vadm-chat${open === c.id ? " is-open" : ""}`}>
              <button type="button" className="vadm-chat-head" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                <strong>{c.title}</strong>
                <span className="vadm-muted">{c.messages.length} message{c.messages.length === 1 ? "" : "s"} · {fmtDate(c.updatedAt)}</span>
                <ChevronRight size={16} className="vadm-chev" />
              </button>
              {open === c.id && (
                <div className="vadm-chat-body">
                  {c.messages.map((m, i) => (
                    <div key={i} className={`vadm-msg is-${m.role === "user" ? "user" : "ai"}`}>
                      <span className="vadm-msg-role">{m.role === "user" ? "User" : "VetroAI"}</span>
                      <div className="vadm-msg-text">{typeof m.content === "string" ? m.content : JSON.stringify(m.content)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UserPanel({ user, me, server, onClose, onChanged, ask, toast }) {
  const [detail, setDetail] = useState(null);
  const [account, setAccount] = useState(null);
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [chats, setChats] = useState(null);
  const [error, setError] = useState("");
  const isMe = user.uid === me.uid;

  const load = useCallback(async () => {
    setError("");
    try {
      const d = await api.loadUserDetail(user.uid);
      setDetail(d);
      setNote(d.note);
      setSavedNote(d.note);
    } catch (err) {
      setError(errorText(err));
    }
    if (server?.serviceAccount) api.loadAccount(user.uid).then(setAccount).catch(() => setAccount(null));
  }, [user.uid, server?.serviceAccount]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !chats) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, chats]);

  const profile = { ...user, ...(detail?.profile || {}), uid: user.uid };
  const mod = detail?.moderation;
  const blocked = mod?.blocked === true;
  const done = (msg) => { toast(msg); load(); onChanged(); };
  const needsServer = !server?.serviceAccount;

  const block = () => ask({
    title: `Block ${profile.email || "this user"}?`, tone: "danger", icon: Ban, confirm: "Block user",
    body: <p>They're stopped at once: the app shows them a "suspended" screen, the server refuses their requests, and they can't read or change their data. You can unblock them any time; nothing is deleted.</p>,
    fields: [
      { name: "publicReason", label: "Reason shown to them", placeholder: "e.g. Repeated abusive messages", max: 300 },
      { name: "privateReason", label: "Private reason, for the audit log", type: "textarea", required: true, max: 1000 },
    ],
    run: async (v) => { await api.blockUser(profile, v); done("User blocked"); },
  });
  const unblock = () => ask({
    title: `Unblock ${profile.email || "this user"}?`, tone: "good", icon: UserCheck, confirm: "Unblock",
    body: <p>They can use VetroAI again straight away, with all their chats and settings as they were.</p>,
    fields: [{ name: "reason", label: "Why (for the audit log)", required: true }],
    run: async (v) => { await api.unblockUser(profile, v.reason); done("User unblocked"); },
  });
  const warn = () => ask({
    title: "Send a warning", tone: "warn", icon: AlertTriangle, confirm: "Send warning",
    body: <p>Shown to them as a banner the next time they open VetroAI (at once if it's open).</p>,
    fields: [{ name: "text", label: "Message", type: "textarea", required: true, max: 600, placeholder: "Please keep your requests within VetroAI's rules. Further misuse will lead to your account being suspended." }],
    run: async (v) => { await api.warnUser(profile, v.text); done("Warning sent"); },
  });
  const disable = (disabled) => ask({
    title: disabled ? "Turn off sign-in for this account?" : "Turn sign-in back on?", tone: disabled ? "danger" : "good", icon: disabled ? ShieldOff : ShieldCheck,
    confirm: disabled ? "Turn off sign-in" : "Turn on sign-in",
    body: <p>{disabled ? "Firebase will refuse every sign-in for this account until you turn it back on. Use this as well as blocking for serious abuse." : "They'll be able to sign in again."}</p>,
    fields: [{ name: "reason", label: "Why (for the audit log)", required: true }],
    run: async (v) => { await api.setSignInDisabled(profile, disabled, v.reason); done(disabled ? "Sign-in turned off" : "Sign-in turned on"); },
  });
  const signOutAll = () => ask({
    title: isMe ? "Sign your account out everywhere?" : "Sign this account out everywhere?", tone: "warn", icon: LogOut, confirm: "Sign out everywhere",
    body: <p>Every device signed in to this account is signed out within the hour (as soon as its sign-in renews){isMe ? ", including this one. Change your Google password too if you think someone else got in." : "."}</p>,
    fields: [{ name: "reason", label: "Why (for the audit log)", required: true, initial: isMe ? "Securing my own account" : "" }],
    run: async (v) => { await api.signOutEverywhere(profile, v.reason); done("Signed out everywhere"); },
  });
  const blockIp = (ip) => ask({
    title: `Block ${ip}?`, tone: "danger", icon: Globe, confirm: "Block IP",
    body: <p>Every request from this address is refused, signed in or not.{needsServer ? " (Saved now; the server enforces it once the service account is set.)" : ""} Careful: a school, office or mobile network can share one address between many people.</p>,
    fields: [{ name: "reason", label: "Why", required: true, initial: `Used by ${profile.email || profile.uid}` }],
    run: async (v) => { await api.blockIp(ip, v.reason); toast("IP blocked"); },
  });
  const removeDevice = (d) => ask({
    title: "Remove this device record?", tone: "danger", icon: Trash2, confirm: "Remove",
    body: <p>This only deletes the record from the list. It doesn't sign the device out.</p>,
    fields: [],
    run: async () => { await api.removeDevice(profile, d.id); done("Record removed"); },
  });
  const openChats = () => ask({
    title: "Open this person's chats?", tone: "warn", icon: FileLock2, confirm: "Open chats",
    body: (
      <>
        <p>Only for a valid legal request (a court order, or a written notice from an authorised agency). Your name, the time, and the details below are saved to the audit log, which can't be edited.</p>
        <p className="vadm-muted">Check that a request is real before you act on it: call the agency on its official number, not one from the request.</p>
      </>
    ),
    fields: [
      { name: "authority", label: "Who is asking", required: true, placeholder: "e.g. Cyber Crime Police Station, Chennai" },
      { name: "reference", label: "Order or notice number", required: true, placeholder: "e.g. Notice u/s 94 BNSS No. 123/2026" },
      { name: "reason", label: "What the request covers", type: "textarea", required: true, placeholder: "e.g. All chats between 1 Oct and 15 Oct 2026" },
      { name: "confirmed", type: "checkbox", required: true, label: "I have a valid written legal request for this person's data, and I've checked it's genuine." },
    ],
    run: async (v) => {
      const list = await api.openChatsForRequest(profile, { reason: `${v.reason} (requested by ${v.authority})`, reference: v.reference });
      setChats({ list, request: v });
    },
  });

  return (
    <div className="vadm-drawer-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="vadm-drawer" aria-label={`User ${profile.email || profile.uid}`}>
        <div className="vadm-drawer-head">
          <Avatar user={profile} size={46} />
          <div className="vadm-list-main">
            <strong className="vadm-drawer-name">{profile.name || profile.email || "Unnamed user"}{isMe && <Pill tone="info">You</Pill>}</strong>
            <small>{profile.email}</small>
            <button type="button" className="vadm-uid" onClick={() => { navigator.clipboard?.writeText(profile.uid); toast("User id copied"); }} title="Copy user id">
              {profile.uid} <Copy size={12} />
            </button>
          </div>
          <button type="button" className="vadm-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {error && <p className="vadm-error"><AlertTriangle size={15} /> {error}</p>}
        {!detail && !error ? <Spinner /> : detail && (
          <div className="vadm-drawer-body">
            <div className="vadm-status-row">
              {blocked ? <Pill tone="danger">Blocked</Pill> : <Pill tone="good">Active</Pill>}
              {mod?.warning?.text && <Pill tone="warn">Warned {ago(mod.warning.at)}</Pill>}
              {account?.disabled && <Pill tone="danger">Sign-in off</Pill>}
              {account && !account.emailVerified && <Pill tone="warn">Email not verified</Pill>}
            </div>
            {blocked && mod?.publicReason && <p className="vadm-banner is-danger"><Ban size={15} /> They were told: “{mod.publicReason}”</p>}
            {mod?.warning?.text && (
              <div className="vadm-banner is-warn">
                <AlertTriangle size={15} />
                <span>Warning: “{mod.warning.text}”</span>
                <button type="button" className="vadm-link" onClick={() => ask({ title: "Clear the warning?", confirm: "Clear", fields: [], run: async () => { await api.clearWarning(profile); done("Warning cleared"); } })}>Clear</button>
              </div>
            )}

            <dl className="vadm-facts">
              <div><dt>Joined</dt><dd>{fmtDate(profile.createdAt || account?.createdAt)}</dd></div>
              <div><dt>Last sign-in</dt><dd>{fmtDate(account?.lastLoginAt || profile.lastLoginAt)}</dd></div>
              <div><dt>Signs in with</dt><dd>{account?.providers?.length ? account.providers.map((p) => p.replace(".com", "")).join(", ") : "—"}</dd></div>
              <div><dt>Saved chats</dt><dd>{detail.chatCount ?? "—"}</dd></div>
            </dl>

            <section className="vadm-section">
              <h4>Actions</h4>
              <div className="vadm-actions">
                {!isMe && (blocked
                  ? <button type="button" className="vadm-btn is-good" onClick={unblock}><UserCheck size={15} /> Unblock</button>
                  : <button type="button" className="vadm-btn is-danger" onClick={block}><Ban size={15} /> Block</button>)}
                {!isMe && <button type="button" className="vadm-btn" onClick={warn}><AlertTriangle size={15} /> Warn</button>}
                <button type="button" className="vadm-btn" onClick={signOutAll} disabled={needsServer} title={needsServer ? "Needs the service account (Stay safe tab)" : ""}><LogOut size={15} /> Sign out everywhere</button>
                {!isMe && (account?.disabled
                  ? <button type="button" className="vadm-btn" onClick={() => disable(false)} disabled={needsServer}><ShieldCheck size={15} /> Turn sign-in on</button>
                  : <button type="button" className="vadm-btn" onClick={() => disable(true)} disabled={needsServer} title={needsServer ? "Needs the service account (Stay safe tab)" : ""}><ShieldOff size={15} /> Turn sign-in off</button>)}
              </div>
              {needsServer && <p className="vadm-muted vadm-small">Signing out everywhere and turning sign-in off need the server's service account. See the Stay safe tab.</p>}
            </section>

            <section className="vadm-section">
              <h4>Where they're signed in <span className="vadm-count">{detail.logins.length}</span></h4>
              {detail.logins.length === 0 ? <p className="vadm-muted vadm-small">No devices recorded yet. Devices appear after their next visit with this update.</p> : (
                <ul className="vadm-devices">
                  {detail.logins.map((d) => (
                    <li key={d.id}>
                      <span className="vadm-device-icon">{d.mobile ? <Smartphone size={17} /> : <Monitor size={17} />}</span>
                      <span className="vadm-list-main">
                        <strong>{d.browser || "Browser"} on {d.os || "unknown system"}</strong>
                        <small>{d.ip || "no IP"} · last used {ago(d.lastSeen)} · first {fmtDate(d.firstSeen)}</small>
                      </span>
                      {!isMe && d.ip && <button type="button" className="vadm-icon-btn" onClick={() => blockIp(d.ip)} title="Block this IP" aria-label={`Block IP ${d.ip}`}><Globe size={15} /></button>}
                      <button type="button" className="vadm-icon-btn" onClick={() => removeDevice(d)} title="Remove record" aria-label="Remove device record"><Trash2 size={15} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="vadm-section">
              <h4><StickyNote size={15} /> Private note</h4>
              <textarea className="vadm-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only admins can see this." maxLength={4000} />
              {note !== savedNote && (
                <div className="vadm-row is-end">
                  <button type="button" className="vadm-btn" onClick={() => setNote(savedNote)}>Discard</button>
                  <button type="button" className="vadm-btn is-primary" onClick={async () => {
                    try { await api.saveNote(profile, note); setSavedNote(note); toast("Note saved"); } catch (err) { toast(errorText(err), "danger"); }
                  }}>Save note</button>
                </div>
              )}
            </section>

            <section className="vadm-section is-legal">
              <h4><FileLock2 size={15} /> Chats — legal requests only</h4>
              <p className="vadm-muted vadm-small">Opening someone's chats is logged with your reason and the request's reference number.</p>
              <button type="button" className="vadm-btn" onClick={openChats}><Eye size={15} /> Open chats for a legal request</button>
            </section>
          </div>
        )}
      </aside>
      {chats && <ChatViewer user={profile} chats={chats.list} request={chats.request} onClose={() => setChats(null)} toast={toast} />}
    </div>
  );
}

// ── Blocked IPs ───────────────────────────────────────────────────────────

function IpsTab({ server, ask, toast }) {
  const [rows, setRows] = useState(null);
  const [ip, setIp] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setRows(await api.loadBlockedIps()); } catch (err) { setError(errorText(err)); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const valid = api.isValidIp(ip.trim());

  const add = (e) => {
    e.preventDefault();
    if (!valid) return;
    ask({
      title: `Block ${ip.trim()}?`, tone: "danger", icon: Globe, confirm: "Block IP",
      body: <p>Every request from this address is refused, signed in or not. A school, office or mobile network can share one address between many people.</p>,
      fields: [{ name: "reason", label: "Why", required: true }],
      run: async (v) => { await api.blockIp(ip.trim(), v.reason); setIp(""); toast("IP blocked"); load(); },
    });
  };
  const remove = (r) => ask({
    title: `Unblock ${r.ip}?`, confirm: "Unblock", icon: CheckCircle2, tone: "good", fields: [],
    run: async () => { await api.unblockIp(r); toast("IP unblocked"); load(); },
  });

  return (
    <div className="vadm-stack">
      {!server?.serviceAccount && (
        <p className="vadm-banner is-warn"><AlertTriangle size={15} /> The server can only enforce this list once its service account is set (Stay safe tab). You can add addresses now.</p>
      )}
      <form className="vadm-toolbar" onSubmit={add}>
        <label className="vadm-search">
          <Globe size={16} />
          <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="IP address, e.g. 203.0.113.7" aria-label="IP address to block" />
        </label>
        <button type="submit" className="vadm-btn is-danger" disabled={!valid}><Ban size={15} /> Block IP</button>
      </form>
      <p className="vadm-muted vadm-small">Tip: a user's IP addresses are listed under "Where they're signed in" in their profile, with a block button beside each.</p>
      {error && <p className="vadm-error"><AlertTriangle size={15} /> {error}</p>}
      <section className="vadm-card is-flush">
        {!rows ? <Spinner /> : rows.length === 0 ? <Empty icon={Globe} title="No blocked IP addresses" /> : (
          <ul className="vadm-list">
            {rows.map((r) => (
              <li key={r.key} className="vadm-list-row is-static">
                <span className="vadm-device-icon"><Globe size={16} /></span>
                <span className="vadm-list-main"><strong className="vadm-mono">{r.ip}</strong><small>{r.reason || "No reason given"} · {ago(r.at)}</small></span>
                <button type="button" className="vadm-btn is-small" onClick={() => remove(r)}>Unblock</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── App controls ──────────────────────────────────────────────────────────

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`vadm-toggle${on ? " is-on" : ""}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function SettingsTab({ ask, toast, onServerRefresh }) {
  const [cfg, setCfg] = useState(null);
  const [ann, setAnn] = useState({ on: false, level: "info", text: "" });
  const [maint, setMaint] = useState({ on: false, message: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const c = await api.loadAppConfig();
      setCfg(c);
      setAnn({ on: false, level: "info", text: "", ...(c.announcement || {}) });
      setMaint({ on: false, message: "", ...(c.maintenance || {}) });
    } catch (err) { setError(errorText(err)); setCfg({}); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const annChanged = cfg && JSON.stringify({ on: false, level: "info", text: "", ...(cfg.announcement || {}) }) !== JSON.stringify(ann);
  const saveAnn = async () => {
    try { await api.saveAppConfig({ announcement: { on: ann.on && Boolean(ann.text.trim()), level: ann.level, text: ann.text.trim().slice(0, 400) } }, "Announcement"); toast("Announcement saved"); load(); }
    catch (err) { toast(errorText(err), "danger"); }
  };
  const setMaintenance = (on) => ask({
    title: on ? "Turn maintenance mode on?" : "Turn maintenance mode off?", tone: on ? "danger" : "good", icon: Wrench,
    confirm: on ? "Turn on" : "Turn off",
    body: <p>{on ? "Everyone except admins sees a maintenance screen, and the server refuses their requests, until you turn it off." : "VetroAI opens to everyone again."}</p>,
    fields: on ? [{ name: "message", label: "Message people see", initial: maint.message || "VetroAI is down for a short upgrade. Please try again in a few minutes.", max: 300 }] : [],
    run: async (v) => { await api.saveAppConfig({ maintenance: { on, message: on ? v.message : maint.message } }, on ? "Maintenance on" : "Maintenance off"); toast(on ? "Maintenance mode is on" : "Maintenance mode is off"); load(); onServerRefresh(); },
  });

  if (!cfg) return <Spinner />;
  return (
    <div className="vadm-stack">
      {error && <p className="vadm-error"><AlertTriangle size={15} /> {error}</p>}
      <section className="vadm-card">
        <div className="vadm-card-head">
          <h3><Megaphone size={17} /> Announcement banner</h3>
          <Toggle on={ann.on} onChange={(on) => setAnn((a) => ({ ...a, on }))} label="Show the announcement" />
        </div>
        <p className="vadm-muted">A banner at the top of VetroAI for everyone, e.g. new features or planned downtime. People can dismiss it.</p>
        <div className="vadm-seg" role="radiogroup" aria-label="Banner style">
          {[["info", "Info"], ["warning", "Important"]].map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={ann.level === id} className={ann.level === id ? "is-on" : ""} onClick={() => setAnn((a) => ({ ...a, level: id }))}>{label}</button>
          ))}
        </div>
        <textarea className="vadm-note" rows={2} maxLength={400} value={ann.text} onChange={(e) => setAnn((a) => ({ ...a, text: e.target.value }))} placeholder="e.g. Flashcards are here! Ask VetroAI to make flashcards on any topic." />
        <div className="vadm-row is-end">
          <button type="button" className="vadm-btn is-primary" onClick={saveAnn} disabled={!annChanged}>Save announcement</button>
        </div>
      </section>

      <section className={`vadm-card${maint.on ? " is-alert" : ""}`}>
        <div className="vadm-card-head">
          <h3><Wrench size={17} /> Maintenance mode</h3>
          <Pill tone={maint.on ? "danger" : "good"}>{maint.on ? "On" : "Off"}</Pill>
        </div>
        <p className="vadm-muted">Closes VetroAI for everyone but admins, for an urgent fix or while you deal with an attack.</p>
        {maint.on && maint.message && <p className="vadm-banner is-warn">People see: “{maint.message}”</p>}
        <button type="button" className={`vadm-btn ${maint.on ? "is-good" : "is-danger"}`} onClick={() => setMaintenance(!maint.on)}>
          {maint.on ? "Turn maintenance off" : "Turn maintenance on"}
        </button>
      </section>
    </div>
  );
}

// ── Audit log ─────────────────────────────────────────────────────────────

function AuditTab({ onOpenUser }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setRows(null);
    try { setRows(await api.loadAudit()); } catch (err) { setError(errorText(err)); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="vadm-stack">
      <div className="vadm-row">
        <p className="vadm-muted">Every admin action, newest first. Entries can't be edited or deleted from the app, so this is your record if anyone asks what was done and why.</p>
        <button type="button" className="vadm-btn" onClick={load}><RefreshCw size={15} /> Refresh</button>
      </div>
      {error && <p className="vadm-error"><AlertTriangle size={15} /> {error}</p>}
      <section className="vadm-card is-flush">
        {!rows ? <Spinner /> : rows.length === 0 ? <Empty icon={ClipboardList} title="Nothing logged yet" /> : (
          <div className="vadm-table-wrap">
            <table className="vadm-table is-audit">
              <thead><tr><th>When</th><th>Action</th><th>About</th><th className="vadm-hide-sm">Reason / reference</th><th className="vadm-hide-sm">By</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="is-static">
                    <td className="vadm-nowrap vadm-muted" title={fmtDate(r.at)}>{ago(r.at)}</td>
                    <td><span className={`vadm-action is-${/block|disable|view|export|sign_out/.test(r.action) && !/unblock|enable/.test(r.action) ? "hot" : "calm"}`}>{ACTION_LABELS[r.action] || r.action}</span></td>
                    <td>
                      {r.targetUid
                        ? <button type="button" className="vadm-link" onClick={() => onOpenUser({ uid: r.targetUid, email: r.targetEmail })}>{r.targetEmail || r.targetUid}</button>
                        : <span className="vadm-mono vadm-small">{r.details?.ip || (r.action === "change_settings" ? r.reason : "—")}</span>}
                    </td>
                    <td className="vadm-hide-sm vadm-small">{r.reference && <strong>{r.reference}<br /></strong>}{r.action !== "change_settings" && r.reason}</td>
                    <td className="vadm-hide-sm vadm-muted vadm-small">{r.adminEmail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Stay safe ─────────────────────────────────────────────────────────────

function SafetyTab({ server }) {
  const appCheck = Boolean(import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY);
  const items = [
    { ok: server?.serviceAccount, title: "Give the server its service account", text: "Needed to turn off sign-in, sign accounts out everywhere and block IPs. Firebase console → Project settings → Service accounts → Generate new private key. Paste the file's contents into FIREBASE_SERVICE_ACCOUNT in Render → Environment. Never put this key in the code or share it." },
    { ok: null, title: "Deploy the security rules", text: "The admin page only works once the new firestore.rules are live: npx firebase-tools deploy --only firestore:rules --project vetroai. Do it again after any change to that file." },
    { ok: null, title: "Protect your admin account", text: "Turn on 2-step verification for the Google account you sign in with, and keep the admins list to people you fully trust. Admins are added and removed only in the Firebase console (Firestore → admins)." },
    { ok: null, title: "Say it in your privacy policy", text: "Tell users that chats are stored on your servers, that you may suspend accounts that break your rules, and that you share data only when the law requires it. Data-protection laws (e.g. India's DPDP Act 2023) expect this." },
    { ok: null, title: "Handle legal requests carefully", text: "Act only on a written order or notice from an authorised agency. Check it's genuine by calling the agency on its official number. Share only what it asks for. The chat viewer records each request in the audit log." },
    { ok: null, title: "Set a real JWT_SECRET", text: "In Render → Environment, set JWT_SECRET (and JWT_REFRESH_SECRET) to long random values. Until then the server refuses its own login tokens, because the default secret is public in the code." },
    { ok: appCheck, title: "Turn on App Check", text: "Stops other people's scripts using your Firebase project with the public API key. Firebase console → App Check → register the web app with reCAPTCHA v3, then set VITE_FIREBASE_APPCHECK_SITE_KEY." },
    { ok: null, title: "Keep backups", text: "Turn on Firestore point-in-time recovery or scheduled backups in Google Cloud, so a mistake or an attack can be undone." },
  ];
  return (
    <div className="vadm-stack">
      <p className="vadm-muted">A checklist to keep VetroAI, your users and you on the safe side. This is practical guidance, not legal advice: for the exact rules in your country, ask a lawyer.</p>
      <ol className="vadm-safety">
        {items.map((it, i) => (
          <li key={it.title} className={it.ok === true ? "is-ok" : it.ok === false ? "is-todo" : ""}>
            <span className="vadm-safety-num">{it.ok === true ? <CheckCircle2 size={18} /> : i + 1}</span>
            <div>
              <strong>{it.title}{it.ok === true && <Pill tone="good">Done</Pill>}{it.ok === false && <Pill tone="warn">To do</Pill>}</strong>
              <p>{it.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── The page ──────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [theme, toggleTheme] = useTheme();
  const [user, setUser] = useState(undefined);
  const [access, setAccess] = useState("loading");
  const [tab, setTab] = useState(() => (TABS.some((t) => `#${t.id}` === window.location.hash) ? window.location.hash.slice(1) : "overview"));
  const [server, setServer] = useState(null);
  const [openUser, setOpenUser] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { document.title = "VetroAI Admin"; consumeRedirectResult(); }, []);
  useEffect(() => (auth ? onAuthStateChanged(auth, setUser) : setUser(null)), []);
  useEffect(() => {
    if (user === undefined) return;
    if (!user) { setAccess("signed-out"); return; }
    setAccess("loading");
    api.checkIsAdmin(user).then((ok) => setAccess(ok ? "admin" : "denied"));
  }, [user]);

  const refreshServer = useCallback(() => {
    api.serverStatus()
      .then((s) => setServer({ ok: true, ...s }))
      .catch((err) => setServer({ ok: false, error: err.message, serviceAccount: false }));
  }, []);
  useEffect(() => { if (access === "admin") refreshServer(); }, [access, refreshServer]);

  const go = (id) => { setTab(id); window.history.replaceState(null, "", `#${id}`); };
  const toast = useCallback((text, tone = "good") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  const closeDialog = useCallback(() => setDialog(null), []);

  const current = useMemo(() => TABS.find((t) => t.id === tab) || TABS[0], [tab]);

  if (access !== "admin") {
    return <Door state={access} onSignIn={() => signInWithGoogle().catch((err) => alert(err.message))} />;
  }

  return (
    <div className="vadm">
      <header className="vadm-top">
        <a className="vadm-brand" href="/admin"><span className="vadm-brand-mark is-small"><ShieldCheck size={17} /></span> VetroAI <span>Admin</span></a>
        <nav className="vadm-tabs" aria-label="Admin sections">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={tab === id ? "is-on" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => go(id)}>
              <Icon size={16} /> <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="vadm-top-right">
          <button type="button" className="vadm-icon-btn" onClick={toggleTheme} title={theme === "dark" ? "Light mode" : "Dark mode"} aria-label="Toggle theme">{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
          <a className="vadm-icon-btn" href="/" title="Back to VetroAI" aria-label="Back to VetroAI"><ArrowLeft size={17} /></a>
          <span className="vadm-me" title={user.email}><Avatar user={{ picture: user.photoURL, name: user.displayName, email: user.email }} size={30} /></span>
        </div>
      </header>

      <main className="vadm-main">
        <div className="vadm-page-head">
          <h1>{current.label}</h1>
          {server?.maintenance && <Pill tone="danger"><Wrench size={12} /> Maintenance on</Pill>}
        </div>
        {tab === "overview" && <Overview server={server} me={user} go={go} onOpenUser={setOpenUser} />}
        {tab === "users" && <UsersTab onOpenUser={setOpenUser} refreshKey={refreshKey} />}
        {tab === "ips" && <IpsTab server={server} ask={setDialog} toast={toast} />}
        {tab === "settings" && <SettingsTab ask={setDialog} toast={toast} onServerRefresh={refreshServer} />}
        {tab === "audit" && <AuditTab onOpenUser={setOpenUser} />}
        {tab === "safety" && <SafetyTab server={server} />}
      </main>

      {openUser && (
        <UserPanel
          key={openUser.uid}
          user={openUser}
          me={user}
          server={server}
          ask={setDialog}
          toast={toast}
          onClose={() => setOpenUser(null)}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      )}
      {dialog && <ActionDialog key={dialog.title} dialog={dialog} onClose={closeDialog} />}
      <div className="vadm-toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`vadm-toast is-${t.tone}`}>{t.tone === "danger" ? <XCircle size={16} /> : <CheckCircle2 size={16} />} {t.text}</div>)}
      </div>
    </div>
  );
}
