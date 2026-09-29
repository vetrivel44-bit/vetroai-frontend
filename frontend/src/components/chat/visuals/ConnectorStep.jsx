import React, { useContext, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, ExternalLink, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { ReplyContext } from "../../../lib/choices";
import { CONNECTORS_BY_ID, TOOLS } from "../../../connectors/catalog";
import { callLabel, describeAction } from "../../../connectors/runtime";
import ConnectorLogo from "../../connectors/ConnectorLogo";
import "./connectorStep.css";

// A ```connector block: one step where the reply used a connected app. The
// step's progress lives on the message (`connector`, via ReplyContext):
//   running    the tool is working
//   done       finished; expands to the emails / files / events it used
//   approval   an "asks first" action waits for Allow or Deny
//   reconnect  Google access ran out; Reconnect runs the step again
//   error, declined, skipped, cancelled   finished without a result

function parseCall(code) {
  try {
    const data = JSON.parse(code);
    return { tool: typeof data?.tool === "string" ? data.tool : "", args: data?.args && typeof data.args === "object" ? data.args : {} };
  } catch {
    return { tool: "", args: {} };
  }
}

const withoutQuestion = (text) => text.replace(/\?$/, "");

export default function ConnectorStep({ code }) {
  const streaming = isStillStreaming(useContext(OpenBlockContext), code);
  const reply = useContext(ReplyContext);
  const call = useMemo(() => parseCall(code), [code]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const step = reply?.connector;
  const stepStatus = step?.status;
  useEffect(() => { setBusy(false); }, [stepStatus]);

  if (streaming) {
    return (
      <div className="vetro-step is-running not-prose">
        <Loader2 size={15} className="vetro-step-spin" /> <span className="vetro-step-label">Getting ready…</span>
      </div>
    );
  }

  const connectorId = TOOLS[call.tool]?.connector;
  const appName = CONNECTORS_BY_ID[connectorId]?.name || "a connector";
  const actions = reply?.isLatest && !reply?.loading ? reply?.onConnector : null;
  let status = step?.status || "stale";
  if ((status === "running" || status === "pending") && !(reply?.isLatest && reply?.loading)) status = "interrupted";
  const act = (fn) => async () => {
    if (!fn || busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  if (status === "approval") {
    const rows = describeAction(call);
    return (
      <div className="vetro-step-card not-prose" role="group" aria-label={callLabel(call, "approval")}>
        <div className="vetro-step-card-head">
          <ConnectorLogo id={connectorId} size={20} />
          <strong>{callLabel(call, "approval")}</strong>
        </div>
        <dl className="vetro-step-rows">
          {rows.map(([label, value]) => (
            <div key={label} className={label === "Message" || label === "Details" ? "is-long" : ""}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {actions ? (
          <div className="vetro-step-actions">
            <span className="vetro-step-note"><ShieldCheck size={14} /> Nothing happens until you allow it.</span>
            <button type="button" className="vetro-step-btn" disabled={busy} onClick={act(() => actions.approve(false))}>Deny</button>
            <button type="button" className="vetro-step-btn is-primary" disabled={busy} onClick={act(() => actions.approve(true))}>Allow</button>
          </div>
        ) : (
          <div className="vetro-step-note">Not approved.</div>
        )}
      </div>
    );
  }

  if (status === "reconnect") {
    const firstTime = step?.error?.code === "scope";
    return (
      <div className="vetro-step-card is-warning not-prose" role="group" aria-label={`Reconnect ${appName}`}>
        <div className="vetro-step-card-head">
          <ConnectorLogo id={connectorId} size={20} />
          <strong>{step?.error?.message || `Your Google access for ${appName} has expired.`}</strong>
        </div>
        {actions ? (
          <div className="vetro-step-actions">
            <span className="vetro-step-note">{firstTime ? "Allow every permission Google asks for." : "Google will reconnect in one click."}</span>
            <button type="button" className="vetro-step-btn" disabled={busy} onClick={act(actions.skip)}>Skip</button>
            <button type="button" className="vetro-step-btn is-primary" disabled={busy} onClick={act(actions.reconnect)}>
              {busy ? <Loader2 size={14} className="vetro-step-spin" /> : <RotateCcw size={14} />} Reconnect and continue
            </button>
          </div>
        ) : (
          <div className="vetro-step-note">Skipped.</div>
        )}
      </div>
    );
  }

  const items = step?.items || [];
  const expandable = status === "done" && items.length > 0;
  let icon = <Check size={14} className="vetro-step-ok" />;
  let label = callLabel(call, "done");
  let detail = step?.summary;
  if (status === "running" || status === "pending") {
    icon = <Loader2 size={14} className="vetro-step-spin" />;
    label = `${callLabel(call, "running")}…`;
    detail = null;
  } else if (status === "error") {
    icon = <AlertTriangle size={14} className="vetro-step-bad" />;
    label = step?.error?.message || `Couldn't use ${appName}.`;
    detail = null;
  } else if (status === "declined") {
    icon = <AlertTriangle size={14} className="vetro-step-muted" />;
    label = `You declined: ${withoutQuestion(callLabel(call, "approval")).replace(/^(\w)/, (c) => c.toLowerCase())}`;
    detail = null;
  } else if (status === "skipped" || status === "cancelled" || status === "interrupted" || status === "stale") {
    icon = <AlertTriangle size={14} className="vetro-step-muted" />;
    label = { skipped: "Skipped", cancelled: "Stopped", interrupted: "Didn't finish", stale: "Wanted to use" }[status] + ` ${appName}`;
    detail = null;
  }

  return (
    <div className={`vetro-step not-prose is-${status}`}>
      <button
        type="button"
        className="vetro-step-row"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
      >
        <ConnectorLogo id={connectorId} size={16} />
        {icon}
        <span className="vetro-step-label">{label}</span>
        {detail && <span className="vetro-step-detail">· {detail}</span>}
        {expandable && <ChevronRight size={14} className={`vetro-step-chevron${open ? " is-open" : ""}`} />}
      </button>
      {status === "interrupted" && actions && (
        <button type="button" className="vetro-step-btn is-inline" disabled={busy} onClick={act(actions.retry)}>
          <RotateCcw size={13} /> Try again
        </button>
      )}
      {expandable && open && (
        <ul className="vetro-step-items">
          {items.map((item, i) => (
            <li key={i}>
              {/^https:\/\//.test(item.link || "") ? (
                <a href={item.link} target="_blank" rel="noopener noreferrer">{item.title} <ExternalLink size={12} /></a>
              ) : <span>{item.title}</span>}
              {item.detail && <small>{item.detail}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
