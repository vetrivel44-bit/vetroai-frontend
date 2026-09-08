// Sensitive-entity redaction for call transcripts (spec §5.2, §6).
//
// This is the control the spec calls "the single most important technical
// control in the whole feature": if the user reads an OTP or a card number out
// loud mid-panic, that value must never leave this process — not to a
// translation model, not to a text-to-speech voice, not into a log line, not
// into a transcript saved on the phone.
//
// Two design rules follow from that:
//
//   1. Redaction runs BEFORE anything else. Scoring, logging and every network
//      call in the pipeline take the redacted text, never the raw text.
//   2. This module never returns, logs or hashes the matched value. Callers get
//      the entity type, its position and its length — enough to render a mask
//      and to reason about severity, and nothing an attacker could reverse.
//
// Speech, not typing, is the input here. A caller reading back a code says
// "four five six seven eight nine", so digit runs have to be recognised across
// number words and separators, not just as a contiguous \d{6}.

const ENTITY = {
  OTP: "OTP",
  CARD_NUMBER: "CARD_NUMBER",
  CVV: "CVV",
  PIN: "PIN",
  CARD_EXPIRY: "CARD_EXPIRY",
  ACCOUNT_NUMBER: "ACCOUNT_NUMBER",
  IFSC: "IFSC",
  AADHAAR: "AADHAAR",
  SSN: "SSN",
  PASSWORD: "PASSWORD",
  NUMERIC_SEQUENCE: "NUMERIC_SEQUENCE",
};

// Spoken digits. Callers say codes one digit at a time, and in mixed scripts —
// an Indian user reading an OTP often says "do teen" for two three. Number
// words are limited to 0-9 on purpose: "twenty" in "twenty rupees" is not a
// digit being read out, and treating it as one would mask ordinary speech.
const DIGIT_WORDS = new Map(Object.entries({
  zero: 0, oh: 0, o: 0, nought: 0, naught: 0,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  // Romanised Hindi/Urdu
  shunya: 0, ek: 1, do: 2, teen: 3, char: 4, chaar: 4, panch: 5, paanch: 5,
  chhe: 6, chah: 6, saat: 7, aath: 8, nau: 9,
  // Romanised Tamil
  onnu: 1, rendu: 2, moonu: 3, naalu: 4, anju: 5, aaru: 6, ezhu: 7, ettu: 8, onbathu: 9,
  // Spanish
  cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
}));

// Keywords that make a short digit run unambiguous. Without one of these a
// four-digit run is usually a year or a price, so context decides.
const OTP_CONTEXT = /\b(otp|o\.?t\.?p\.?|one[\s-]?time (?:password|code|pin)|verification code|security code|auth(?:entication)? code|passcode|access code|confirmation code|sms code|code (?:is|was|sent)|कोड|ओटीपी|ஓடிபி|குறியீடு|código)\b/i;
const CVV_CONTEXT = /\b(cvv|cvc|cvv2|card verification|security number|three digits? (?:on|at) the back|back of (?:the|your) card)\b/i;
const PIN_CONTEXT = /\b(pin|p\.?i\.?n\.?|atm pin|upi pin|card pin|mpin|पिन|பின்)\b/i;
const CARD_CONTEXT = /\b(card|debit|credit|visa|master ?card|rupay|amex|कार्ड|கார்டு|tarjeta)\b/i;
const ACCOUNT_CONTEXT = /\b(account|a\/c|acc(?:t|ount)? ?(?:no|number)|net ?banking|खाता|கணக்கு|cuenta)\b/i;

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

