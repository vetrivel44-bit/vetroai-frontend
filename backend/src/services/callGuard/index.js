// Call guard — the layered detector from spec §5.2, and the only path through
// which call text is allowed to reach a network call.
//
// Order of operations per utterance, and it is not negotiable:
//
//   raw utterance
//     → redact()            values masked; nothing downstream sees a real OTP
//     → matchCategories()   intent rules run on the redacted text
//     → scoreUtterance()    weights, combinations, escalation ladder
//     → analysis            safe to log, translate, speak, store
//
// Anything that wants to send call text somewhere calls assertSafeToTransmit()
// first. That function is the last gate before the network, and it throws
// rather than returning a flag so a missed check cannot silently leak.

const { redact, containsSensitive, CRITICAL_ENTITIES, ENTITY } = require("./redactor");
const { matchCategories } = require("./scamPatterns");

// Escalation ladder, weakest first (spec §5.2: soft warning → hard audio
// interrupt → auto-mute outgoing audio).
const ACTION = {
  NONE: "none",
  SOFT_WARNING: "soft_warning",
  HARD_INTERRUPT: "hard_interrupt",
  MUTE_OUTBOUND: "mute_outbound",
};

const ACTION_RANK = {
  [ACTION.NONE]: 0,
  [ACTION.SOFT_WARNING]: 1,
  [ACTION.HARD_INTERRUPT]: 2,
  [ACTION.MUTE_OUTBOUND]: 3,
};

const RISK = { NONE: "none", LOW: "low", ELEVATED: "elevated", HIGH: "high", CRITICAL: "critical" };

// Spoken lines the assistant plays over the call. Short on purpose: this is
// audio that has to land before the user finishes reading out a code.
const SPOKEN_WARNINGS = {
  [ACTION.SOFT_WARNING]: "Heads up. This call is showing signs of a common scam script. Take your time.",
  [ACTION.HARD_INTERRUPT]: "Stop. This call is asking for your OTP or bank details. Do not share them. No real bank asks for this.",
  [ACTION.MUTE_OUTBOUND]: "Your microphone is muted. You were about to read out a code or card number. VetroAI has blocked it from being sent.",
};

const CALLER = "caller";
const USER = "user";

function riskLevelFor(score) {
  if (score >= 70) return RISK.CRITICAL;
  if (score >= 45) return RISK.HIGH;
  if (score >= 25) return RISK.ELEVATED;
  if (score > 0) return RISK.LOW;
  return RISK.NONE;
}

function maxAction(a, b) {
  return ACTION_RANK[a] >= ACTION_RANK[b] ? a : b;
}

/**
 * Analyse one utterance.
 *
 * @param {{text: string, speaker?: "caller"|"user"}} utterance
 * @returns {{speaker: string, text: string, entities: Array, entityTypes: string[], matches: Array, score: number, riskLevel: string, action: string, spokenWarning: string|null}}
 *   `text` is the redacted text. The raw text is never returned.
 */
function analyzeUtterance({ text, speaker = CALLER } = {}) {
  const who = speaker === USER ? USER : CALLER;
  const { text: redactedText, entities } = redact(text || "");
  const matches = matchCategories(redactedText);

  let score = matches.reduce((sum, m) => sum + m.weight, 0);

  // Authority plus urgency in one breath ("this is your bank, your account
  // will be blocked in ten minutes") is the shape of a live script even when
  // neither half is damning alone.
  const ids = new Set(matches.map((m) => m.id));
  if (ids.has("authority_claim") && ids.has("urgency_pressure")) score += 20;
  if (ids.has("verification_pretext") && (ids.has("otp_request") || ids.has("credential_request"))) score += 10;

  const criticalEntities = entities.filter((e) => CRITICAL_ENTITIES.has(e.type));

  // A code being read out is scored differently depending on who is speaking.
  // From the caller it is context; from the user it is the moment the money is
  // lost, and it is the one condition that mutes the user's own microphone.
  let action = ACTION.NONE;
  if (matches.some((m) => m.severity === "critical")) action = ACTION.HARD_INTERRUPT;
  else if (matches.some((m) => m.severity === "high")) action = ACTION.HARD_INTERRUPT;
  else if (matches.length) action = ACTION.SOFT_WARNING;

  if (who === USER && criticalEntities.length) {
    action = maxAction(action, ACTION.MUTE_OUTBOUND);
    score = Math.max(score, 85);
  } else if (who === CALLER && criticalEntities.length) {
    score = Math.max(score, 30);
    action = maxAction(action, ACTION.SOFT_WARNING);
  }

  score = Math.min(100, score);

  return {
    speaker: who,
    text: redactedText,
    entities,
    entityTypes: [...new Set(entities.map((e) => e.type))],
    matches,
    score,
    riskLevel: riskLevelFor(score),
    action,
    spokenWarning: SPOKEN_WARNINGS[action] || null,
  };
}

/**
 * Analyse a whole call.
 *
 * @param {{turns: Array<{text: string, speaker?: string, at?: number|string}>, callerNumber?: string, callerReputation?: object}} input
 * @returns {object} redacted transcript plus call-level risk, flags and the
 *   strongest action the assistant would have taken live.
 */
