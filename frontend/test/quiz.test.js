import test from "node:test";
import assert from "node:assert/strict";

import { parseQuiz, scoreQuiz, verdict } from "../src/lib/quiz.js";

const QUIZ = JSON.stringify({
  title: "Organs",
  questions: [
    { question: "Makes bile?", options: ["Brain", "Kidney", "Liver", "Pancreas"], answer: "C", explanation: "The liver makes bile.", example: "Like soap on grease." },
    { question: "Pumps blood?", options: ["Heart", "Lung"], answer: 0 },
    { question: "Filters blood?", options: ["Skin", "Kidney"], answer: "Kidney", },
  ],
});

test("answers may be a letter, an index or the option text", () => {
  const quiz = parseQuiz(QUIZ);
  assert.equal(quiz.title, "Organs");
  assert.deepEqual(quiz.questions.map((q) => q.answer), [2, 0, 1]);
  assert.equal(quiz.questions[0].example, "Like soap on grease.");
});

test("bad quizzes are rejected so the chat shows the code instead", () => {
  assert.throws(() => parseQuiz('{"questions": []}'), /no questions/);
  assert.throws(() => parseQuiz('{"questions": [{"question": "x", "options": ["a", "b"], "answer": "D"}]}'), /no valid answer/);
  assert.throws(() => parseQuiz('{"questions": [{"question": "x", "options": ["a"], "answer": 0}]}'), /at least 2/);
});

test("score counts right picks and lists every mistake with its explanation", () => {
  const quiz = parseQuiz(QUIZ);
  const result = scoreQuiz(quiz, [1, 0, null]);
  assert.equal(result.score, 1);
  assert.equal(result.total, 3);
  assert.equal(result.percent, 33);
  assert.deepEqual(result.mistakes.map((m) => [m.index, m.picked]), [[0, 1], [2, null]]);
  assert.equal(result.mistakes[0].explanation, "The liver makes bile.");
  assert.match(verdict(100), /Perfect/);
});
