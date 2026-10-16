import React, { useEffect, useState } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import { WINDOW_TITLES, formatResetAt, formatResetIn } from "../lib/usageClient";
import "./UsagePanel.css";

// Shown in place of a reply when a usage limit is used up: which limit, a
// live countdown to its reset, and the way to Settings → Usage.
export default function UsageLimitNotice({ limit, onOpenUsage }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  const reset = !limit?.resetsAt || now >= limit.resetsAt;
  return (
    <div className={`usage-limit-card not-prose${reset ? " is-reset" : ""}`} role="status">
      <span className="usage-limit-icon">{reset ? <CheckCircle2 size={18} /> : <Clock size={18} />}</span>
      <div className="usage-limit-body">
        <strong>{reset ? "Your limit has reset" : `You've reached your ${(WINDOW_TITLES[limit.window] || "usage limit").toLowerCase()}`}</strong>
        <p>
          {reset
            ? "You can send messages again."
            : <>It resets in <b>{formatResetIn(limit.resetsAt, now)}</b> ({formatResetAt(limit.resetsAt, now)}).{limit.window === "premium" ? " Lighter models still work until then." : ""}</>}
        </p>
        {onOpenUsage && (
          <div className="usage-limit-actions">
            <button type="button" onClick={onOpenUsage}>View usage</button>
          </div>
        )}
      </div>
    </div>
  );
}
