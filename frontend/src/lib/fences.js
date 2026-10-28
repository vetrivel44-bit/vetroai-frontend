// Code fences a model glued onto a line of prose. Markdown only sees a fence
// at the start of a line, so "…through September.```chartjs" printed the
// whole chart config as text, and its closing ``` then opened a code box
// that swallowed the takeaway after it. Every ``` is put on a line of its
// own, opening and closing alike, tracking which is which as it goes.

const FENCE = /```/g;

/** `text` with every code fence starting its own line. */
export function normalizeFences(text) {
  const src = String(text || "");
  if (!src.includes("```")) return src;
  let out = "";
  let cursor = 0;
  let open = false;
  for (const match of src.matchAll(FENCE)) {
    const at = match.index;
    if (at < cursor) continue; // part of a longer run already handled
    // A longer run of backticks (````) is one fence.
    let end = at + 3;
    while (src[end] === "`") end++;
    const lineStart = src.lastIndexOf("\n", at - 1) + 1;
    const glued = src.slice(lineStart, at).trim() !== "";
    out += src.slice(cursor, at);
    if (glued) out += "\n";
    out += src.slice(at, end);
    cursor = end;
    if (open) {
      // A closing fence: anything after it on the same line is prose.
      const nl = src.indexOf("\n", end);
      const rest = src.slice(end, nl === -1 ? src.length : nl);
      if (rest.trim()) {
        out += "\n" + rest.trimStart();
        cursor = nl === -1 ? src.length : nl;
      }
    }
    open = !open;
  }
  return out + src.slice(cursor);
}