// Tokenise while keeping each token's offset, so a span found over normalised
// tokens can be mapped back to the exact characters of the original utterance.
function tokenize(text) {
  const tokens = [];
  const re = /[\p{L}\p{N}]+/gu;
  let match;
  while ((match = re.exec(text)) !== null) {
    tokens.push({ raw: match[0], lower: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

// How many digits a token contributes when a code is being read out loud.
// "4" and "four" contribute one; "4567" contributes four; anything else zero.
function digitValue(token) {
  if (/^\d+$/.test(token.lower)) return token.lower.length;
  if (DIGIT_WORDS.has(token.lower)) return 1;
  return 0;
}

function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length >= 12 && sum % 10 === 0;
}

// Digit runs, spoken or written. A "run" is consecutive tokens that each carry
// digits, allowing filler words a person actually says between them.
const FILLER = new Set(["and", "then", "uh", "um", "er", "hmm", "ok", "okay", "yes", "yeah", "aur", "phir", "hai", "hain", "y", "e"]);

function findDigitRuns(tokens) {
  const runs = [];
  let current = null;
  for (let i = 0; i < tokens.length; i++) {
    const value = digitValue(tokens[i]);
    if (value > 0) {
      if (!current) current = { startIndex: i, endIndex: i, digits: 0, tokens: 0, spokenTokens: 0 };
      current.endIndex = i;
      current.digits += value;
      current.tokens += 1;
      if (!/^\d+$/.test(tokens[i].lower)) current.spokenTokens += 1;
      continue;
    }
    // A single filler word inside a run does not end it; anything else does.
    if (current && FILLER.has(tokens[i].lower) && i + 1 < tokens.length && digitValue(tokens[i + 1]) > 0) continue;
    if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs;
}

function runText(tokens, run) {
  return tokens.slice(run.startIndex, run.endIndex + 1).map((t) => t.lower).join(" ");
}

function runDigits(tokens, run) {
  let digits = "";
  for (let i = run.startIndex; i <= run.endIndex; i++) {
    const token = tokens[i];
    if (/^\d+$/.test(token.lower)) digits += token.lower;
    else if (DIGIT_WORDS.has(token.lower)) digits += String(DIGIT_WORDS.get(token.lower));
  }
  return digits;
}

// Words immediately before a run decide what it is. 8 tokens covers "the OTP
// that we just sent you is ..." without reaching into the previous sentence.
function contextBefore(tokens, run, span = 8) {
  return tokens
    .slice(Math.max(0, run.startIndex - span), run.startIndex)
    .map((t) => t.raw)
    .join(" ");
}

function classifyRun(tokens, run, fullText) {
  const digits = runDigits(tokens, run);
  const before = contextBefore(tokens, run);
  const near = `${before} ${runText(tokens, run)}`;
  const spoken = run.spokenTokens > 0 || run.tokens > 1;

  if (digits.length >= 12 && digits.length <= 19 && luhnValid(digits)) {
    return { type: ENTITY.CARD_NUMBER, confidence: "high", spoken };
  }
  if (digits.length === 12 && (/\baadhaar|aadhar|आधार|ஆதார்\b/i.test(near) || /\baadhaar|aadhar\b/i.test(fullText))) {
    return { type: ENTITY.AADHAAR, confidence: "high", spoken };
  }
  if (digits.length === 9 && /\bssn|social security\b/i.test(near)) {
    return { type: ENTITY.SSN, confidence: "high", spoken };
  }
  if (digits.length >= 13 && digits.length <= 19 && CARD_CONTEXT.test(near)) {
    return { type: ENTITY.CARD_NUMBER, confidence: "medium", spoken };
  }
  if (digits.length === 3 && CVV_CONTEXT.test(near)) {
    return { type: ENTITY.CVV, confidence: "high", spoken };
  }
  if (digits.length === 4 && CVV_CONTEXT.test(near)) {
    return { type: ENTITY.CVV, confidence: "medium", spoken };
  }
  if (digits.length >= 4 && digits.length <= 6 && PIN_CONTEXT.test(near)) {
    return { type: ENTITY.PIN, confidence: "high", spoken };
  }
  if (digits.length >= 4 && digits.length <= 8 && OTP_CONTEXT.test(near)) {
    return { type: ENTITY.OTP, confidence: "high", spoken };
  }
  if (digits.length >= 9 && digits.length <= 18 && ACCOUNT_CONTEXT.test(near)) {
    return { type: ENTITY.ACCOUNT_NUMBER, confidence: "high", spoken };
  }
  // No keyword nearby. A code dictated digit by digit is still a code — that is
  // exactly how people read one out — so spoken runs are masked from 4 digits,
  // while written runs need 6+ before they stop looking like a year or a price.
  if (spoken && digits.length >= 4 && digits.length <= 10) {
    return { type: ENTITY.OTP, confidence: "medium", spoken };
  }
  if (!spoken && digits.length >= 6 && digits.length <= 10) {
    return { type: ENTITY.NUMERIC_SEQUENCE, confidence: "low", spoken };
  }
  if (digits.length > 10) {
    return { type: ENTITY.NUMERIC_SEQUENCE, confidence: "medium", spoken };
  }
  return null;
}

// Patterns matched directly against the text, for entities that are not just a
// digit run: alphanumeric bank codes, expiry dates, spoken passwords.
const LITERAL_MATCHERS = [
  { type: ENTITY.IFSC, confidence: "high", re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  { type: ENTITY.CARD_EXPIRY, confidence: "high", re: /\b(?:expir\w*|valid (?:thru|till|until)|good thru)\b[^0-9]{0,12}(\d{1,2}\s*[/\-\s]\s*\d{2,4})/gi, group: 1 },
  {
    type: ENTITY.PASSWORD,
    confidence: "high",
    // "my password is hunter2", "the password: hunter2", "contraseña es ..."
    // The connector is required: "my password is hunter2" is a disclosure,
    // "never share your password with anyone" is advice.
    re: /(?:password|passcode|पासवर्ड|கடவுச்சொல்|contrase[nñ]a)\s*(?:is|was|=|:|es|हैं|है)\s*["']?([^\s"',.;!?]{4,64})/gi,
    group: 1,
    // "password is wrong" is a complaint, not a disclosure either.
    reject: /^(?:wrong|incorrect|invalid|correct|expired|required|reset|change|changed|blocked|not|never|secret|safe|confidential|strong|weak|with|your|the|that|this|only|also|same)$/i,
  },
];

function spansOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

/**
 * Redact every sensitive entity found in a single utterance.
 *
 * @param {string} text raw utterance
 * @returns {{text: string, entities: Array<{type: string, confidence: string, start: number, end: number, length: number, spoken: boolean}>, count: number}}
 *   `text` is safe to log, translate, speak and store. The entity records carry
 *   no part of the matched value.
 */
function redact(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { text: typeof text === "string" ? text : "", entities: [], count: 0 };
  }

  const tokens = tokenize(text);
  const spans = [];

  for (const run of findDigitRuns(tokens)) {
    const classified = classifyRun(tokens, run, text);
    if (!classified) continue;
    spans.push({
      ...classified,
      priority: 0,
      start: tokens[run.startIndex].start,
      end: tokens[run.endIndex].end,
    });
  }

  for (const matcher of LITERAL_MATCHERS) {
    const re = new RegExp(matcher.re.source, matcher.re.flags);
    let match;
    while ((match = re.exec(text)) !== null) {
      const value = matcher.group ? match[matcher.group] : match[0];
      if (!value) continue;
      if (matcher.reject && matcher.reject.test(value)) continue;
      const start = matcher.group ? match.index + match[0].lastIndexOf(value) : match.index;
      spans.push({
        type: matcher.type,
        confidence: matcher.confidence,
        spoken: false,
        priority: 1, // a named match beats a bare digit run covering the same characters
        start,
        end: start + value.length,
      });
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }

  // Longest span wins where two matchers cover the same characters — a card
  // number that also looks like an account number is masked once, as a card.
  spans.sort((a, b) => (b.end - b.start) - (a.end - a.start) || b.priority - a.priority || a.start - b.start);
  const kept = [];
  for (const span of spans) {
    if (kept.some((k) => spansOverlap(k, span))) continue;
    kept.push(span);
  }
  kept.sort((a, b) => a.start - b.start);

  let out = "";
  let cursor = 0;
  const entities = [];
  for (const span of kept) {
    out += text.slice(cursor, span.start);
    out += `[REDACTED:${span.type}]`;
    cursor = span.end;
    entities.push({
      type: span.type,
      confidence: span.confidence,
      spoken: !!span.spoken,
      start: span.start,
      end: span.end,
      length: span.end - span.start,
    });
  }
  out += text.slice(cursor);

  return { text: out, entities, count: entities.length };
}

// True when a string still carries something that must not be transmitted.
// Used as the last gate before any outbound network call.
function containsSensitive(text) {
  return redact(text).count > 0;
}

const REDACTION_TOKEN = /\[REDACTED:[A-Z_]+\]/g;

function hasRedactionToken(text) {
  return typeof text === "string" && REDACTION_TOKEN.test(text);
}

// Entity types severe enough to cut the user's outgoing audio (spec §5.2).
const CRITICAL_ENTITIES = new Set([ENTITY.OTP, ENTITY.CARD_NUMBER, ENTITY.CVV, ENTITY.PIN, ENTITY.PASSWORD, ENTITY.AADHAAR, ENTITY.SSN]);

module.exports = {
  ENTITY,
  CRITICAL_ENTITIES,
  redact,
  containsSensitive,
  hasRedactionToken,
  // exported for tests
  luhnValid,
  tokenize,
  findDigitRuns,
};
