import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Ban, Check, CheckCircle2, Clock3, Copy, Laptop, Link2, Loader2, Monitor, QrCode, RotateCw, Send, ShieldAlert, Smartphone, Trash2, TriangleAlert, X,
} from "lucide-react";
import QRCode from "qrcode";
import { announcePhone, forgetDevice, removeDispatch, sendDispatch, updateDispatch, watchDevices, watchDispatches } from "../../lib/dispatch";
import { watchAuthState } from "../../lib/firebaseAuth";
import {
  FINISHED, MAX_DISPATCH_TEXT, clearPair, describeDispatch, formatAgo, isComputerDevice, isOnline, maskEmail, pairLink,
  pairMatchesAccount, peekPair, phoneLabel,
} from "../../lib/dispatchCore";

// Computer → Dispatch: one ongoing thread with VetroAI on your computer. Send a
// task from anywhere (usually your phone); the computer does it and the
// result comes back here.

const EXAMPLES = [
  "Research the best 5G phones under ₹30,000 and make me a comparison table",
  "Build a simple landing page for my bakery, “Sweet Crumbs”",
  "Open Notepad and write my shopping list: milk, eggs, bread",
];

function notify(title, body) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted" || !document.hidden) return;
    new Notification(title, { body: body.slice(0, 140), icon: "/favicon.ico" });
  } catch { /* notifications unavailable */ }
}

const TARGET_KEY = "vetroai_dispatch_target";
const readTarget = () => { try { return localStorage.getItem(TARGET_KEY) || "any"; } catch { return "any"; } };
const saveTarget = (id) => { try { localStorage.setItem(TARGET_KEY, id); } catch { /* storage unavailable */ } };

// On the computer: a QR code of a link that opens Dispatch on the phone, aimed
// at this computer. Shows when the phone has opened it.
function ConnectPhone({ uid, deviceId, devices, now, onClose }) {
  const [email, setEmail] = useState("");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const openedAt = useRef(Date.now());
  useEffect(() => watchAuthState((u) => setEmail(u?.email || "")), []);
  const link = useMemo(() => pairLink(window.location.origin, { deviceId, uid, email }), [deviceId, uid, email]);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(link, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then((url) => { if (alive) setQr(url); })
      .catch(() => { if (alive) setQr(""); });
    return () => { alive = false; };
  }, [link]);
  const joined = devices.find((d) => d.kind === "phone" && d.pairedWith === deviceId && d.pairedAt >= openedAt.current - 5000);
  const copy = () => {
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  };
  return (
    <div className="cw-dsp-pair" role="dialog" aria-label="Connect your phone">
      <button type="button" className="cw-dsp-pair-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
      <div className="cw-dsp-pair-qr">
        {joined
          ? <div className="cw-dsp-pair-ok"><CheckCircle2 size={40} /><strong>{joined.name} connected</strong><small>{formatAgo(joined.pairedAt, now)}</small></div>
          : qr ? <img src={qr} alt="QR code to open Dispatch on your phone" width={200} height={200} /> : <Loader2 size={22} className="animate-spin" />}
      </div>
      <div className="cw-dsp-pair-text">
        <strong>{joined ? "Your phone is connected" : "Connect your phone"}</strong>
        <ol>
          <li>Scan this code with your phone's camera.</li>
          <li>Sign in{email ? <> as <b>{maskEmail(email)}</b></> : ""} if it asks — the same account as this computer.</li>
          <li>Send a task. It runs here and the result comes back to your phone.</li>
        </ol>
        <small>Keep VetroAI open on this computer, in Computer. Tip: on the phone, "Add to Home Screen" makes it one tap next time.</small>
        <button type="button" className="cw-dsp-pair-copy" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Link copied" : "Copy link instead"}</button>
      </div>
    </div>
  );
}

function StatusIcon({ status }) {
  if (status === "done") return <CheckCircle2 size={15} className="is-ok" />;
  if (status === "failed") return <TriangleAlert size={15} className="is-fail" />;
  if (status === "cancelled") return <Ban size={15} />;
  if (status === "awaiting_approval") return <ShieldAlert size={15} className="is-wait" />;
  if (status === "running" || status === "claimed") return <Loader2 size={15} className="animate-spin" />;
  return <Clock3 size={15} />;
}