function analyzeTranscript({ turns = [], callerNumber = "", callerReputation = null } = {}) {
  const analyzed = [];
  for (const turn of Array.isArray(turns) ? turns : []) {
    const result = analyzeUtterance({ text: turn?.text, speaker: turn?.speaker });
    analyzed.push({ ...result, at: turn?.at ?? null });
  }

  // Call-level score: the worst single utterance, plus a smaller contribution
  // from the breadth of distinct tactics used across the call. A script that
  // claims authority, applies urgency and then asks for a code is worse than
  // any one of those lines on its own.
  const worst = analyzed.reduce((max, t) => Math.max(max, t.score), 0);
  const flagIds = new Set();
  const flags = [];
  for (const turn of analyzed) {
    for (const match of turn.matches) {
      if (flagIds.has(match.id)) continue;
      flagIds.add(match.id);
      flags.push({ ...match, firstSeenTurn: analyzed.indexOf(turn) });
    }
  }

  let score = Math.min(100, worst + Math.max(0, flags.length - 1) * 5);

  // Caller reputation (spec §5.2) raises the floor but never decides alone —
  // a clean number is not evidence of a clean call.
  if (callerReputation?.knownScam) score = Math.min(100, Math.max(score, 75));

  const action = analyzed.reduce((max, t) => maxAction(max, t.action), ACTION.NONE);
  const redactedCount = analyzed.reduce((sum, t) => sum + t.entities.length, 0);
  const userDisclosed = analyzed.some(
    (t) => t.speaker === USER && t.entities.some((e) => CRITICAL_ENTITIES.has(e.type))
  );
  // Post-call analysis of a recording has no reliable speaker separation, so a
  // code spoken by anyone on the call still counts as an exposure worth telling
  // the user about — it just does not carry the live mute action.
  const disclosureDetected = analyzed.some((t) => t.entities.some((e) => CRITICAL_ENTITIES.has(e.type)));

  return {
    turns: analyzed,
    score,
    riskLevel: riskLevelFor(score),
    action,
    spokenWarning: SPOKEN_WARNINGS[action] || null,
    flags,
    redactedCount,
    userDisclosed,
    disclosureDetected,
    callerNumber: callerNumber ? maskNumber(callerNumber) : "",
    callerReputation: callerReputation || null,
    summary: summarize({ riskLevel: riskLevelFor(score), flags, disclosureDetected }),
  };
}

// Even the caller's number is masked in anything we render or store — it is
// personal data about a third party who never consented to this call being
// processed (spec §7).
function maskNumber(number) {
  const digits = String(number).replace(/\D/g, "");
  if (digits.length <= 4) return "•".repeat(digits.length);
  return `${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function summarize({ riskLevel, flags, disclosureDetected }) {
  if (riskLevel === RISK.NONE) return "No scam indicators found in this call.";
  const tactics = flags.map((f) => f.label.toLowerCase());
  const tacticText = tactics.length > 1
    ? `${tactics.slice(0, -1).join(", ")} and ${tactics[tactics.length - 1]}`
    : tactics[0];
  const disclosure = disclosureDetected
    ? " Sensitive digits were spoken during this call — treat the account as exposed and contact your bank on a number you look up yourself."
    : "";
  return `${riskLevel === RISK.CRITICAL || riskLevel === RISK.HIGH ? "This call matches a known scam pattern" : "This call shows some scam indicators"}: ${tacticText}.${disclosure}`;
}

/**
 * The last gate before any network call.
 *
 * Throws when the text still carries something that must not be transmitted.
 * Callers pass text that has already been through redact(); this catches the
 * case where they did not.
 *
 * @param {string} text
 * @param {string} destination human-readable name, used only in the error
 * @returns {string} the text, unchanged, when it is safe to send
 */
function assertSafeToTransmit(text, destination = "an external service") {
  if (typeof text !== "string" || !text.trim()) return text;
  if (containsSensitive(text)) {
    const error = new Error(
      `Refusing to send call text to ${destination}: it still contains sensitive values. Redact before transmitting.`
    );
    error.code = "SENSITIVE_TEXT_BLOCKED";
    error.statusCode = 422;
    throw error;
  }
  return text;
}

// Log-safe view of an analysis: types and counts, never values, never the
// transcript itself.
function safeLogMeta(analysis) {
  if (!analysis) return {};
  return {
    riskLevel: analysis.riskLevel,
    score: analysis.score,
    action: analysis.action,
    flags: (analysis.flags || []).map((f) => f.id),
    redactedCount: analysis.redactedCount ?? (analysis.entities || []).length,
    entityTypes: analysis.entityTypes || [...new Set((analysis.turns || []).flatMap((t) => t.entityTypes || []))],
  };
}

module.exports = {
  ACTION,
  RISK,
  ENTITY,
  SPOKEN_WARNINGS,
  analyzeUtterance,
  analyzeTranscript,
  assertSafeToTransmit,
  safeLogMeta,
  maskNumber,
  redact,
};
