// Browser-side helpers for the Call Assistant panel.
//
// The authoritative scam and redaction rules live on the server
// (backend/src/services/callGuard) and every transcript is redacted there
// before it is returned, translated, spoken or stored. This module deliberately
// does not restate those rules — a second, drifting copy of a safety-critical
// classifier is worse than one. What it does instead is the work that only the
// browser can do: parse what the user pasted, keep an un-analysed draft from
// being written to disk with a code in it, and render risk consistently.

export const SPEAKERS = { CALLER: "caller", USER: "user" };

const SPEAKER_PREFIX = /^\s*(caller|them|they|other|unknown|me|user|myself|i|self)\s*[:\-–]\s*/i;
const USER_LABELS = new Set(["me", "user", "myself", "i", "self"]);

/**
 * Turn pasted text into turns. Lines may be labelled ("Caller: ...", "Me: ...");
 * anything unlabelled is attributed to the caller, which is the safer default —
 * it is the side whose questions the classifier is looking at.
 *
 * @param {string} raw
 * @returns {Array<{speaker: string, text: string}>}
 */
export function parseTranscript(raw) {
  if (typeof raw !== "string") return [];
  const turns = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(SPEAKER_PREFIX);
    if (match) {
      const label = match[1].toLowerCase();
      turns.push({
        speaker: USER_LABELS.has(label) ? SPEAKERS.USER : SPEAKERS.CALLER,
        text: trimmed.slice(match[0].length).trim(),
      });
      continue;
    }
    turns.push({ speaker: SPEAKERS.CALLER, text: trimmed });
  }
  return turns.filter((turn) => turn.text);
}

// Conservative digit masking for anything the browser writes to disk before the
// server has analysed it — a draft the user is still typing, a saved history
// entry. It masks more than the server's classifier would, which is the right
// bias for a local copy nobody is going to translate.
const LONG_DIGIT_RUN = /\d(?:[\s\-.]?\d){3,}/g;

export function maskDigits(text) {
  if (typeof text !== "string") return "";
  return text.replace(LONG_DIGIT_RUN, "[REDACTED:NUMERIC_SEQUENCE]");
}

export function looksSensitive(text) {
  if (typeof text !== "string") return false;
  LONG_DIGIT_RUN.lastIndex = 0;
  return LONG_DIGIT_RUN.test(text);
}

export const RISK_META = {
  none:     { label: "No indicators",  tone: "#16a34a", blurb: "Nothing in this call matched a scam pattern." },
  low:      { label: "Low",            tone: "#65a30d", blurb: "One weak indicator. Probably fine, worth knowing." },
  elevated: { label: "Elevated",       tone: "#d97706", blurb: "Several tactics used in scam scripts appear in this call." },
  high:     { label: "High",           tone: "#ea580c", blurb: "This call follows a known scam script closely." },
  critical: { label: "Critical",       tone: "#dc2626", blurb: "This call asked for something no legitimate caller asks for." },
};

// What the live assistant (Phase 2/3) would have done at this point in the
// call. Shown in the post-call view so the ladder is legible before it ships.
export const ACTION_META = {
  none:           { label: "No action", detail: "The assistant would have stayed silent." },
  soft_warning:   { label: "Soft warning", detail: "A short spoken heads-up to you, the call left running." },
  hard_interrupt: { label: "Hard interrupt", detail: "The assistant would have spoken over the call: do not share this." },
  mute_outbound:  { label: "Microphone muted", detail: "Your outgoing audio would have been cut before the code was transmitted." },
};

export const ENTITY_LABELS = {
  OTP: "one-time code",
  CARD_NUMBER: "card number",
  CVV: "CVV",
  PIN: "PIN",
  CARD_EXPIRY: "card expiry",
  ACCOUNT_NUMBER: "account number",
  IFSC: "bank branch code",
  AADHAAR: "Aadhaar number",
  SSN: "social security number",
  PASSWORD: "password",
  NUMERIC_SEQUENCE: "number sequence",
};

const REDACTION_TOKEN = /\[REDACTED:([A-Z_]+)\]/g;

/**
 * Split redacted text into plain segments and redaction markers so the panel
 * can render a masked value as a pill rather than as literal "[REDACTED:OTP]".
 *
 * @param {string} text
 * @returns {Array<{type: "text"|"redacted", value: string}>}
 */
export function splitRedactions(text) {
  const parts = [];
  let cursor = 0;
  const re = new RegExp(REDACTION_TOKEN.source, "g");
  let match;
  while ((match = re.exec(text || "")) !== null) {
    if (match.index > cursor) parts.push({ type: "text", value: text.slice(cursor, match.index) });
    parts.push({ type: "redacted", value: ENTITY_LABELS[match[1]] || "sensitive value" });
    cursor = match.index + match[0].length;
  }
  if (cursor < (text || "").length) parts.push({ type: "text", value: text.slice(cursor) });
  return parts;
}