function DispatchItem({ d, devices, now, onApprove, onDecline, onCancel, onRetry, onDelete }) {
  const finished = FINISHED.has(d.status);
  return (
    <div className="cw-dsp-item">
      <div className="cw-dsp-ask">
        <p>{d.text}</p>
        <small>{d.from ? `${d.from} · ` : ""}{formatAgo(d.createdAt, now)}</small>
      </div>
      <div className={`cw-dsp-reply is-${d.status}`}>
        <div className="cw-dsp-status">
          <StatusIcon status={d.status} />
          <span>{describeDispatch(d, devices, now)}</span>
          {d.status === "running" && d.stepsTotal > 0 && <em>{Math.min(d.stepsDone + 1, d.stepsTotal)}/{d.stepsTotal}</em>}
        </div>
        {d.status === "awaiting_approval" && (
          <div className="cw-dsp-approve">
            <p>{d.approvalReason || "This may send, buy, post, open or change something for you."} Should your computer go ahead?</p>
            <div>
              <button type="button" className="is-ghost" onClick={() => onDecline(d)}><X size={14} /> Don't do it</button>
              <button type="button" className="is-primary" onClick={() => onApprove(d)}><Check size={14} /> Go ahead</button>
            </div>
          </div>
        )}
        {d.status === "done" && d.result && (
          <div className="cw-dsp-result"><ReactMarkdown remarkPlugins={[remarkGfm]}>{d.result}</ReactMarkdown></div>
        )}
        {d.status === "failed" && d.result && d.result !== d.error && (
          <div className="cw-dsp-result is-muted"><ReactMarkdown remarkPlugins={[remarkGfm]}>{d.result}</ReactMarkdown></div>
        )}
        <div className="cw-dsp-actions">
          {!finished && d.status !== "awaiting_approval" && (
            <button type="button" onClick={() => onCancel(d)} disabled={d.cancelRequested}>
              {d.cancelRequested ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} {d.cancelRequested ? "Stopping…" : "Cancel"}
            </button>
          )}
          {finished && d.status !== "done" && <button type="button" onClick={() => onRetry(d)}><RotateCw size={13} /> Send again</button>}
          {finished && <button type="button" onClick={() => onDelete(d)} className="is-danger" title="Remove from this thread"><Trash2 size={13} /></button>}
        </div>
      </div>
    </div>
  );
}

