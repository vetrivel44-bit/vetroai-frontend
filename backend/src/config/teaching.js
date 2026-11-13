// How to teach, and how to explain again when someone didn't follow. "Teach
// me…", "explain…", "I can't understand", "explain it well" in any subject
// used to get the same dense, answer-shaped reply, and a second, louder copy
// of it after "I don't understand". This is how a great tutor works instead:
// find where they are, give the intuition before the jargon, an everyday
// picture, a worked example, then check it landed. Every model VetroAI uses
// gets it, on the turns that ask to be taught or say they didn't follow
// (teachingNeed): it's ~900 tokens, too many for every message on Groq.
//
// frontend/src/lib/teaching.js carries the same text for the models that
// answer in the browser; a test keeps the two equal.

const TEACHING = `# TEACHING AND EXPLAINING
When someone asks you to teach, explain or help them understand something, in any subject (maths, physics, chemistry, biology, programming, history, economics, accounts, law, grammar, a language, literature, music, anything), be the patient, brilliant tutor they wish they had. This overrides "be brief": a good explanation is as long as understanding needs, and no longer.
- Start where they are. Read their level from how they write and what they asked (a school student, a college exam, a professional) and pitch the words to it. If the level is really unclear and it changes everything, ask one short question; otherwise just begin.
- Big picture first: one or two plain sentences on what it is and why it matters or what problem it solves, before any definition or formula.
- Build from the familiar: an everyday picture or analogy from their world (cricket, cooking, a phone, money, a bus queue, a family), then map each part of it to the real idea, and say where the analogy stops working.
- One idea at a time, in the order it builds. Short sentences. Define every technical word the first time you use it, in plain words. Never use a term you haven't explained.
- Show, then tell: a concrete worked example with real numbers, a real sentence or a tiny piece of code, and walk through it step by step, saying why each step happens, not just what. Then state the general rule the example showed.
- Fit the subject: maths and science — the intuition, then a worked problem with every step and the units, then the formula; science — what you would see, why it happens, an everyday example, and a labelled diagram when shape or parts matter; programming — the problem it solves, a tiny runnable example, then trace what happens line by line; history and social studies — tell it as a story: who, when, why, what happened, what changed, why it matters today; languages and grammar — the rule in plain words, several examples, and the common mistakes; economics, commerce and accounts — a small real-life scenario with money and people; literature — what happens, then the ideas, with short examples.
- Name the usual mix-up or misconception and clear it up.
- Use a picture when it helps more than words (a flowchart, a labelled sketch or a table, see INLINE VISUALS).
- End with a 2–3 line recap of the key idea and one quick question that checks they really got it (a small "try this", not "Does that make sense?"). This replaces the no-closing-offer rule for teaching.
- Teach in the language and script they wrote in: Tanglish gets Tanglish, Hindi gets Hindi.

## WHEN THEY SAY THEY DIDN'T UNDERSTAND
"I can't understand", "not clear", "explain again", "explain it well", "simpler please", "still confused", "puriyala", "samajh nahi aaya" — your last explanation didn't work, so a longer or reworded copy of it won't either.
- Don't repeat it, don't defend it, and don't apologise at length; at most a few warm words ("No problem, let's try it another way.").
- Change the angle completely: a different, simpler analogy from everyday life, smaller steps, shorter sentences, fewer terms. Go one level more basic, and briefly cover the background idea the last explanation assumed (often that is the real gap).
- If they said which part lost them, explain that part and only that part.
- Lead with one very concrete example before any general statement, and use a small diagram if the idea has a shape or a flow.
- Keep it shorter and lighter than the last attempt, then end with one easy question to check it clicked, and offer to try yet another way if it still doesn't.`;

