// The to-do page's logic that doesn't touch the page or Puter, kept apart so
// it can be tested (see test/todoCore.test.js).

export const CLAUDE_MODEL = "anthropic/claude-opus-5-5";
// Each task is its own key in the user's Puter key-value store, so changing
// one task never rewrites the others.
export const KEY_PREFIX = "todo:";
export const MAX_TASK_LENGTH = 500;
export const MAX_STEPS = 8;

// Puter rejects with plain objects as often as with Errors.
export function errorMessage(err) {
  if (typeof err === "string") return err;
  return err?.message
    || err?.error?.message
    || (typeof err?.error === "string" ? err.error : "")
    || err?.msg
    || "Something went wrong";
}

// ── Order ───────────────────────────────────────────────────────────────────
// Tasks sort by `order`, which starts as the creation time. Steps from "Break
// into steps" take values between their task and the next one, so they sit
// right under it.
export const orderOf = (todo) => (Number.isFinite(todo.order) ? todo.order : todo.createdAt);

export function sortTodos(todos) {
  return [...todos].sort((a, b) => orderOf(a) - orderOf(b));
}

// `count` values strictly between `after` and `before`, evenly spaced. With no
// `before` (the last task), they simply count up from `after`.
export function ordersBetween(after, before, count) {
  const upper = Number.isFinite(before) ? before : after + count + 1;
  const gap = (upper - after) / (count + 1);
  return Array.from({ length: count }, (_, i) => after + gap * (i + 1));
}

// Where new steps for `parent` go: after its existing steps, before whatever
// follows them.
export function stepSlot(todos, parent) {
  const sorted = sortTodos(todos);
  let index = sorted.findIndex((t) => t.id === parent.id);
  while (sorted[index + 1]?.parentId === parent.id) index += 1;
  return {
    after: orderOf(sorted[index]),
    before: sorted[index + 1] ? orderOf(sorted[index + 1]) : undefined,
  };
}

export function visibleTodos(todos, filter) {
  const sorted = sortTodos(todos);
  if (filter === "active") return sorted.filter((t) => !t.done);
  if (filter === "done") return sorted.filter((t) => t.done);
  return sorted;
}

export function stepsOf(todos, id) {
  return todos.filter((t) => t.parentId === id);
}

// ── Break into steps ────────────────────────────────────────────────────────
export function stepsPrompt(task) {
  return [
    "Break this to-do into 3 to 6 small, concrete steps, each doable in under an hour, in the order to do them.",
    "Reply with only a JSON array of short strings (each under 80 characters) and no other text.",
    "",
    `To-do: ${task}`,
  ].join("\n");
}

// Reads the steps out of Claude's reply: a JSON array when it followed the
// prompt, otherwise the lines of a list.
export function parseSteps(reply, max = MAX_STEPS) {
  const text = String(reply || "");
  let items = null;

  const json = text.match(/\[[\s\S]*\]/);
  if (json) {
    try {
      const parsed = JSON.parse(json[0]);
      if (Array.isArray(parsed)) {
        items = parsed.map((item) => (typeof item === "string" ? item : item?.step || item?.title || item?.text || ""));
      }
    } catch { /* not JSON after all */ }
  }

  if (!items) {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const LIST_ITEM = /^(?:[-*•]|\d+[.)])\s+/;
    const listed = lines.filter((line) => LIST_ITEM.test(line));
    items = (listed.length ? listed : lines).map((line) => line.replace(LIST_ITEM, ""));
  }

  const seen = new Set();
  return items
    .map((item) => String(item).replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, 200))
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

// ── Claude's answers ────────────────────────────────────────────────────────
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Everything is escaped first, then a few common Markdown forms (headings,
// lists, bold, italics, code) are turned back on, so a reply can never inject
// markup into the page.
export function renderMarkdown(markdown) {
  const inline = (s) => escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>");

  const html = [];
  let list = null;
  let code = null;
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };

  for (const line of String(markdown || "").split("\n")) {
    if (line.trim().startsWith("```")) {
      if (code === null) { closeList(); code = []; }
      else { html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`); code = null; }
      continue;
    }
    if (code !== null) { code.push(line); continue; }

    const heading = line.match(/^#{1,6}\s+(.*)/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (bullet || numbered) {
      const type = bullet ? "ul" : "ol";
      if (list !== type) { closeList(); html.push(`<${type}>`); list = type; }
      html.push(`<li>${inline((bullet || numbered)[1])}</li>`);
    } else {
      closeList();
      if (heading) html.push(`<h3>${inline(heading[1])}</h3>`);
      else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  if (code !== null) html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return html.join("");
}
