// "Humanize this": VetroAI rewrites the text itself so it reads naturally,
// and replies with the rewritten text.
//
// The text can be pasted with the request, attached as a document, or be the
// previous answer ("humanize that"). The model gets a rewriting brief with
// that text (buildHumanizePrompt) in place of the user's short request; the
// chat still shows what the user typed.

const ASKS = [
  /\b(humani[sz]e|humani[sz]ing|humani[sz]ed|humani[sz]er|humanise)\b/i,
  /\bmake (it|this|that|these|them|my [a-z]+|the [a-z]+)( sound| look| read| feel)? (more )?(human|natural|less (ai|robotic))\b/i,
  /\b(sounds?|reads?|feels?) (more )?(human|like a human)\b/i,
  /\b(remove|reduce|get rid of) (the )?ai (tone|feel|voice|style)\b/i,
];

// "What is a humanizer?", "Explain AI humanizing" ask about the idea, not for
// a rewrite — unless they also point at something to rewrite.
const ABOUT_THE_IDEA = /^\s*(what|why|who|explain|define|tell me about|is|are|do|does|can|should)\b/i;
const POINTS_AT_TEXT = /\b(this|that|these|my|following|below|above|paragraph|essay|answer|reply|document|file|pdf|attached)\b/i;

/** Is this message a request to humanize some text? */
export function isHumanizeRequest(query) {
  const q = String(query || "");
  if (!ASKS.some((rx) => rx.test(q))) return false;
  if (ABOUT_THE_IDEA.test(q) && !POINTS_AT_TEXT.test(q.replace(/\bhumani[sz]\w*/gi, ""))) return false;
  return true;
}

// Split "Humanize this in a casual tone: <text>" into the request and the text.
function splitRequest(query) {
  const q = String(query || "").trim();
  const colon = q.match(/^([^\n:]{0,120}?\bhumani[sz]\w*[^\n:]{0,80}):\s*([\s\S]+)$/i);
  if (colon) return { request: colon[1].trim(), text: colon[2].trim() };
  const lines = q.split("\n");
  if (lines.length > 1 && ASKS.some((rx) => rx.test(lines[0]))) return { request: lines[0].trim(), text: lines.slice(1).join("\n").trim() };
  // Text first, request last: "<text>\n\nhumanize this"
  if (lines.length > 1 && ASKS.some((rx) => rx.test(lines[lines.length - 1]))) return { request: lines[lines.length - 1].trim(), text: lines.slice(0, -1).join("\n").trim() };
  return { request: q, text: "" };
}

const MIN_TEXT = 40;

/**
 * The text to humanize and the user's own wording of the request: an
 * attached document's text, else text pasted with the request, else the
 * previous answer ("humanize that").
 */
export function humanizeSource({ query, docText = "", history = [] } = {}) {
  const { request, text: pasted } = splitRequest(query);
  if (docText && docText.trim().length >= MIN_TEXT) return { text: docText.trim(), from: "document", request };
  if (pasted.length >= MIN_TEXT) return { text: pasted, from: "message", request };
  const last = [...history].reverse().find((m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim().length >= MIN_TEXT);
  if (last) return { text: last.content.trim(), from: "answer", request };
  return { text: "", from: "none", request };
}

// The server keeps 12,000 characters of a message; leave room for the brief.
export const HUMANIZE_TEXT_LIMIT = 10000;

/** The rewriting brief sent to the model in place of the user's request. */
export function buildHumanizePrompt({ text, request = "" }) {
  const body = String(text || "").slice(0, HUMANIZE_TEXT_LIMIT);
  return `Rewrite the text below so it reads naturally, as if a thoughtful person wrote it by hand.

The user's request: "${String(request).slice(0, 300)}" — follow any tone, audience or length it asks for.

Rules:
- Keep the meaning, facts, names, numbers, quotes and citations exactly as they are.
- Keep the same language and roughly the same length and structure (paragraphs, headings, lists), unless the request says otherwise.
- Vary sentence length and rhythm; mix short sentences with longer ones.
- Prefer plain, specific words. Use contractions where they suit the tone.
- Cut filler and stock phrases such as "delve", "in today's fast-paced world", "it's important to note", "furthermore", "moreover", "in conclusion", "a testament to", "navigate the complexities", "unlock", "seamless".
- Don't overuse dashes, colons or lists; let ideas connect in ordinary sentences.
- Match the original's register: formal stays formal, casual stays casual.
- Don't add new information, opinions, emojis or headings.

Reply with only the rewritten text: no introduction, no notes, no quotation marks around it.

TEXT:
"""
${body}
"""`;
}
