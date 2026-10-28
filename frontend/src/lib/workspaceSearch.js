// Search behind the sidebar's search button (GlobalSearch.jsx): chats by
// title and message text, projects by name and description, artifacts by
// title and content. Every typed word must appear (any order, any case);
// title matches rank first, then newer items.

const words = (query) => String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
const plain = (text) => String(text || "")
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/[#*_`>|[\]]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const hasAll = (haystack, terms) => terms.every((t) => haystack.includes(t));

// A short excerpt around the first term, for a match inside a chat.
function snippetAround(text, term, radius = 60) {
  const lower = text.toLowerCase();
  const at = lower.indexOf(term);
  if (at < 0) return "";
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + term.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

// Chat ids are creation timestamps.
const timeOf = (item) => Number(item?.createdAt) || Number(String(item?.id || "").split("_")[0]) || 0;

function rank(list) {
  return list.sort((a, b) => (b.inTitle - a.inTitle) || (b.time - a.time));
}

export function searchWorkspace({ query, sessions = [], spaces = [], artifacts = [], limit = 8 } = {}) {
  const terms = words(query);
  if (!terms.length) return { chats: [], spaces: [], artifacts: [] };

  const chats = [];
  for (const s of sessions) {
    const title = s?.title || "Untitled";
    const inTitle = hasAll(title.toLowerCase(), terms);
    const body = (s?.messages || []).map((m) => (typeof m?.content === "string" ? plain(m.content) : "")).join(" \n ");
    if (!inTitle && !hasAll(`${title}\n${body}`.toLowerCase(), terms)) continue;
    const snippet = inTitle ? "" : snippetAround(body, terms.find((t) => body.toLowerCase().includes(t)) || terms[0]);
    chats.push({ id: s.id, title, snippet, time: timeOf(s), inTitle });
  }

  const foundSpaces = [];
  for (const sp of spaces) {
    const name = sp?.name || "Untitled project";
    const inTitle = hasAll(name.toLowerCase(), terms);
    const extra = [sp?.description, sp?.systemPrompt, ...(sp?.files || []).map((f) => f?.name)].filter(Boolean).join(" ");
    if (!inTitle && !hasAll(`${name} ${extra}`.toLowerCase(), terms)) continue;
    foundSpaces.push({ id: sp.id, title: name, detail: sp?.description || `${(sp?.files || []).length} files`, time: timeOf(sp), inTitle });
  }

  const foundArtifacts = [];
  for (const a of artifacts) {
    const title = a?.title || "Untitled artifact";
    const inTitle = hasAll(title.toLowerCase(), terms);
    if (!inTitle && !hasAll(`${title} ${a?.language || ""} ${a?.code || ""}`.toLowerCase(), terms)) continue;
    foundArtifacts.push({ id: a.id, title, detail: a?.language || "", time: timeOf(a), inTitle, artifact: a });
  }

  return {
    chats: rank(chats).slice(0, limit),
    spaces: rank(foundSpaces).slice(0, limit),
    artifacts: rank(foundArtifacts).slice(0, limit),
  };
}

/** "just now", "5m ago", "3h ago", "2d ago", or a date. */
export function ago(time, now = Date.now()) {
  if (!time) return "";
  const s = Math.max(0, (now - time) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(time).toLocaleDateString();
}
