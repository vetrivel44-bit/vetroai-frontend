const test = require("node:test");
const assert = require("node:assert/strict");

const followUpService = require("../src/services/followUpService");

const ANSWER = `Postgres chose a sequential scan because the planner estimated the filter
would match 40% of the 2.1M rows in orders, and above roughly 5-10% a seq scan beats
random index lookups. Running ANALYZE fixed a stale n_distinct on status. With accurate
stats it switched to the partial index on (status) WHERE status = 'pending', and the query
dropped from 4.2s to 90ms.`;

test("generic question shapes are recognised", () => {
  const generic = [
    "What are the benefits of indexing?",
    "What are the main challenges of this approach?",
    "How does Postgres work?",
    "Can you tell me more about this?",
    "Tell me more",
    "Why is this important?",
  ];
  for (const q of generic) {
    assert.equal(followUpService.isGeneric(q), true, `should flag: ${q}`);
  }
});

test("specific questions are not mistaken for generic ones", () => {
  const specific = [
    "Why does the planner pick a seq scan above 10% selectivity?",
    "How much did ANALYZE change the n_distinct estimate?",
    "Would a BRIN index beat the partial index on status?",
    "What happens to the 90ms figure as orders grows past 10M?",
    "How does pgbouncer change this at 500 connections?",
  ];
  for (const q of specific) {
    assert.equal(followUpService.isGeneric(q), false, `should keep: ${q}`);
  }
});

test("parses a plain JSON array", () => {
  const items = followUpService.parseSuggestions('["One question?", "Two question?"]');
  assert.deepEqual(items, ["One question?", "Two question?"]);
});

test("parses a JSON array wrapped in a code fence or prose", () => {
  const raw = 'Here you go:\n```json\n["Why does it scan?", "What breaks at 10M rows?"]\n```';
  assert.deepEqual(followUpService.parseSuggestions(raw), ["Why does it scan?", "What breaks at 10M rows?"]);
});

test("falls back to line parsing when the model ignores JSON", () => {
  const raw = "1. Why does the planner scan?\n2. What breaks at 10M rows?\n- How stale were the stats?";
  const items = followUpService.parseSuggestions(raw);
  assert.deepEqual(items, ["Why does the planner scan?", "What breaks at 10M rows?", "How stale were the stats?"]);
});

test("cleanup drops generic suggestions and keeps specific ones", () => {
  const cleaned = followUpService.cleanSuggestions([
    "What are the benefits of indexing?",              // generic — dropped
    "Why does the planner pick a seq scan here?",      // kept
    "How does Postgres work?",                         // generic — dropped
    "Would a BRIN index beat the partial index?",      // kept
  ]);
  assert.deepEqual(cleaned, [
    "Why does the planner pick a seq scan here?",
    "Would a BRIN index beat the partial index?",
  ]);
});

test("cleanup removes duplicates that differ only in wording noise", () => {
  const cleaned = followUpService.cleanSuggestions([
    "Why does the planner choose a seq scan?",
    "why does THE planner choose a seq scan???",
    "Why does a planner choose the seq scan?",
  ]);
  assert.equal(cleaned.length, 1, "near-identical questions collapse to one");
});

test("cleanup strips numbering, bullets and quotes", () => {
  const cleaned = followUpService.cleanSuggestions([
    '1. "Why does the planner pick a seq scan here?"',
    "- Would a BRIN index beat the partial one?",
  ]);
  assert.deepEqual(cleaned, [
    "Why does the planner pick a seq scan here?",
    "Would a BRIN index beat the partial one?",
  ]);
});

test("cleanup adds a missing question mark but rejects prose", () => {
  const cleaned = followUpService.cleanSuggestions([
    "How stale were the statistics",
    "Here are some questions you might ask next.",
  ]);
  assert.deepEqual(cleaned, ["How stale were the statistics?"]);
});

test("cleanup caps the list at four", () => {
  const cleaned = followUpService.cleanSuggestions([
    "Why does the planner scan sequentially?",
    "How stale was n_distinct on status?",
    "Would BRIN beat the partial index?",
    "What happens past 10M rows?",
    "How does this interact with autovacuum?",
  ]);
  assert.equal(cleaned.length, 4);
});

