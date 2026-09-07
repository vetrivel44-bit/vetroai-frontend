const test = require("node:test");
const assert = require("node:assert");

const {
  parseSuggestions,
  refineSuggestions,
  isGeneric,
  echoesQuery,
  isGrounded,
  buildFollowUpMessages,
} = require("../src/services/followUpService");

const ANSWER = [
  "Litmaps builds an interactive citation map from a seed paper.",
  "Papers appear as nodes and connecting lines show citation relationships.",
  "You can add useful papers to your map and Litmaps generates more recommendations.",
  "Optional alerts notify you when new related papers are published.",
  "The free tier caps you at one map and 100 tracked papers.",
].join(" ");

const QUERY = "How lit mapps work";

test("parseSuggestions reads a plain JSON array", () => {
  const parsed = parseSuggestions('["How do Litmaps alerts pick papers?", "What caps the free tier?"]');
  assert.deepStrictEqual(parsed, [
    "How do Litmaps alerts pick papers?",
    "What caps the free tier?",
  ]);
});

test("parseSuggestions reads a fenced JSON block", () => {
  const parsed = parseSuggestions('```json\n["How are citation lines drawn?"]\n```');
  assert.deepStrictEqual(parsed, ["How are citation lines drawn?"]);
});

test("parseSuggestions falls back to a numbered list", () => {
  const parsed = parseSuggestions("1. How do Litmaps alerts work?\n2. What limits the free tier?");
  assert.deepStrictEqual(parsed, [
    "How do Litmaps alerts work?",
    "What limits the free tier?",
  ]);
});

test("isGeneric catches the four templates the old prompt produced", () => {
  assert.ok(isGeneric("Can you explain How lit mapps work"));
  assert.ok(isGeneric("What is the best next step for How lit mapps work?"));
  assert.ok(isGeneric("Can you give me a practical example"));
  assert.ok(isGeneric("What should I watch out for?"));
  assert.ok(isGeneric("Tell me more about this"));
});

test("isGeneric leaves specific questions alone", () => {
  assert.ok(!isGeneric("How does Litmaps rank its recommendations?"));
  assert.ok(!isGeneric("What happens past the 100 tracked papers cap?"));
});

test("echoesQuery rejects a reworded copy of the user's question", () => {
  assert.ok(echoesQuery("How do litmaps work?", QUERY));
  assert.ok(!echoesQuery("How often do Litmaps alerts fire?", QUERY));
});

test("isGrounded requires a word the answer actually used", () => {
  assert.ok(isGrounded("What limits the free tier?", ANSWER));
  assert.ok(!isGrounded("Which restaurants nearby serve dosa?", ANSWER));
});

test("refineSuggestions drops a full set of templates", () => {
  const suggestions = refineSuggestions(
    [
      "Can you explain How lit mapps work",
      "What is the best next step for How lit mapps work?",
      "Can you give me a practical example",
      "What should I watch out for?",
    ],
    { userQuery: QUERY, answer: ANSWER }
  );
  assert.deepStrictEqual(suggestions, []);
});

test("refineSuggestions keeps grounded questions and adds missing question marks", () => {
  const suggestions = refineSuggestions(
    [
      "How does Litmaps choose its recommendations",
      "What happens after the 100 tracked papers cap?",
      "Can you give me a practical example",
    ],
    { userQuery: QUERY, answer: ANSWER }
  );
  assert.deepStrictEqual(suggestions, [
    "How does Litmaps choose its recommendations?",
    "What happens after the 100 tracked papers cap?",
  ]);
});

test("refineSuggestions collapses near-duplicates and honours the limit", () => {
  const suggestions = refineSuggestions(
    [
      "How do Litmaps alerts notify researchers?",
      "How do the Litmaps alerts notify researchers?",
      "What does the seed paper control?",
      "Which citation relationships are drawn as lines?",
      "How many papers does the free tier track?",
    ],
    { userQuery: QUERY, answer: ANSWER, limit: 3 }
  );
  assert.strictEqual(suggestions.length, 3);
  assert.ok(!suggestions.includes("How do the Litmaps alerts notify researchers?"));
});

test("refineSuggestions rejects placeholder leftovers", () => {
  const suggestions = refineSuggestions(
    ["How does {topic} handle citation maps?", "What does this topic cost for papers?"],
    { userQuery: QUERY, answer: ANSWER }
  );
  assert.deepStrictEqual(suggestions, []);
});

test("buildFollowUpMessages names rejected questions on a retry", () => {
  const messages = buildFollowUpMessages({
    userQuery: QUERY,
    answer: ANSWER,
    rejected: ["What should I watch out for?"],
  });
  assert.strictEqual(messages.length, 2);
  assert.match(messages[0].content, /do not produce anything like them/i);
  assert.match(messages[0].content, /What should I watch out for\?/);
  assert.match(messages[1].content, /Litmaps builds an interactive citation map/);
});
