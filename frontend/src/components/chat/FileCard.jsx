import React from "react";
import { X } from "lucide-react";
import "./fileCard.css";

// An attached (non-image) file, shown as a small card: a coloured badge for
// the file type, the name, and "DOCX · 24 KB" underneath — the way Claude and
// ChatGPT show attachments. Used in the composer (with a remove button) and
// on sent messages (without one).

const KINDS = [
  { match: /^pdf$/, label: "PDF", color: "#E5484D" },
  { match: /^docx?$|^odt$|^rtf$/, label: "DOC", color: "#2F6FEB" },
  { match: /^xlsx?$|^ods$/, label: "XLS", color: "#1F9D55" },
  { match: /^csv$|^tsv$/, label: "CSV", color: "#1F9D55" },
  { match: /^pptx?$|^odp$/, label: "PPT", color: "#E0782B" },
  { match: /^md$|^markdown$/, label: "MD", color: "#6B7280" },
  { match: /^txt$|^log$/, label: "TXT", color: "#6B7280" },
  { match: /^json$|^xml$|^ya?ml$/, label: "DATA", color: "#8B5CF6" },
  { match: /^(js|jsx|ts|tsx|py|java|c|cpp|cs|go|rb|php|html|css|sh|sql)$/, label: "CODE", color: "#8B5CF6" },
  { match: /^zip$|^rar$|^7z$|^tar$|^gz$/, label: "ZIP", color: "#A16207" },
];

const extensionOf = (name) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
};

function fileKind(name) {
  const ext = extensionOf(name);
  const kind = KINDS.find((k) => k.match.test(ext));
  return { ext, label: kind?.label || (ext ? ext.slice(0, 4).toUpperCase() : "FILE"), color: kind?.color || "#6B7280" };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export default function FileCard({ name, size, onRemove, compact = false }) {
  const kind = fileKind(name);
  const meta = [kind.ext ? kind.ext.toUpperCase() : "File", formatBytes(size)].filter(Boolean).join(" · ");
  return (
    <div className={`vetro-file-card${compact ? " is-compact" : ""}`} title={name}>
      <span className="vetro-file-badge" style={{ "--file-color": kind.color }} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
        <span className="vetro-file-badge-label">{kind.label}</span>
      </span>
      <span className="vetro-file-text">
        <span className="vetro-file-name">{name}</span>
        <span className="vetro-file-meta">{meta}</span>
      </span>
      {onRemove && (
        <button type="button" className="vetro-file-remove" onClick={onRemove} aria-label={`Remove ${name}`} title="Remove">
          <X size={12} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
