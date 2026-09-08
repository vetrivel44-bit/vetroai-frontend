const test = require("node:test");
const assert = require("node:assert/strict");

const { redact, luhnValid, ENTITY } = require("../src/services/callGuard/redactor");
const { matchCategories } = require("../src/services/callGuard/scamPatterns");
const guard = require("../src/services/callGuard");

const typesOf = (text) => redact(text).entities.map((e) => e.type);

test("a code read out digit by digit is masked", () => {
  const cases = [
    "Sir the OTP is 4 5 6 7 8 9",
    "the code is four five six seven eight nine",
    "otp: 458219",
    "my one time password is 8 8 2 1",
    "ओटीपी 4 5 6 7 8 9",
  ];
  for (const text of cases) {
    const result = redact(text);
    assert.equal(result.count > 0, true, `should redact: ${text}`);
    assert.match(result.text, /\[REDACTED:[A-Z_]+\]/, `should mask: ${text}`);
    assert.doesNotMatch(result.text, /\d\s*\d\s*\d\s*\d/, `digits must not survive: ${text}`);
  }
});

test("mixed number words and digits in one run are masked as a single entity", () => {
  const result = redact("it is four 5 six 7 eight 9");
  assert.equal(result.count, 1);
  assert.equal(result.entities[0].type, ENTITY.OTP);
});

test("card numbers are recognised by Luhn, not by keyword alone", () => {
  assert.equal(luhnValid("4539578763621486"), true);
  assert.equal(luhnValid("4539578763621487"), false);
  assert.deepEqual(typesOf("here it is 4539578763621486"), [ENTITY.CARD_NUMBER]);
  // Fails Luhn but is still a 16-digit run next to card talk — masked anyway.
  assert.equal(redact("my card number is 4539 5787 6362 1487").count, 1);
});

test("CVV, PIN, expiry, IFSC and account numbers are masked", () => {
  assert.deepEqual(typesOf("the cvv is 123"), [ENTITY.CVV]);
  assert.deepEqual(typesOf("my atm pin is 4321"), [ENTITY.PIN]);
  assert.deepEqual(typesOf("expiry 09/27"), [ENTITY.CARD_EXPIRY]);
  assert.deepEqual(typesOf("IFSC SBIN0001234"), [ENTITY.IFSC]);
  assert.deepEqual(typesOf("account number 123456789012"), [ENTITY.ACCOUNT_NUMBER]);
});

test("spoken passwords are masked but complaints about passwords are not", () => {
  assert.deepEqual(typesOf("my password is Hunter2024"), [ENTITY.PASSWORD]);
  assert.equal(redact("the password is wrong").count, 0);
  assert.equal(redact("never share your password with anyone").count, 0);
});

test("ordinary speech is left alone", () => {
  const untouched = [
    "I paid 2500 rupees for it in 2024",
    "call me back after 6 pm",
    "hi mom, the train arrives at 7 30",
    "I am 42 years old",
    "we have 3 kids",
  ];
  for (const text of untouched) {
    assert.equal(redact(text).count, 0, `should not redact: ${text}`);
    assert.equal(redact(text).text, text);
  }
});

test("redaction never returns any part of the matched value", () => {
  const secret = "9 4 7 2 6 1";
  const result = redact(`the otp is ${secret}`);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(result.text, /9\s*4\s*7/);
  for (const digit of ["947", "9 4 7", "472610", "947261"]) {
    assert.equal(serialized.includes(digit), false, `entity records leaked ${digit}`);
  }
});

test("scam intents are recognised across phrasings and languages", () => {
  const expected = [
    ["Sir, please share the OTP you just received", "otp_request"],
    ["what is the OTP that came on your phone, tell me", "otp_request"],
    ["ओटीपी बताइए", "otp_request"],
    ["tell me your card number and cvv", "credential_request"],
    ["install AnyDesk so I can help you", "remote_access"],
    ["please share your screen", "remote_access"],
    ["buy a Google Play card and share the code", "payment_redirect"],
    ["I am calling from your bank", "authority_claim"],
    ["your account will be blocked, do not tell anyone", "urgency_pressure"],
    ["just to verify your identity", "verification_pretext"],
  ];
  for (const [text, id] of expected) {
    const ids = matchCategories(text).map((m) => m.id);
    assert.equal(ids.includes(id), true, `${text} → expected ${id}, got ${ids.join(",") || "none"}`);
  }
});

// Real transcripts of Indian scam calls come back from the recogniser as
// code-switched Latin script far more often than as Devanagari or Tamil, and
// both languages put the verb last. An earlier version of this table matched
// neither, and a full Hinglish script walked past every category.
test("code-switched scripts are caught in either word order", () => {
  const expected = [
    ["main aapke bank se bol raha hoon", "authority_claim"],
    ["aapka card block ho jayega", "urgency_pressure"],
    ["verification ke liye OTP bataiye", "otp_request"],
    ["OTP sollunga sir", "otp_request"],
    ["card number bataiye aur cvv bhi", "credential_request"],
    ["ab AnyDesk install kijiye", "remote_access"],
    ["naan bank la irundhu pesuren", "authority_claim"],
    ["ungaloda account block aagidum", "urgency_pressure"],
    ["kisi ko mat bataiye", "urgency_pressure"],
  ];
  for (const [text, id] of expected) {
    const ids = matchCategories(text).map((m) => m.id);
    assert.equal(ids.includes(id), true, `${text} → expected ${id}, got ${ids.join(",") || "none"}`);
  }
});

test("ordinary code-switched speech is not mistaken for a script", () => {
  const benign = [
    "Main aapko baad me call karta hoon",
    "Naan innaiku late aagum",
    "Amma, saapten, neenga saaptingala",
    "Kal milte hain office me",
  ];
  for (const text of benign) {
    assert.deepEqual(matchCategories(text), [], `false positive on: ${text}`);
  }
});

