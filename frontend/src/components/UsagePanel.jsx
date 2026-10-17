import React, { useCallback, useEffect, useRef, useState } from "react";
import { Clock, RefreshCw, Sparkles } from "lucide-react";
import { authHeaders, formatResetAt, formatResetIn } from "../lib/usageClient";
import "./UsagePanel.css";

// Settings → Usage: the same numbers the server enforces (GET /api/usage).
// A 5-hour session and a weekly limit, a weekly cap for the most capable
// models, and what each model used this week — with live reset times.

const PLAN_NAMES = { free: "Free", pro: "Pro", team: "Team" };
const TIER_LABELS = { light: "Fast", standard: "Balanced", premium: "Most capable" };

function Meter({ title, hint, window, now, idle }) {
  const pct = window?.percent ?? 0;
  const tone = pct >= 100 ? "is-full" : pct >= 80 ? "is-high" : "";
  return (
    <div className="usage-meter">
      <div className="usage-meter-top">
        <div className="usage-meter-text">
          <strong>{title}</strong>
          <span>
            {window?.resetsAt
              ? <>Resets in {formatResetIn(window.resetsAt, now)} <em>· {formatResetAt(window.resetsAt, now)}</em></>
              : idle}
          </span>
        </div>
        <span className={`usage-meter-pct ${tone}`}>{pct}% used</span>
      </div>
      <div className={`usage-bar ${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${title}: ${pct}% used`}>
        <span style={{ width: `${Math.max(pct, pct ? 2 : 0)}%` }} />
      </div>
      {hint && <p className="usage-meter-hint">{hint}</p>}
    </div>
  );
}

export default function UsagePanel({ api }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState(0);
  // The server's clock, so reset times count down correctly even if this
  // device's clock is off.
  const offsetRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${api}/usage`, { headers: authHeaders() });
      const body = await res.json();
      if (!body?.success) throw new Error(body?.message || "Couldn't load usage");
      offsetRef.current = (body.data.serverTime || Date.now()) - Date.now();
      setData(body.data);
      setError("");
      setFetchedAt(Date.now());
    } catch (err) {
      setError(err?.message?.includes("fetch") ? "Couldn't reach VetroAI to load your usage." : err?.message || "Couldn't load usage");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);
  // Tick the countdowns, and refresh from the server every minute and as
  // soon as a window resets.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now() + offsetRef.current), 15000);
    const refresh = setInterval(load, 60000);
    return () => { clearInterval(tick); clearInterval(refresh); };
  }, [load]);
  useEffect(() => {
    const resets = [data?.session?.resetsAt, data?.weekly?.resetsAt].filter(Boolean);
    const next = Math.min(...resets);
    if (!Number.isFinite(next)) return undefined;
    const t = setTimeout(load, Math.max(1000, next - (Date.now() + offsetRef.current) + 1000));
    return () => clearTimeout(t);
  }, [data, load]);

  const weights = Object.fromEntries((data?.tiers || []).map((t) => [t.tier, t.weight]));

  return (
    <div className="modal-body usage-panel">
      <div className="usage-head">
        <div>
          <h3>Plan usage limits</h3>
          <p>{data ? <><span className="usage-plan">{PLAN_NAMES[data.plan] || data.plan}</span>{!data.signedIn && " · signed out — usage is counted for this connection"}</> : "Loading…"}</p>
        </div>
        <button type="button" className="usage-refresh" onClick={load} disabled={loading} aria-label="Refresh usage" title={fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Refresh"}>
          <RefreshCw size={15} className={loading ? "is-spinning" : ""} />
        </button>
      </div>

      {error && !data && <div className="usage-error">{error} <button type="button" onClick={load}>Try again</button></div>}

      {data && (
        <>
          <section className="usage-section">
            <Meter title="Current session" window={data.session} now={now} idle="Starts when you send a message" />
          </section>

          <section className="usage-section">
            <h4>Weekly limits</h4>
            <Meter title="All models" window={data.weekly} now={now} idle="Starts when you send a message" />
            <Meter
              title="Most capable models"
              window={data.premium}
              now={now}
              idle="Not used this week"
              hint="Claude Opus, GPT-5.6 Sol, Claude Fable and DeepSearch share this limit."
            />
            {data.computer && (
              <Meter
                title="VetroAI Computer tasks"
                window={{ ...data.computer, percent: data.computer.percent ?? Math.min(100, Math.round((data.computer.used / data.computer.limit) * 100)) }}
                now={now}
                idle="Not used this week"
                hint={`${data.computer.used} of ${data.computer.limit} this week — folder tools, research → files, websites and screen control.`}
              />
            )}
          </section>

          <section className="usage-section">
            <h4>This week by model</h4>
            {data.models.length === 0 ? (
              <p className="usage-empty"><Sparkles size={15} /> No messages yet this week.</p>
            ) : (
              <ul className="usage-models">
                {data.models.map((m) => (
                  <li key={m.model}>
                    <div className="usage-model-row">
                      <span className="usage-model-name">{m.model}</span>
                      <span className={`usage-tier is-${m.tier}`}>{TIER_LABELS[m.tier]} · ×{m.weight}</span>
                      <span className="usage-model-count">{m.messages} message{m.messages === 1 ? "" : "s"}</span>
                    </div>
                    <div className="usage-model-bar"><span style={{ width: `${Math.max(m.share, 2)}%` }} /></div>
                    <div className="usage-model-meta">
                      {m.share}% of this week's usage{m.sessionMessages ? ` · ${m.sessionMessages} this session` : ""} · last used {new Date(m.lastUsedAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="usage-foot">
            <Clock size={13} /> Each message uses part of your limits: Fast models ×{weights.light || 1}, Balanced ×{weights.standard || 2}, Most capable ×{weights.premium || 4}.
            A session lasts 5 hours from your first message; the week, 7 days. These are the same numbers VetroAI's server enforces. Counting by model started when usage limits were added, so messages from before then aren't included.
          </p>
        </>
      )}
    </div>
  );
}