test("the prompt carries the whole answer and the conversation", async () => {
  const { system, user } = followUpService.buildPrompt({
    userQuery: "Why is my orders query slow?",
    answer: ANSWER,
    history: [
      { role: "user", content: "Why is my orders query slow?" },
      { role: "assistant", content: ANSWER },
    ],
  });
  assert.match(system, /Perplexity/i, "states the target style");
  assert.match(system, /Anchor every question/i, "demands specificity");
  assert.match(system, /What are the benefits of X/i, "shows what to avoid");
  assert.ok(user.includes("90ms"), "the full answer reaches the model, not a 600-char prefix");
  assert.ok(user.includes("Conversation so far"), "recent turns are included");
});

test("end to end: a templated model reply yields nothing rather than filler", async () => {
  const suggestions = await followUpService.generateFollowUps({
    userQuery: "Why is my orders query slow?",
    answer: ANSWER,
    history: [],
    callModel: async () => JSON.stringify([
      "What are the benefits of indexes?",
      "How does Postgres work?",
      "What are the challenges of this approach?",
      "Can you tell me more?",
    ]),
  });
  assert.deepEqual(suggestions, [], "all four were generic, so none are shown");
});

test("end to end: specific model output survives intact", async () => {
  const suggestions = await followUpService.generateFollowUps({
    userQuery: "Why is my orders query slow?",
    answer: ANSWER,
    history: [],
    callModel: async () => JSON.stringify([
      "Why does the planner switch above 10% selectivity?",
      "How stale was n_distinct before ANALYZE ran?",
      "Would a BRIN index beat the partial one here?",
      "Does the 90ms hold as orders grows past 10M rows?",
    ]),
  });
  assert.equal(suggestions.length, 4);
  assert.ok(suggestions.every((q) => q.endsWith("?")));
  assert.ok(suggestions.some((q) => /n_distinct|BRIN|90ms|10%/.test(q)), "questions cite the answer's specifics");
});

// The four suggestions from a real session, reported as "always the same fixed
// format". The first two show the failure that gives it away: a weak model
// wrapping a template around the question it was handed, so the user's own
// words come back nested inside the suggestion.
const APK_ANSWER = `An APK is the package format Android uses to distribute and install apps.
It bundles the compiled code, resources and a manifest into one file, and Android verifies its
signature before installing. Only download APKs from trusted sources, because unsafe files may
contain malware. Google Play usually installs APKs automatically for you.`;
const APK_QUERY = "Can you explain Apk more simply";

test("the exact templated suggestions from the report are all rejected", () => {
  const reported = [
    "Can you explain Can you explain Apk more simply more simply?",
    "What is the best next step for Can you explain Apk more simply?",
    "Can you give me a practical example?",
    "What should I watch out for?",
  ];
  const cleaned = followUpService.cleanSuggestions(reported, { userQuery: APK_QUERY, answer: APK_ANSWER });
  assert.deepEqual(cleaned, [], "none of these should ever be shown");
});

test("a suggestion that swallows the user's own question is rejected", () => {
  assert.equal(
    followUpService.repeatsQuery("Can you explain Can you explain Apk more simply more simply?", APK_QUERY),
    true
  );
  assert.equal(
    followUpService.repeatsQuery("What is the best next step for Can you explain Apk more simply?", APK_QUERY),
    true
  );
  assert.equal(
    followUpService.repeatsQuery("Why does Android verify the signature first?", APK_QUERY),
    false,
    "an unrelated phrasing is not a repeat"
  );
});

test("a question sharing no vocabulary with the answer is rejected", () => {
  const words = followUpService.contentWords(APK_ANSWER);
  assert.equal(followUpService.isAnchored("Can you give me a practical example?", words), false);
  assert.equal(followUpService.isAnchored("What should I watch out for?", words), false);
  assert.equal(followUpService.isAnchored("How does Android verify an APK signature?", words), true);
  assert.equal(followUpService.isAnchored("Is sideloading from outside Google Play risky?", words), true);
});

test("genuinely specific questions about the same answer survive", () => {
  const good = [
    "How does Android verify an APK signature before installing?",
    "What does the manifest inside an APK actually declare?",
    "Is sideloading riskier than installing from Google Play?",
    "Can a malicious APK pass signature verification?",
  ];
  const cleaned = followUpService.cleanSuggestions(good, { userQuery: APK_QUERY, answer: APK_ANSWER });
  assert.equal(cleaned.length, 4, `expected all four to survive, got ${JSON.stringify(cleaned)}`);
});