test("normal calls do not trip the classifier", () => {
  const benign = [
    "Hi, your parcel will be delivered tomorrow between 10 and 12",
    "Amma, I will reach home by eight",
    "Can we move the meeting to Thursday?",
    "This is Dr Rao's clinic confirming your appointment",
  ];
  for (const text of benign) {
    assert.deepEqual(matchCategories(text), [], `false positive on: ${text}`);
  }
});

test("the caller asking for an OTP triggers a hard interrupt", () => {
  const result = guard.analyzeUtterance({ speaker: "caller", text: "Please share the OTP you received" });
  assert.equal(result.action, guard.ACTION.HARD_INTERRUPT);
  assert.equal(result.riskLevel, "critical");
  assert.match(result.spokenWarning, /do not share/i);
});

test("the user reading out a code mutes their own microphone", () => {
  const result = guard.analyzeUtterance({ speaker: "user", text: "ok the code is 4 5 8 2 1 9" });
  assert.equal(result.action, guard.ACTION.MUTE_OUTBOUND);
  assert.equal(result.text.includes("4"), false);
});

test("the same digits from the caller do not mute the user", () => {
  const result = guard.analyzeUtterance({ speaker: "caller", text: "your reference is 4 5 8 2 1 9" });
  assert.notEqual(result.action, guard.ACTION.MUTE_OUTBOUND);
});

test("authority plus urgency together score higher than either alone", () => {
  const authority = guard.analyzeUtterance({ text: "I am calling from your bank" }).score;
  const urgency = guard.analyzeUtterance({ text: "your account will be blocked in 10 minutes" }).score;
  const both = guard.analyzeUtterance({ text: "I am calling from your bank and your account will be blocked in 10 minutes" }).score;
  assert.equal(both > authority + urgency, true);
});

test("a benign call scores zero and recommends no action", () => {
  const result = guard.analyzeTranscript({
    turns: [
      { speaker: "caller", text: "Hello, this is the pharmacy. Your prescription is ready." },
      { speaker: "user", text: "Thank you, I will collect it tomorrow." },
    ],
  });
  assert.equal(result.score, 0);
  assert.equal(result.riskLevel, "none");
  assert.equal(result.action, guard.ACTION.NONE);
  assert.equal(result.flags.length, 0);
});

test("a full scam call is scored, flagged and summarised", () => {
  const result = guard.analyzeTranscript({
    turns: [
      { speaker: "caller", text: "I am calling from your bank. Your card will be blocked in 10 minutes." },
      { speaker: "caller", text: "Just to verify your identity, please share the OTP you received." },
      { speaker: "user", text: "Ok, it is 4 5 8 2 1 9" },
    ],
    callerNumber: "+919994777865",
  });
  assert.equal(result.riskLevel, "critical");
  assert.equal(result.action, guard.ACTION.MUTE_OUTBOUND);
  assert.equal(result.userDisclosed, true);
  assert.equal(result.disclosureDetected, true);
  assert.deepEqual(
    result.flags.map((f) => f.id).sort(),
    ["authority_claim", "otp_request", "urgency_pressure", "verification_pretext"]
  );
  assert.match(result.summary, /contact your bank/i);
  assert.equal(JSON.stringify(result).includes("458219"), false);
  assert.equal(JSON.stringify(result).includes("4 5 8 2 1 9"), false);
});

test("the caller's number is masked to its last four digits", () => {
  const result = guard.analyzeTranscript({ turns: [{ text: "hello" }], callerNumber: "+91 99947 77865" });
  assert.equal(result.callerNumber.endsWith("7865"), true);
  assert.equal(result.callerNumber.includes("9994"), false);
});

test("a known-scam caller number raises the floor without deciding alone", () => {
  const turns = [{ speaker: "caller", text: "Hello, is this Mr Kumar?" }];
  assert.equal(guard.analyzeTranscript({ turns }).riskLevel, "none");
  const flagged = guard.analyzeTranscript({ turns, callerReputation: { knownScam: true } });
  assert.equal(flagged.riskLevel, "critical");
  assert.equal(flagged.flags.length, 0, "reputation alone must not invent a tactic flag");
});

test("assertSafeToTransmit blocks unredacted text and passes redacted text", () => {
  assert.throws(
    () => guard.assertSafeToTransmit("the otp is 4 5 8 2 1 9", "the translation provider"),
    (err) => err.code === "SENSITIVE_TEXT_BLOCKED" && !/458219|4 5 8/.test(err.message)
  );
  const safe = "the otp is [REDACTED:OTP]";
  assert.equal(guard.assertSafeToTransmit(safe, "the translation provider"), safe);
});

test("log metadata carries types and counts but no transcript", () => {
  const analysis = guard.analyzeTranscript({
    turns: [{ speaker: "user", text: "my card is 4539578763621486" }],
  });
  const meta = guard.safeLogMeta(analysis);
  assert.deepEqual(meta.entityTypes, [ENTITY.CARD_NUMBER]);
  assert.equal(meta.redactedCount, 1);
  assert.equal(JSON.stringify(meta).includes("4539"), false);
  assert.equal("turns" in meta, false);
});

test("empty and malformed input is handled without throwing", () => {
  assert.deepEqual(redact("").entities, []);
  assert.deepEqual(redact(null).entities, []);
  assert.equal(guard.analyzeTranscript({}).riskLevel, "none");
  assert.equal(guard.analyzeTranscript({ turns: "nope" }).turns.length, 0);
  assert.equal(guard.analyzeUtterance({}).action, guard.ACTION.NONE);
});
