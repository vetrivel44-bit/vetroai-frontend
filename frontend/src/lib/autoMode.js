// The workflow for one message, picked by the app instead of a Mode menu
// (Normal, Web Search, DeepSearch, Data Analysis, Code, Summarize used to be
// chosen by hand). Whether to search the web is still decided per message by
// the search judge (searchIntentService); this only picks the workflows that
// need a different pipeline or brief.
//
// Returns one of: "deep_search", "analyst", "debugger", "summarize", "web_search", "normal".

const RESEARCH = /\b(deep ?search|deep research|research (?:report|paper|on|about|into)|in[- ]depth (?:report|analysis|research|study|look)|comprehensive (?:report|analysis|overview|review|guide|comparison)|detailed (?:report|research)|literature review|market (?:research|analysis|study)|industry (?:analysis|report)|competitive (?:analysis|landscape)|with (?:citations|references|sources)|cite (?:your )?sources)\b/i;

const DATA_FILE = /\.(csv|tsv|xlsx|xls|json)$/i;
const DATA_ASK = /\b(analy[sz]e|analysis|insights?|trends?|chart|plot|visuali[sz]e|statistics|pivot|correlation|forecast)\b[\s\S]{0,80}\b(data|dataset|spreadsheet|sheet|csv|excel|table|sales|numbers|figures|revenue|survey|results)\b/i;

const SUMMARY = /\b(summari[sz]e|summary|summarise|tl;?dr|key (?:points|takeaways)|main points|gist|brief (?:me|overview)|in short)\b/i;

const CODE_ASK = /\b(write|create|generate|build|implement|develop|debug|fix|refactor|optimi[sz]e|review)\b[\s\S]{0,100}\b(code|function|class|method|script|program|algorithm|api|component|endpoint|sql|query|regex|python|javascript|typescript|java|c\+\+|react|node|html|css|bug)\b/i;
const CODE_TEXT = /```|^\s*(?:def |class |function |import |from \S+ import |#include|public (?:static )?(?:void|class))|Traceback \(most recent call last\)|\b(?:TypeError|SyntaxError|ReferenceError|NullPointerException|Segmentation fault)\b|\bat \S+ \(\S+:\d+:\d+\)/m;

const fileNames = (files) => (Array.isArray(files) ? files : files ? [files] : [])
  .map((f) => String(f?.name || ""))
  .filter(Boolean);

/**
 * @param {{ query?: string, files?: File[]|File|null, forced?: string }} input
 *   forced: a workflow the user turned on themselves (the web search toggle).
 */
export function autoModeFor({ query = "", files = null, forced = "" } = {}) {
  if (forced === "web_search") return "web_search";
  const text = String(query || "");
  const names = fileNames(files);

  if (names.some((n) => DATA_FILE.test(n)) && !SUMMARY.test(text)) return "analyst";
  if (DATA_ASK.test(text)) return "analyst";
  if (RESEARCH.test(text) && !names.length) return "deep_search";
  if (CODE_TEXT.test(text) || CODE_ASK.test(text)) return "debugger";
  if (SUMMARY.test(text) && (names.length || text.length > 1500)) return "summarize";
  if (text.length > 6000 && !/\?\s*$/.test(text.trim())) return "summarize";
  return "normal";
}

const NAMES = { deep_search: "DeepSearch", analyst: "Data Analysis", debugger: "Code", summarize: "Summarize", web_search: "Web Search", normal: "Chat" };
export const autoModeName = (mode) => NAMES[mode] || "Chat";
