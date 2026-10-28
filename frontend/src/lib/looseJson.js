// JSON as models write it for charts, maps and quizzes: usually valid, but
// now and then with a stray or missing bracket, a trailing comma or a
// comment — and one stray "}" used to turn a whole chart into raw code.
// Strict JSON first; then the same text with those slips repaired.

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const dropTrailingCommas = (s) => s.replace(/,\s*([}\]])/g, "$1");

// Brackets matched up: a closer with no opener is dropped, a missing closer
// added at the end, and anything after the top-level value ends is ignored.
function balance(s) {
  let out = "";
  const stack = [];
  let inString = false;
  let escaped = false;
  let started = false;
  for (const ch of s) {
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === "{" || ch === "[") { stack.push(ch === "{" ? "}" : "]"); started = true; out += ch; continue; }
    if (ch === "}" || ch === "]") {
      if (!stack.includes(ch)) continue;
      while (stack[stack.length - 1] !== ch) out += stack.pop();
      stack.pop();
      out += ch;
      if (started && stack.length === 0) return out;
      continue;
    }
    out += ch;
  }
  if (inString) out += '"';
  out = out.replace(/[,:\s]+$/, "");
  while (stack.length) out += stack.pop();
  return out;
}

/** Parses `text` as JSON, repairing small slips; throws when it can't. */
export function parseLooseJson(text) {
  const raw = String(text ?? "").trim();
  try { return JSON.parse(raw); } catch (strictError) {
    const cleaned = dropTrailingCommas(stripComments(raw));
    try { return JSON.parse(cleaned); } catch { /* try harder below */ }
    try { return JSON.parse(dropTrailingCommas(balance(cleaned))); } catch { throw strictError; }
  }
}