export default function DispatchPanel({ uid, deviceId, accepting, onAcceptingChange, isComputer, onBusy }) {
  const [dispatches, setDispatches] = useState(null);
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [target, setTargetState] = useState(readTarget);
  const setTarget = (id) => { setTargetState(id); saveTarget(id); };
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [showPair, setShowPair] = useState(false);
  // Set when this phone opened a computer's pairing link: { ok, name } or { ok: false, as }.
  const [paired, setPaired] = useState(null);
  const pending0 = useRef(peekPair());
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef(new Map());
  const endRef = useRef(null);

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(id); }, []);

  useEffect(() => {
    if (!uid) return undefined;
    const fail = (err) => setError(err?.code === "permission-denied"
      ? "Dispatch isn't switched on for this account yet (the database rules need deploying — see DEPLOY.md)."
      : err?.message || "Couldn't reach Dispatch.");
    const offA = watchDispatches(uid, (list) => {
      setError("");
      // A ping when something finishes while you're looking at another app.
      for (const d of list) {
        const before = seen.current.get(d.id);
        if (before && before !== d.status && FINISHED.has(d.status) && d.status !== "cancelled") {
          notify(d.status === "done" ? "VetroAI finished a task" : "VetroAI couldn't finish a task", d.text);
        }
        seen.current.set(d.id, d.status);
      }
      setDispatches(list);
    }, fail);
    const offB = watchDevices(uid, (list) => { setDevices(list); setDevicesLoaded(true); }, fail);
    return () => { offA(); offB(); };
  }, [uid]);

  const thread = useMemo(() => [...(dispatches || [])].reverse(), [dispatches]);
  const computers = useMemo(() => devices.filter((d) => isComputerDevice(d) && (d.id !== deviceId || accepting)), [devices, deviceId, accepting]);
  const phones = useMemo(() => devices.filter((d) => !isComputerDevice(d)), [devices]);

  // This phone opened a computer's pairing link: aim at that computer and tell it.
  useEffect(() => {
    const pair = pending0.current;
    if (!pair || !uid || !devicesLoaded) return;
    pending0.current = null;
    clearPair();
    if (!pairMatchesAccount(pair, uid)) { setPaired({ ok: false, as: pair.as }); return; }
    const computer = devices.find((d) => d.id === pair.deviceId);
    setTargetState(pair.deviceId); saveTarget(pair.deviceId);
    setPaired({ ok: true, name: computer?.name || "your computer" });
    if (pair.deviceId !== deviceId) {
      announcePhone(uid, { id: deviceId, name: phoneLabel(navigator.userAgent), pairedWith: pair.deviceId }).catch(() => {});
    }
  }, [uid, devicesLoaded, devices, deviceId]);
  const online = computers.filter((d) => isOnline(d, now));
  const pending = (dispatches || []).filter((d) => !FINISHED.has(d.status)).length;
  useEffect(() => { onBusy?.(pending); }, [pending, onBusy]);
  // Keeps the newest card in view as it changes (an approval prompt, a result).
  const last = thread[thread.length - 1];
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [thread.length, last?.status]);
  // A computer picked earlier that has since been forgotten falls back to "any".
  // Waits for the device list, or a remembered computer would be dropped before it loads.
  useEffect(() => {
    if (devicesLoaded && target !== "any" && !computers.some((d) => d.id === target)) { setTargetState("any"); saveTarget("any"); }
  }, [computers, target, devicesLoaded]);

  const send = async (e, value = text) => {
    e?.preventDefault();
    const task = value.trim();
    if (!task || !uid || sending) return;
    setSending(true);
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch?.(() => {});
      const from = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? "From your phone" : isComputer ? "From this computer" : "From your browser";
      await sendDispatch(uid, { text: task, target, from });
      setText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };
  const act = (fn) => fn().catch((err) => setError(err.message));

  if (!uid) {
    return (
      <section className="cowork-home-scroll">
        <div className="cw-sched">
          <div className="cw-sched-empty">
            <Smartphone size={26} />
            <strong>Sign in to use Dispatch</strong>
            <span>Dispatch links your phone and your computer through your VetroAI account. Sign in on both, with the same account{pending0.current?.as ? <> — <b>{pending0.current.as}</b></> : ""}.</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="cowork-home-scroll cw-dsp-scroll">
      <div className="cw-sched cw-dsp">
        <div className="cw-sched-head">
          <div>
            <h1 className="cowork-title" style={{ fontSize: 30, marginBottom: 4 }}>Dispatch</h1>
            <p className="cowork-subtitle" style={{ margin: 0 }}>Send a task from your phone. VetroAI does it on your computer and the finished work comes back here.</p>
          </div>
          {isComputer && !showPair && (
            <button type="button" className="cw-dsp-pair-btn" onClick={() => { onAcceptingChange(true); setShowPair(true); }}>
              <QrCode size={15} /> Connect phone
            </button>
          )}
        </div>

        {showPair && isComputer && <ConnectPhone uid={uid} deviceId={deviceId} devices={devices} now={now} onClose={() => setShowPair(false)} />}

        {paired && (
          <div className={`cw-dsp-paired${paired.ok ? "" : " is-bad"}`} role="status">
            {paired.ok ? <Link2 size={16} /> : <TriangleAlert size={16} />}
            <span>{paired.ok
              ? <>Connected to <strong>{paired.name}</strong>. Tasks you send here run there.</>
              : <>This code is for a different VetroAI account{paired.as ? <> (<strong>{paired.as}</strong>)</> : ""}. Sign out, sign in with that account and scan it again.</>}</span>
            <button type="button" onClick={() => setPaired(null)} aria-label="Dismiss"><X size={14} /></button>
          </div>
        )}

        <div className="cw-dsp-devices">
          {isComputer && (
            <label className={`cw-dsp-host${accepting ? " is-on" : ""}`}>
              <Monitor size={18} />
              <span>
                <strong>Accept tasks on this computer</strong>
                <small>{accepting ? "On — keep VetroAI open here, in Computer. Tasks that need approval ask on your phone first." : "Turn on to let tasks sent from your phone run here."}</small>
              </span>
              <input type="checkbox" role="switch" checked={accepting} onChange={(e) => onAcceptingChange(e.target.checked)} />
            </label>
          )}
          {computers.filter((d) => d.id !== deviceId).map((d) => (
            <div key={d.id} className="cw-dsp-device">
              <Laptop size={16} />
              <span>{d.name}{d.busy ? " · working" : ""}</span>
              <i className={isOnline(d, now) ? "is-on" : ""} />
              <small>{isOnline(d, now) ? "Online" : d.lastSeen ? `Last seen ${formatAgo(d.lastSeen, now)}` : "Offline"}</small>
            </div>
          ))}
          {isComputer && phones.map((d) => (
            <div key={d.id} className="cw-dsp-device">
              <Smartphone size={16} />
              <span>{d.name}</span>
              <small>Connected {formatAgo(d.pairedAt, now)}</small>
              <button type="button" className="cw-dsp-forget" onClick={() => act(() => forgetDevice(uid, d.id))} title="Forget this phone" aria-label={`Forget ${d.name}`}><X size={13} /></button>
            </div>
          ))}
          {!isComputer && computers.length === 0 && (
            <div className="cw-sched-banner">
              <TriangleAlert size={15} />
              <span>No computer is set up yet. On your PC, open the <strong>VetroAI desktop app</strong> (or VetroAI in a browser), sign in with this account, go to <strong>Computer → Dispatch</strong> and tap <strong>Connect phone</strong>, then scan the code with this phone. You can send tasks now — they wait until it's on.</span>
            </div>
          )}
        </div>

        {error && <p className="cw-sched-error"><TriangleAlert size={14} /> {error}</p>}
        {dispatches === null && !error && <p className="cw-sched-muted"><Loader2 size={15} className="animate-spin" /> Loading…</p>}

        {dispatches?.length === 0 && (
          <div className="cw-sched-empty">
            <Send size={24} />
            <strong>Nothing sent yet</strong>
            <span>Try one of these:</span>
            <div className="cw-sched-examples">
              {EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => setText(ex)}>{ex}</button>)}
            </div>
          </div>
        )}

        <div className="cw-dsp-thread">
          {thread.map((d) => (
            <DispatchItem
              key={d.id}
              d={d}
              devices={devices}
              now={now}
              onApprove={(x) => act(() => updateDispatch(uid, x.id, { status: "queued", approved: true }))}
              onDecline={(x) => act(() => updateDispatch(uid, x.id, { status: "cancelled", error: "You said not to." }))}
              onCancel={(x) => act(() => (x.status === "queued" || x.status === "awaiting_approval"
                ? updateDispatch(uid, x.id, { status: "cancelled", cancelRequested: true })
                : updateDispatch(uid, x.id, { cancelRequested: true })))}
              onRetry={(x) => send(null, x.text)}
              onDelete={(x) => act(() => removeDispatch(uid, x.id))}
            />
          ))}
        </div>

        <form className="cw-dsp-composer" onSubmit={send}>
          <textarea
            rows={2}
            value={text}
            maxLength={MAX_DISPATCH_TEXT}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) send(e); }}
            placeholder={online.length ? "What should your computer do?" : "What should your computer do? It'll start once your computer is on."}
          />
          <div className="cw-dsp-composer-row">
            {computers.length > 1 ? (
              <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Which computer">
                <option value="any">Any computer</option>
                {computers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.id === deviceId ? " (this one)" : ""}</option>)}
              </select>
            ) : (
              <span className="cw-dsp-to"><i className={online.length ? "is-on" : ""} />{online.length ? `To ${online[0].name}` : "Your computer is offline"}</span>
            )}
            <button type="submit" disabled={!text.trim() || sending} aria-label="Send to your computer">
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </form>
        {/* After the composer: it is sticky, so scrolling here shows the last card above it. */}
        <div ref={endRef} />
      </div>
    </section>
  );
}
