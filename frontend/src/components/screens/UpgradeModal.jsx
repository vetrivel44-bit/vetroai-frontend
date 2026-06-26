import React, { useEffect, useState } from 'react';
import { Check, X, Zap, Crown, Users2, Loader2, AlertCircle } from 'lucide-react';

let baseApi = "/api";
if (!import.meta.env.DEV && import.meta.env.VITE_API_BASE_URL) {
  baseApi = import.meta.env.VITE_API_BASE_URL;
}
if (baseApi.startsWith("http") && !baseApi.endsWith("/api")) {
  baseApi = baseApi.replace(/\/+$/, "") + "/api";
}
const API = baseApi;

const PLAN_ICON = { free: Zap, pro: Crown, team: Users2 };
const PLAN_ACCENT = { free: "var(--ink-3)", pro: "#3b82f6", team: "#8B5CF6" };

export default function UpgradeModal({ onClose, currentPlan = "free" }) {
  const [plans, setPlans] = useState(null);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busyPlan, setBusyPlan] = useState(null);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(API + "/billing/plans")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.success === false) throw new Error(data.message || "Failed to load plans");
        setPlans(data.data.plans);
        setPaymentsEnabled(Boolean(data.data.paymentsEnabled));
      })
      .catch((err) => !cancelled && setLoadError(err.message || "Couldn't reach the server."));
    return () => { cancelled = true; };
  }, []);

  const handleUpgrade = async (planId) => {
    setActionError("");
    const token = localStorage.getItem("token");
    if (!token || token.startsWith("local_")) {
      setActionError("Sign in with an account (not offline mode) to upgrade your plan.");
      return;
    }
    setBusyPlan(planId);
    try {
      const res = await fetch(API + "/billing/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.message || "Couldn't start checkout.");
      window.location.href = data.data.url;
    } catch (err) {
      setActionError(err.message || "Something went wrong. Please try again.");
      setBusyPlan(null);
    }
  };

  return (
    <div className="overlay" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal upgrade-modal" style={{ width: 820, maxWidth: '95vw', maxHeight: '90vh', padding: '32px 20px', background: 'var(--bg)', color: 'var(--ink)', position: 'relative', overflowY: 'auto', boxSizing: 'border-box' }}>
        <button className="modal-x" onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', minWidth: 36, minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X size={24} />
        </button>

        <div style={{ textAlign: 'center', marginBottom: 32, padding: '0 32px' }}>
          <h2 style={{ fontSize: 'clamp(1.4rem, 5vw, 2rem)', fontWeight: 700, margin: '0 0 10px 0' }}>Upgrade your VetroAI Experience</h2>
          <p style={{ color: 'var(--ink-2)', fontSize: '1.05rem', margin: 0 }}>Choose the plan that fits your productivity needs.</p>
        </div>

        {!paymentsEnabled && !loadError && (
          <div className="upgrade-banner">
            <AlertCircle size={16} />
            Online payments aren't connected yet — plans are previewed below and will go live shortly.
          </div>
        )}
        {actionError && (
          <div className="upgrade-banner upgrade-banner-error">
            <AlertCircle size={16} />
            {actionError}
          </div>
        )}
        {loadError && (
          <div className="upgrade-banner upgrade-banner-error">
            <AlertCircle size={16} />
            {loadError}
          </div>
        )}

        {!plans && !loadError && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0', color: 'var(--ink-3)' }}>
            <Loader2 size={22} className="spin" />
          </div>
        )}

        {plans && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 20 }}>
            {plans.map((plan) => {
              const Icon = PLAN_ICON[plan.id] || Zap;
              const accent = PLAN_ACCENT[plan.id] || 'var(--ink-3)';
              const isCurrent = currentPlan === plan.id;
              const isFree = plan.id === 'free';
              const canBuy = !isFree && paymentsEnabled && plan.purchasable;
              const busy = busyPlan === plan.id;

              return (
                <div
                  key={plan.id}
                  className={`upgrade-card${plan.popular ? ' upgrade-card-popular' : ''}`}
                  style={{ borderColor: plan.popular ? accent : 'var(--border)' }}
                >
                  {plan.popular && (
                    <div className="upgrade-card-badge" style={{ background: accent }}>
                      <Zap size={12} fill="white" /> MOST POPULAR
                    </div>
                  )}
                  <h3 style={{ fontSize: '1.15rem', margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: 8, color: plan.popular ? accent : 'var(--ink)' }}>
                    <Icon size={18} /> {plan.name}
                  </h3>
                  <div style={{ fontSize: '2rem', fontWeight: 700, marginBottom: 20 }}>
                    ${plan.priceMonthly}
                    <span style={{ fontSize: '1rem', color: 'var(--ink-3)', fontWeight: 400 }}>{plan.perSeat ? '/user/mo' : '/mo'}</span>
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 30px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {plan.features.map((f) => (
                      <li key={f} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: '0.92rem' }}>
                        <Check size={16} color="#10b981" style={{ marginTop: 2, flexShrink: 0 }} /> {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    className="upgrade-cta-btn"
                    disabled={isCurrent || (!isFree && !canBuy) || busy}
                    onClick={() => !isFree && handleUpgrade(plan.id)}
                    style={
                      isCurrent
                        ? { background: 'transparent', border: '1px solid var(--border)', color: 'var(--ink)', cursor: 'not-allowed' }
                        : plan.popular
                        ? { background: accent, border: 'none', color: 'white' }
                        : { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }
                    }
                  >
                    {busy ? <Loader2 size={15} className="spin" /> : null}
                    {isCurrent ? 'Current Plan' : busy ? 'Redirecting…' : isFree ? 'Free Plan' : !paymentsEnabled ? 'Coming Soon' : `Upgrade to ${plan.name}`}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
