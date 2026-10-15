// Reads a website as the model streams it, so Computer mode can show what is
// actually being built — "Styling the page · 84 rules", "Adding the products
// section" — and, at the end, what the finished page has in it.

const FENCE_OPEN = /```html[^\n]*\n?/i;

/** The HTML written so far (possibly unfinished), or null before the code starts. */
export function partialHtml(markdown) {
  const text = String(markdown || "");
  const open = FENCE_OPEN.exec(text);
  if (!open) return null;
  const rest = text.slice(open.index + open[0].length);
  const close = rest.indexOf("```");
  return close >= 0 ? rest.slice(0, close) : rest;
}

const isClosed = (markdown) => {
  const text = String(markdown || "");
  const open = FENCE_OPEN.exec(text);
  return Boolean(open) && text.slice(open.index + open[0].length).includes("```");
};

const SECTION_TAG = /<(header|nav|section|main|footer|aside)\b([^>]*)>/gi;

// "products-grid" → "Products grid"
const humanize = (name) => {
  const words = String(name).replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
};

/** The page's landmark sections in order: [{ tag, name }]. */
export function sectionsOf(html) {
  const found = [];
  const seen = new Set();
  for (const match of String(html || "").matchAll(SECTION_TAG)) {
    const attrs = match[2] || "";
    const id = (attrs.match(/\bid\s*=\s*["']([^"']+)["']/i) || [])[1];
    const cls = ((attrs.match(/\bclass\s*=\s*["']([^"']+)["']/i) || [])[1] || "").split(/\s+/)[0];
    const tag = match[1].toLowerCase();
    if (tag === "main") continue;
    const name = humanize(id || cls || tag);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    found.push({ tag, name });
  }
  return found;
}

export const BUILD_STEPS = [
  { id: "brief", label: "Understand the brief" },
  { id: "design", label: "Choose the layout, colors and fonts" },
  { id: "style", label: "Style the page" },
  { id: "sections", label: "Build the page sections" },
  { id: "script", label: "Wire up the interactions" },
  { id: "review", label: "Check it in the live preview" },
];

const lastOpen = (lower, tag) => lower.lastIndexOf(`<${tag}`) > lower.lastIndexOf(`</${tag}>`);

/**
 * Where a streaming website build is: { stage, detail, lines, sections }.
 * `stage` is one of BUILD_STEPS' ids.
 */
export function buildStage(markdown) {
  const html = partialHtml(markdown);
  if (html === null) {
    return { stage: String(markdown || "").trim() ? "design" : "brief", detail: "", lines: 0, sections: [] };
  }
  const lower = html.toLowerCase();
  const lines = html ? html.split("\n").length : 0;
  const sections = sectionsOf(html);
  if (isClosed(markdown)) return { stage: "review", detail: "", lines, sections };

  if (lastOpen(lower, "style")) {
    const rules = (html.slice(lower.lastIndexOf("<style")).match(/\{/g) || []).length;
    return { stage: "style", detail: rules ? `${rules} CSS rule${rules === 1 ? "" : "s"} so far` : "", lines, sections };
  }
  if (lower.includes("<body") && lastOpen(lower, "script")) {
    return { stage: "script", detail: "", lines, sections };
  }
  if (lower.includes("<body")) {
    const current = sections[sections.length - 1];
    return { stage: "sections", detail: current ? `Adding the ${current.name.toLowerCase()} section` : "", lines, sections };
  }
  return { stage: "design", detail: "", lines, sections };
}

/** The build steps with statuses for a stage, ready for the task panel. */
export function buildSteps(markdown, { finished = false } = {}) {
  const { stage, detail } = buildStage(markdown);
  const current = finished ? BUILD_STEPS.length : BUILD_STEPS.findIndex((s) => s.id === stage);
  return BUILD_STEPS.map((step, i) => ({
    ...step,
    status: i < current ? "done" : i === current ? "active" : "pending",
    ...(i === current && detail ? { detail } : {}),
  }));
}

/** What the finished page contains, for the "Website ready" summary. */
export function analyzeSite(html) {
  const doc = String(html || "");
  return {
    lines: doc ? doc.split("\n").length : 0,
    sections: sectionsOf(doc),
    images: (doc.match(/<img\b/gi) || []).length + (doc.match(/url\(\s*["']?https?:/gi) || []).length,
    responsive: /<meta[^>]+name=["']viewport["']/i.test(doc) && /@media[^{]*(max|min)-width/i.test(doc),
    mobileMenu: /(hamburger|menu-toggle|nav-toggle|menu-btn|mobile-menu|aria-expanded)/i.test(doc),
    interactive: /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(doc),
  };
}
