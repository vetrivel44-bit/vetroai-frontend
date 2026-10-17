import React, { useState } from "react";
import { Check, ChevronDown, FileSpreadsheet, FileText, Loader2, Presentation, TriangleAlert, Download } from "lucide-react";
import ResearchActivity from "../ResearchActivity";
import LiveBrowser from "./LiveBrowser";
import SlidesBlock from "../chat/visuals/SlidesBlock";
import { parseDeck, buildPptx, deckFileName } from "../../lib/slides";
import { exportDocx, exportPdf, xlsxBlobFromMarkdown } from "../../lib/documentExport";

// VetroAI Computer's research-to-file run: the DeepSearch as it happens, then
// the files made from its report — a deck to flip through, the spreadsheet
// data, the report — each a tap from the file itself.
//
// message.run = { status: "researching" | "making" | "done" | "failed", title,
//   research, report, want: {slides, sheet, doc},
//   slides: { status, code, error }, sheet: { status, markdown, error }, error }

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const safeName = (s) => String(s || "VetroAI research").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

function Phase({ state, label, detail }) {
  return (
    <li className={`cw-run-phase is-${state}`}>
      <span className="cw-run-phase-icon">
        {state === "done" ? <Check size={13} /> : state === "active" ? <Loader2 size={13} className="animate-spin" /> : state === "failed" ? <TriangleAlert size={13} /> : null}
      </span>
      <span>{label}{detail && <small>{detail}</small>}</span>
    </li>
  );
}

function FileTile({ icon: TileIcon, name, kind, ready, onDownload, busy }) {
  return (
    <button type="button" className="cw-file-tile" disabled={!ready || busy} onClick={onDownload}>
      <span className={`cw-file-tile-icon is-${kind}`}>{React.createElement(TileIcon, { size: 18 })}</span>
      <span className="cw-file-tile-text"><strong>{name}</strong><small>{busy ? "Preparing…" : ready ? `.${kind}` : "Not ready"}</small></span>
      {ready && !busy && <Download size={15} className="cw-file-tile-dl" />}
    </button>
  );
}

export default function ResearchRun({ message, live, renderReport }) {
  const run = message.run || {};
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [showReport, setShowReport] = useState(false);
  const title = safeName(run.title);

  const researchState = run.status === "researching" ? "active" : run.report ? "done" : run.status === "failed" ? "failed" : "pending";
  const making = run.status === "making";
  const stateOf = (part) => (!part ? "pending" : part.status === "done" ? "done" : part.status === "failed" ? "failed" : making ? "active" : "pending");

  const save = async (kind) => {
    setBusy(kind);
    setError("");
    try {
      if (kind === "pptx") {
        const { default: PptxGenJS } = await import("pptxgenjs");
        const deck = parseDeck(run.slides.code);
        await buildPptx(deck, PptxGenJS).writeFile({ fileName: deckFileName(deck) });
      } else if (kind === "xlsx") {
        saveBlob(await xlsxBlobFromMarkdown(run.sheet.markdown), `${title}.xlsx`);
      } else if (kind === "docx") {
        await exportDocx(`# ${title}\n\n${run.report}`);
      } else if (kind === "pdf") {
        await exportPdf(`# ${title}\n\n${run.report}`);
      }
    } catch (err) {
      setError(`Couldn't create the file (${err?.message || err}).`);
    } finally {
      setBusy("");
    }
  };

  const done = run.status === "done";
  return (
    <div className="cw-run">
      <ol className="cw-run-phases">
        <Phase state={researchState} label="Research the web" detail={run.research?.sources ? `${run.research.sources} sources` : ""} />
        <Phase state={run.report ? "done" : researchState === "active" && run.research?.phase === "writing" ? "active" : researchState === "failed" ? "failed" : "pending"} label="Write the report" />
        {run.want?.slides && <Phase state={stateOf(run.slides)} label="Design the slide deck" detail={run.slides?.error} />}
        {run.want?.sheet && <Phase state={stateOf(run.sheet)} label="Build the spreadsheet" detail={run.sheet?.error} />}
        <Phase state={done ? "done" : making ? "active" : "pending"} label="Prepare Word and PDF" />
      </ol>

      {(run.research || run.sources?.length || (live && run.status === "researching")) && (
        <LiveBrowser research={run.research} sources={run.sources} query={run.title} live={live && run.status === "researching"} />
      )}
      {run.research && <ResearchActivity research={run.research} live={live && run.status === "researching"} answering={!!run.report} />}
      {run.status === "failed" && <p className="cw-folder-note"><TriangleAlert size={14} /> {run.error}</p>}

      {(run.report || done) && (
        <div className="cw-run-files">
          <div className="cw-run-files-head">Your files</div>
          <div className="cw-run-files-grid">
            {run.want?.slides && <FileTile icon={Presentation} kind="pptx" name="Slide deck" ready={run.slides?.status === "done"} busy={busy === "pptx"} onDownload={() => save("pptx")} />}
            {run.want?.sheet && <FileTile icon={FileSpreadsheet} kind="xlsx" name="Spreadsheet" ready={run.sheet?.status === "done"} busy={busy === "xlsx"} onDownload={() => save("xlsx")} />}
            <FileTile icon={FileText} kind="docx" name="Report" ready={!!run.report} busy={busy === "docx"} onDownload={() => save("docx")} />
            <FileTile icon={FileText} kind="pdf" name="Report" ready={!!run.report} busy={busy === "pdf"} onDownload={() => save("pdf")} />
          </div>
          {error && <p className="cw-folder-note"><TriangleAlert size={14} /> {error}</p>}
        </div>
      )}

      {run.slides?.status === "done" && run.slides.code && <div className="cw-run-preview not-prose"><SlidesBlock code={run.slides.code} /></div>}
      {run.sheet?.status === "done" && run.sheet.markdown && (
        <div className="cw-run-sheet">{renderTables(run.sheet.markdown)}</div>
      )}
      {run.report && (
        <div className="cw-run-report">
          <button type="button" onClick={() => setShowReport((v) => !v)} aria-expanded={showReport}>
            <FileText size={14} /> {showReport ? "Hide the report" : "Read the report"} <ChevronDown size={14} style={{ transform: showReport ? "rotate(180deg)" : "none" }} />
          </button>
          {showReport && <div className="cw-run-report-body">{renderReport?.(run.report)}</div>}
        </div>
      )}
    </div>
  );
}

// The spreadsheet's tables as small HTML tables (Markdown pipe tables).
function renderTables(markdown) {
  const blocks = [];
  let heading = "";
  let rows = [];
  const flush = () => {
    if (rows.length) blocks.push({ heading, rows });
    rows = [];
  };
  for (const line of String(markdown).split("\n")) {
    const h = /^#{1,4}\s+(.+)/.exec(line);
    if (h) { flush(); heading = h[1].replace(/[*_`]/g, ""); continue; }
    if (/^\s*\|/.test(line)) {
      if (/^\s*\|?\s*:?-{2,}/.test(line.replace(/\|/g, "|"))) continue;
      rows.push(line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/\*\*/g, "")));
    } else if (line.trim()) flush();
  }
  flush();
  return blocks.map((b, i) => (
    <div key={i} className="cw-report-table cw-run-table">
      {b.heading && <div className="cw-run-table-title">{b.heading}</div>}
      <table>
        <thead><tr>{b.rows[0].map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
        <tbody>{b.rows.slice(1, 40).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} title={c}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  ));
}
