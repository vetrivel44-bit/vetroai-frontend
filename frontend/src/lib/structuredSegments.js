// Splits a reply into Markdown text and visual JSON blocks (timeline, chart…),
// in the order they appear, so prose written between visuals stays where the
// model put it. Blocks may be fenced (```json … ```) or bare {…} objects.

export const VISUAL_BLOCK_TYPES = new Set([
  "location", "route", "chart", "timeline", "comparison_table", "comparison", "metrics",
  "architecture", "gallery", "visual_gallery", "collapsible",
]);

const TYPE_HINT = /"type"\s*:\s*"([a-z_]+)"/;

function parseVisual(raw) {
  const m = TYPE_HINT.exec(raw);
  if (!m || !VISUAL_BLOCK_TYPES.has(m[1])) return null;
  try {
    const data = JSON.parse(raw.trim().replace(/,\s*([}\]])/g, "$1"));
    return data && typeof data === "object" && VISUAL_BLOCK_TYPES.has(data.type) ? data : null;
  } catch {
    return null;
  }
}

// End index (exclusive) of the balanced {…} starting at `start`, or -1.
function matchBrace(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

export function hasVisualBlocks(text) {
  return splitVisualBlocks(text).some((s) => s.kind === "visual");
}

export function splitVisualBlocks(text) {
  const src = String(text || "");
  const segments = [];
  const pushText = (t) => {
    if (!t.trim()) return;
    const last = segments[segments.length - 1];
    if (last?.kind === "text") last.text += t;
    else segments.push({ kind: "text", text: t });
  };
  const fence = /```[a-zA-Z]*[ \t]*\n?([\s\S]*?)```/g;
  let cursor = 0;
  let i = 0;
  while (i < src.length) {
    fence.lastIndex = i;
    const f = fence.exec(src);
    const brace = src.indexOf("{", i);
    if (f && (brace === -1 || f.index <= brace)) {
      const data = parseVisual(f[1]);
      if (data) {
        pushText(src.slice(cursor, f.index));
        segments.push({ kind: "visual", data, raw: f[1].trim() });
        cursor = f.index + f[0].length;
      }
      // Code fences that aren't visuals are skipped whole: braces inside code
      // must not be read as blocks.
      i = f.index + f[0].length;
      continue;
    }
    if (brace === -1) break;
    const end = matchBrace(src, brace);
    const data = end > 0 ? parseVisual(src.slice(brace, end)) : null;
    if (data) {
      pushText(src.slice(cursor, brace));
      segments.push({ kind: "visual", data, raw: src.slice(brace, end) });
      cursor = end;
      i = end;
    } else i = brace + 1;
  }
  pushText(src.slice(cursor));
  return segments;
}

const cell = (v) => String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
const table = (header, rows) => [`| ${header.map(cell).join(" | ")} |`, `|${header.map(() => "---").join("|")}|`,
  ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");

function objectsTable(items) {
  const rows = (Array.isArray(items) ? items : []).filter((r) => r && typeof r === "object");
  if (!rows.length) return "";
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => rows.some((r) => typeof r[k] !== "object"));
  return table(keys, rows.map((r) => keys.map((k) => r[k])));
}

// A visual block as plain Markdown, for downloads that can't draw it.
function visualToMarkdown(data) {
  const title = data.title ? `**${data.title}**\n\n` : "";
  switch (data.type) {
    case "timeline":
      return title + (data.steps || []).map((s, i) => `${i + 1}. **${s.title || `Step ${i + 1}`}**${s.description ? ` — ${s.description}` : ""}`).join("\n");
    case "metrics":
      return title + (data.metrics || []).map((m) => `- **${m.label || m.title || m.name}:** ${m.value ?? ""}`).join("\n");
    case "comparison_table": {
      const options = (data.options || []).map((o) => (typeof o === "object" ? o.name || o.title : o));
      return title + table(["Feature", ...options], (data.features || []).map((f) => [f.name || f.feature, ...(f.values || [])]));
    }
    case "collapsible":
      return title + String(data.content || "");
    default:
      return title + objectsTable(data.data || data.points || data.nodes);
  }
}

export function visualsToMarkdown(text) {
  return splitVisualBlocks(text).map((s) => (s.kind === "visual" ? `\n${visualToMarkdown(s.data)}\n` : s.text)).join("").trim();
}