test("anchoring is skipped when there is no answer to anchor against", () => {
  const cleaned = followUpService.cleanSuggestions(["Why does the planner pick a seq scan?"], {});
  assert.equal(cleaned.length, 1);
});

// The "car" case from the report: a one-word prompt, an answer explaining how a
// car works, and suggestions that just wrapped the prompt word in a frame.
const CAR_ANSWER = `A car converts fuel into motion. The internal combustion engine burns petrol
in cylinders, the crankshaft turns that into rotation, and the transmission sends torque to the
wheels through a differential.`;

test("key terms are what the answer added, not what the prompt already said", () => {
  const terms = followUpService.keyTerms(CAR_ANSWER, "car");
  assert.ok(terms.includes("crankshaft"), "picks up what the answer introduced");
  assert.ok(terms.includes("combustion"));
  assert.ok(terms.includes("transmission") || terms.includes("differential"));
  assert.ok(!terms.includes("car"), "the prompt's own word is not a key term");
  assert.ok(!terms.some((t) => /[._-]$/.test(t)), "no trailing punctuation clings to a term");
});

test("matching only the prompt's word does not count as anchored", () => {
  // This is the whole point. Any template built from the prompt contains the
  // prompt's word, so accepting that as an anchor would accept every template.
  const anchors = followUpService.anchorSet(CAR_ANSWER, "car");
  assert.equal(followUpService.isAnchored("Can you tell the steps followed by car?", anchors), false);
  assert.equal(followUpService.isAnchored("What is the best next step for car?", anchors), false);
  assert.equal(followUpService.isAnchored("How does the crankshaft turn combustion into rotation?", anchors), true);
});

test("prompt-substituted templates are all rejected for the car answer", () => {
  const templated = [
    "Can you explain car more simply?",
    "Can you tell the steps followed by car?",
    "What is the best next step for car?",
    "Can you give me a practical example?",
    "What should I watch out for?",
  ];
  const cleaned = followUpService.cleanSuggestions(templated, { userQuery: "car", answer: CAR_ANSWER });
  assert.deepEqual(cleaned, []);
});

test("grounded questions about the car answer survive", () => {
  const good = [
    "How does the crankshaft turn combustion into rotation?",
    "Why does the differential matter when cornering?",
    "Is a petrol engine less efficient than an electric motor?",
    "What does the transmission change about torque?",
  ];
  const cleaned = followUpService.cleanSuggestions(good, { userQuery: "car", answer: CAR_ANSWER });
  assert.equal(cleaned.length, 4, JSON.stringify(cleaned));
});

test("the prompt tells the model which terms it must engage with", () => {
  const { user } = followUpService.buildPrompt({ userQuery: "car", answer: CAR_ANSWER });
  assert.match(user, /crankshaft/, "key terms are listed for the model");
  assert.match(user, /must engage with at least one/i);
});

test("the strict retry names the frames it must not reuse", () => {
  const { user } = followUpService.buildPrompt({ userQuery: "car", answer: CAR_ANSWER, strict: true });
  assert.match(user, /previous attempt was rejected/i);
  assert.match(user, /Can you explain/);
});

test("a templated first pass triggers one strict retry, and the better result wins", async () => {
  const calls = [];
  const suggestions = await followUpService.generateFollowUps({
    userQuery: "car",
    answer: CAR_ANSWER,
    history: [],
    callModel: async ({ user }) => {
      calls.push(user);
      // First pass returns templates; the retry returns grounded questions.
      return calls.length === 1
        ? JSON.stringify(["Can you explain car more simply?", "What is the best next step for car?"])
        : JSON.stringify([
            "How does the crankshaft turn combustion into rotation?",
            "Why does the differential matter when cornering?",
            "What does the transmission change about torque?",
            "Is petrol less efficient than an electric motor?",
          ]);
    },
  });
  assert.equal(calls.length, 2, "retried once");
  assert.match(calls[1], /previous attempt was rejected/i, "the retry was the strict one");
  assert.equal(suggestions.length, 4);
});

test("a good first pass is not retried", async () => {
  let calls = 0;
  await followUpService.generateFollowUps({
    userQuery: "car",
    answer: CAR_ANSWER,
    history: [],
    callModel: async () => {
      calls++;
      return JSON.stringify([
        "How does the crankshaft turn combustion into rotation?",
        "Why does the differential matter when cornering?",
      ]);
    },
  });
  assert.equal(calls, 1, "two survivors is enough; no second call");
});
