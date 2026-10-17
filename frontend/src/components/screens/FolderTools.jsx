import React, { useMemo, useState } from "react";
import { ArrowRight, Check, FileSpreadsheet, FolderOpen, Loader2, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { FOLDER_ACTIONS } from "../../lib/folderActions";

// Folder tools in VetroAI Computer: one-tap actions on the folder the user
// opened, and the card that shows a plan of changes — every move and rename,
// each with a tick box — before anything is touched, then applies it and
// offers to undo all of it.


export function FolderActions({ onAction, disabled, folderName }) {
  return (
    <div className="cw-folder-tools">
      <div className="cw-folder-tools-head"><FolderOpen size={14} /> Work on <strong>{folderName}</strong><span>Nothing changes until you approve it</span></div>
      <div className="cw-folder-tools-grid">
        {FOLDER_ACTIONS.map(({ id, icon, title, detail }) => (
          <button key={id} type="button" disabled={disabled} onClick={() => onAction(id)} className="cw-folder-tool">
            {React.createElement(icon, { size: 17 })}
            <span><strong>{title}</strong><small>{detail}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}

const fmtCount = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function OpRow({ op, checked, onToggle, state }) {
  const fromDir = op.from.includes("/") ? op.from.slice(0, op.from.lastIndexOf("/") + 1) : "";
  return (
    <label className={`cw-op${state ? ` is-${state}` : ""}`}>
      {onToggle ? <input type="checkbox" checked={checked} onChange={onToggle} /> : <span className="cw-op-state">{state === "done" ? <Check size={13} /> : state === "failed" ? <TriangleAlert size={13} /> : null}</span>}
      <span className="cw-op-paths">
        <span className="cw-op-from" title={op.from}><em>{fromDir}</em>{op.from.slice(fromDir.length)}</span>
        <ArrowRight size={12} className="cw-op-arrow" />
        <span className="cw-op-to" title={op.to}>{op.to}</span>
      </span>
      {op.why && <span className="cw-op-why">{op.error || op.why}</span>}
    </label>
  );
}

/**
 * message.folder = { status: "planning" | "ready" | "applying" | "applied" | "undoing" | "undone" | "failed",
 *   folderName, title, summary, ops: [{from, to, why}], selected: [bool], skipped, progress: {n, total, label},
 *   result: {done, failed, createdDirs}, error }
 */
export function FolderPlanCard({ message, workspaceName, onToggle, onToggleAll, onApply, onUndo, onReconnect }) {
  const f = message.folder || {};
  const [showAll, setShowAll] = useState(false);
  const selectedCount = useMemo(() => (f.selected || []).filter(Boolean).length, [f.selected]);
  const ops = f.ops || [];
  const LIMIT = 60;
  const visible = showAll ? ops : ops.slice(0, LIMIT);
  const doneSet = useMemo(() => new Set((f.result?.done || []).map((o) => o.from)), [f.result]);
  const failedMap = useMemo(() => new Map((f.result?.failed || []).map((o) => [o.from, o.error])), [f.result]);
  const connected = workspaceName && workspaceName === f.folderName;

  if (f.status === "planning" || f.status === "failed" && !ops.length) {
    return (
      <div className="cw-folder-card">
        <div className="cw-folder-card-head">
          {f.status === "failed" ? <TriangleAlert size={16} /> : <Loader2 size={16} className="animate-spin" />}
          <strong>{f.status === "failed" ? "Couldn't make a plan" : f.progress?.label || "Reading the folder…"}</strong>
        </div>
        {f.status === "failed" ? <p className="cw-folder-note">{f.error}</p> : f.progress?.total ? (
          <div className="cw-folder-progress"><span style={{ width: `${Math.round((f.progress.n / f.progress.total) * 100)}%` }} /></div>
        ) : null}
      </div>
    );
  }

  const editable = f.status === "ready";
  return (
    <div className="cw-folder-card">
      <div className="cw-folder-card-head">
        <Sparkles size={16} />
        <strong>{f.title}</strong>
        <span className="cw-folder-badge">{fmtCount(ops.length, "change")}</span>
      </div>
      {f.summary && <p className="cw-folder-note">{f.summary}</p>}
      {ops.length === 0 ? (
        <p className="cw-folder-note"><Check size={14} /> Nothing to change — the folder is already in order.</p>
      ) : (
        <>
          {editable && (
            <div className="cw-folder-select">
              <button type="button" onClick={() => onToggleAll(selectedCount !== ops.length)}>{selectedCount === ops.length ? "Untick all" : "Tick all"}</button>
              <span>{fmtCount(selectedCount, "change")} will be made in <strong>{f.folderName}</strong>. Nothing is deleted or overwritten.</span>
            </div>
          )}
          <div className="cw-op-list">
            {visible.map((op, i) => (
              <OpRow
                key={`${op.from}-${i}`}
                op={failedMap.has(op.from) ? { ...op, error: failedMap.get(op.from) } : op}
                checked={!!f.selected?.[i]}
                onToggle={editable ? () => onToggle(i) : null}
                state={doneSet.has(op.from) && f.status === "applied" ? "done" : failedMap.has(op.from) ? "failed" : !editable && !f.selected?.[i] ? "skipped" : null}
              />
            ))}
          </div>
          {ops.length > LIMIT && <button type="button" className="cw-folder-more" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${ops.length.toLocaleString()}`}</button>}
        </>
      )}
      {f.skipped > 0 && <p className="cw-folder-note is-muted">{fmtCount(f.skipped, "suggested change")} left out — unsafe or not possible.</p>}

      {(f.status === "applying" || f.status === "undoing") && (
        <div className="cw-folder-applying">
          <Loader2 size={14} className="animate-spin" /> {f.status === "applying" ? "Applying" : "Undoing"} {f.progress?.n || 0} of {f.progress?.total || 0}…
          <div className="cw-folder-progress"><span style={{ width: `${f.progress?.total ? Math.round((f.progress.n / f.progress.total) * 100) : 0}%` }} /></div>
        </div>
      )}
      {f.status === "applied" && (
        <div className="cw-folder-result">
          <Check size={15} /> {fmtCount(f.result?.done?.length || 0, "file")} changed in {f.folderName}
          {f.result?.failed?.length ? <span className="is-warn"> · {f.result.failed.length} couldn't be changed</span> : null}
        </div>
      )}
      {f.status === "undone" && <div className="cw-folder-result"><RotateCcw size={15} /> Undone — every file is back where it was.</div>}

      <div className="cw-folder-actions">
        {editable && ops.length > 0 && (connected
          ? <button type="button" className="is-primary" disabled={!selectedCount} onClick={onApply}><Check size={15} /> Apply {fmtCount(selectedCount, "change")}</button>
          : <button type="button" className="is-primary" onClick={onReconnect}><FolderOpen size={15} /> Open “{f.folderName}” again to apply</button>)}
        {f.status === "applied" && (f.result?.done?.length > 0) && (connected
          ? <button type="button" onClick={onUndo}><RotateCcw size={15} /> Undo all</button>
          : <button type="button" onClick={onReconnect}><FolderOpen size={15} /> Open “{f.folderName}” again to undo</button>)}
      </div>
    </div>
  );
}

/** message.report = { status, folderName, file, rows: [[header…], …], progress, error } */
export function FolderReportCard({ message, onDownload }) {
  const r = message.report || {};
  if (r.status !== "done") {
    return (
      <div className="cw-folder-card">
        <div className="cw-folder-card-head">
          {r.status === "failed" ? <TriangleAlert size={16} /> : <Loader2 size={16} className="animate-spin" />}
          <strong>{r.status === "failed" ? "Couldn't summarise the documents" : r.progress?.label || "Reading the documents…"}</strong>
        </div>
        {r.status === "failed" ? <p className="cw-folder-note">{r.error}</p> : r.progress?.total ? (
          <div className="cw-folder-progress"><span style={{ width: `${Math.round((r.progress.n / r.progress.total) * 100)}%` }} /></div>
        ) : null}
      </div>
    );
  }
  const [header, ...rows] = r.rows || [];
  return (
    <div className="cw-folder-card">
      <div className="cw-folder-card-head">
        <FileSpreadsheet size={16} />
        <strong>{rows.length} document{rows.length === 1 ? "" : "s"} summarised</strong>
      </div>
      <p className="cw-folder-note"><Check size={14} /> {r.savedToFolder ? <>Saved <strong>{r.file}</strong> in {r.folderName}</> : <>Ready to download as <strong>{r.file}</strong></>}</p>
      <div className="cw-report-table">
        <table>
          <thead><tr>{header.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.slice(0, 50).map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} title={cell}>{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="cw-folder-actions">
        <button type="button" className="is-primary" onClick={onDownload}><FileSpreadsheet size={15} /> Download spreadsheet</button>
      </div>
    </div>
  );
}
