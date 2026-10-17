// VetroAI Computer's research-to-file agent: a DeepSearch on the topic, then
// the finished files made from its report — a slide deck, a spreadsheet,
// a Word document and a PDF. Chat answers in text; this hands back files.

const RESEARCH_WORDS = /\b(research|deep research|investigate|study|analy[sz]e|analysis|compare|comparison|find out|look into|survey|market|competitors?|best|top \d+|pros and cons)\b/i;
const FILE_WORDS = /\b(deck|slides?|slide deck|pptx?|power ?point|presentation|spreadsheet|excel|xlsx|sheet|csv|report|pdf|word|docx?|document|brief|one-pager)\b/i;

/** "Research X and make a deck / spreadsheet / report". */
export function isResearchFileRequest(text) {
  const t = String(text || "");
  return RESEARCH_WORDS.test(t) && FILE_WORDS.test(t);
}

/** Which files to make. A report (Word and PDF) always comes with the research. */
export function wantedFiles(text) {
  const t = String(text || "");
  return {
    slides: /\b(deck|slides?|pptx?|power ?point|presentation|keynote)\b/i.test(t),
    sheet: /\b(spreadsheet|excel|xlsx|sheet|csv|table)\b/i.test(t),
    doc: true,
  };
}

export function deckInput(prompt, report) {
  return [
    `Make a presentation (a PowerPoint slide deck) from this research report, for this request: "${prompt}".`,
    "Use the report's real findings, figures and comparisons; keep the deck's facts to what the report says. End with a slide naming the main sources.",
    "",
    "--- RESEARCH REPORT ---",
    report.slice(0, 24000),
  ].join("\n");
}

export const SHEET_INSTRUCTIONS = [
  "You turn a research report into spreadsheet data. Reply with ONLY Markdown: one or more tables, each directly under a short '### Sheet name' heading.",
  "The first table is the main comparison (one row per option / item / company, one column per attribute — prices, specs, ratings, pros, cons, figures with units).",
  "Add a 'Sources' table last (columns: #, Title, URL) when the report cites sources. Use only facts from the report; leave a cell empty rather than guess. No prose.",
].join(" ");

export function sheetInput(prompt, report) {
  return `Request: "${prompt}"\n\n--- RESEARCH REPORT ---\n${report.slice(0, 24000)}`;
}

/** The JSON inside the reply's ```slides block, or null. */
export function slidesCode(text) {
  const m = /```slides\s*([\s\S]*?)```/i.exec(String(text || ""));
  return m ? m[1].trim() : null;
}

/** The Markdown tables of a reply (anything before the first heading or table dropped). */
export function sheetMarkdown(text) {
  const src = String(text || "").replace(/```(?:markdown|md)?\s*([\s\S]*?)```/gi, "$1");
  const start = src.search(/^#{1,4}\s|^\s*\|/m);
  return start >= 0 && /\|\s*:?-{2,}/.test(src) ? src.slice(start).trim() : "";
}

/** A short file name from the request: "Electric scooters under 1.5 lakh". */
export function topicTitle(prompt) {
  const t = String(prompt || "")
    .replace(/\b(please|can you|could you|research|deep research|investigate|study|analy[sz]e|compare|find out|look into|and|then|make|create|build|give me|me|a|an|the|with|into|as)\b/gi, " ")
    .replace(/\b(slide deck|deck|slides?|pptx?|power ?point|presentation|spreadsheet|excel|xlsx|sheet|csv|report|pdf|word|docx?|document|comparison|comparing)\b/gi, " ")
    .replace(/[^\p{L}\p{N}₹$€£%.\- ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.\-]+$/, "");
  const title = t ? t.charAt(0).toUpperCase() + t.slice(1) : "Research";
  return title.length > 70 ? `${title.slice(0, 67).trim()}…` : title;
}