// Messages that ask to be taught, or say the last explanation didn't land.
// English as people type it, and the common Indian-language ways of saying
// "I didn't understand" in Latin script.
const CONFUSED = new RegExp([
  String.raw`\bi\s*(?:still\s+|really\s+|just\s+)?(?:can'?t|cannot|cant|could\s*n'?t|don'?t|dont|didn'?t|didnt|did\s+not|do\s+not|am\s+not\s+able\s+to|'?m\s+not\s+able\s+to)\s+(?:really\s+|fully\s+|quite\s+)?(?:understand|undrstand|understnd|get\s+(?:it|this|that)|follow|grasp)`,
  String.raw`^\s*(?:still\s+)?not\s+clear\b|\b(?:it'?s|its|this\s+is|that'?s|that\s+is|still|explanation\s+is|answer\s+is|isn'?t)\s+(?:still\s+)?(?:not\s+)?(?:clear|understandable)\b(?=\s*(?:$|[.!?,]|to\s+me|for\s+me|at\s+all|again|please|pls))|\bnot\s+getting\s+it\b`,
  String.raw`\b(?:i'?m|i\s+am|im|so|still|really|getting|totally|a\s+bit|very|bit)\s+(?:confused|lost)\b|\b(?:this|it|that)(?:'s|\s+is)\s+(?:so\s+|very\s+|too\s+)?confusing\b|^\s*(?:confused|confusing)\b`,
  String.raw`\bexplain\s+(?:it|this|that)\s+(?:again|better|well|properly|clearly|simply|more\s+simply|in\s+(?:a\s+)?simple(?:r)?(?:\s+(?:way|words|terms))?|in\s+(?:an?\s+)?(?:easy|easier)(?:\s+way)?|like\s+(?:i'?m|i\s+am)\s+(?:5|five|a\s+(?:kid|child|beginner)))|\bexplain\s+(?:me\s+)?(?:again|better|properly|well)\b|\b(?:once\s+more|one\s+more\s+time)\b.{0,20}\bexplain|\bexplain\b.{0,20}\b(?:once\s+more|one\s+more\s+time)\b`,
  String.raw`\b(?:simpler|easier)\s+(?:please|pls|way|words|version|explanation)\b`,
  String.raw`\b(?:too\s+(?:hard|complex|complicated|difficult|technical)|makes?\s+no\s+sense|over\s+my\s+head|you\s+lost\s+me|didn'?t\s+get\s+(?:it|that|this))\b`,
  // Tamil, Hindi, Telugu, Kannada, Malayalam, Marathi, Bengali (Latin script)
  String.raw`\b(?:puriya(?:la|le|lai|vill?ai|ala|lae)|puriyavae\s*illa|samajh?\s*(?:me\s+|mein\s+)?(?:nahi|nhi|nahin)|nahi\s+samjh?(?:a|i|e)|samjh?\s+nahi\s+aaya|ardham\s+(?:kaaledu|kaledu|avvaledu)|artha\s+(?:aagilla|agilla|aaglilla)|manassilay(?:illa|ilaa)|samajla\s+nahi|bujhte\s+parchi\s+na|bujhini)\b`,
].join("|"), "i");

const TEACH_ME = /\b(?:eli5|explain\s+.{1,80}?\s+(?:simply|in\s+simple(?:r)?\s+(?:words|terms|way)|in\s+(?:an?\s+)?easy\s+way|like\s+(?:i'?m|i\s+am)\s+(?:5|five|a\s+(?:kid|child|beginner)))|teach\s+me|help\s+me\s+(?:understand|learn)|make\s+me\s+understand|explain\s+(?:to\s+me\s+)?(?:how|why|what|the\s+concept|the\s+idea|this\s+concept|this\s+topic|in\s+detail)|i\s+(?:want|wanna|need)\s+to\s+(?:learn|understand)|can\s+you\s+(?:teach|explain)|explain\s+.{2,80}\s+(?:for|to)\s+(?:a\s+)?(?:beginner|student|kid|child|class\s*\d+|\d+(?:st|nd|rd|th)\s+(?:std|standard|grade)))\b/i;

/** "confused" when the message says the last explanation didn't land, "teach" when it asks to be taught, else null. */
function teachingNeed(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 1500) return null;
  // Saying the last reply didn't land is short; a long message that happens
  // to contain "not clear" is a question of its own.
  if (t.length <= 300 && CONFUSED.test(t)) return "confused";
  if (TEACH_ME.test(t)) return "teach";
  return null;
}

/**
 * For this turn only: what TEACHING asks of this message, so even a small
 * model teaches (or explains again a new way) instead of answering in its
 * usual shape. Empty for any other message.
 */
function teachingNote(text) {
  const need = teachingNeed(text);
  if (need === "confused") {
    return "[THIS MESSAGE]\nThe user did not understand your last explanation. Follow \"WHEN THEY SAY THEY DIDN'T UNDERSTAND\" in TEACHING: explain the same thing again from a completely different, simpler angle, starting from a very concrete everyday example. Do not repeat or reword your last reply. Keep it lighter than before and end with one easy question to check it clicked.";
  }
  if (need === "teach") {
    return "[THIS MESSAGE]\nThe user wants to learn this, not just get an answer. Teach it as TEACHING describes: big picture first, an everyday analogy mapped to the real idea, terms defined in plain words, a worked example step by step, the usual mix-up, then a short recap and one quick check question.";
  }
  return "";
}

module.exports = { TEACHING, teachingNeed, teachingNote };
