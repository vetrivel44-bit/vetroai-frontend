// A ```quiz block: the multiple-choice test the tutor offers after teaching a
// topic. The model writes JSON; the chat plays it one question at a time and
// ends with the score and a simple explanation (with an example) for each
// mistake.
//
// {"title": "Photosynthesis", "questions": [{
//    "question": "…", "options": ["…", "…", "…", "…"], "answer": "B",
//    "explanation": "why the answer is right, in simple words",
//    "example": "an everyday example that makes it click"}]}
//
// "answer" may be a letter (A–D), a 0-based index, or the option's text.

export const LETTERS = ["A", "B", "C", "D", "E", "F"];

function answerIndex(answer, options) {
  if (Number.isInteger(answer)) return answer;
  const s = String(answer ?? "").trim();
  if (/^[A-Fa-f]$/.test(s)) return LETTERS.indexOf(s.toUpperCase());
  if (/^[A-Fa-f][).:]/.test(s) && !options.includes(s)) return LETTERS.indexOf(s[0].toUpperCase());
  if (/^\d+$/.test(s)) return Number(s);
  return options.findIndex((o) => o.trim().toLowerCase() === s.toLowerCase());
}

const text = (v) => (v == null ? "" : String(v).trim());

export function parseQuiz(code) {
  const data = JSON.parse(String(code).trim().replace(/,\s*([}\]])/g, "$1"));
  const list = Array.isArray(data) ? data : data?.questions;
  if (!Array.isArray(list) || !list.length) throw new Error("no questions");
  const questions = list.map((q, i) => {
    const options = (Array.isArray(q?.options) ? q.options : []).map(text).slice(0, LETTERS.length);
    if (!text(q?.question)) throw new Error(`question ${i + 1} has no text`);
    if (options.length < 2) throw new Error(`question ${i + 1} needs at least 2 options`);
    const answer = answerIndex(q.answer ?? q.correct, options);
    if (!(answer >= 0 && answer < options.length)) throw new Error(`question ${i + 1} has no valid answer`);
    return { question: text(q.question), options, answer, explanation: text(q.explanation), example: text(q.example) };
  });
  return { title: text(Array.isArray(data) ? "" : data.title) || "Quick quiz", questions };
}

// picks: the chosen option index per question (null when skipped).
export function scoreQuiz(quiz, picks) {
  const mistakes = [];
  let score = 0;
  quiz.questions.forEach((q, i) => {
    if (picks[i] === q.answer) score++;
    else mistakes.push({ index: i, picked: picks[i] ?? null, ...q });
  });
  const total = quiz.questions.length;
  return { score, total, percent: total ? Math.round((score / total) * 100) : 0, mistakes };
}

export function verdict(percent) {
  if (percent === 100) return "Perfect score — you’ve mastered this!";
  if (percent >= 80) return "Great job — just a small gap to close.";
  if (percent >= 50) return "Good effort — review the mistakes below and try again.";
  return "Keep going — read the simple explanations below, then retry.";
}
