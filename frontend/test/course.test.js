import test from "node:test";
import assert from "node:assert/strict";

import { isCourseRequest, courseMarkdown, applyCourseEvent } from "../src/lib/course.js";

test("a request for a whole course is recognised", () => {
  for (const q of [
    "teach me node js like from starting to end for begginers",
    "Teach me Python from scratch",
    "complete course on React",
    "learn SQL from zero to hero",
    "teach me java a to z",
    "teach me photography for beginners as a pdf",
    "give me a full guide to machine learning",
  ]) assert.equal(isCourseRequest(q), true, q);
});

test("ordinary questions are answered in chat as before", () => {
  for (const q of [
    "what is node js",
    "teach me how to tie a tie",
    "fix this python function",
    "explain photosynthesis",
    "give this as a pdf",
    "Teach me photosynthesis, then give me a 4-question quiz",
  ]) assert.equal(isCourseRequest(q), false, q);
});

test("events build the course, and it becomes one book with contents", () => {
  let course = { title: "", chapters: [], phase: "running" };
  course = applyCourseEvent(course, { type: "outline", data: { title: "Node.js from Zero", audience: "Beginners", chapters: [{ title: "Setup" }, { title: "Modules" }, { title: "Express" }] } });
  course = applyCourseEvent(course, { type: "chapter", data: { n: 2, title: "Modules", markdown: "## Chapter 2: Modules\n\nText." } });
  course = applyCourseEvent(course, { type: "chapter", data: { n: 1, title: "Setup", markdown: "# Chapter 1: Setup\n\nText." } });
  course = applyCourseEvent(course, { type: "chapter_failed", data: { n: 3, title: "Express" } });
  course = applyCourseEvent(course, { type: "done", data: {} });
  assert.equal(course.phase, "done");
  assert.deepEqual(course.chapters.map((c) => c.state), ["done", "done", "failed"]);

  const book = courseMarkdown(course);
  assert.match(book, /^# Node\.js from Zero/);
  assert.match(book, /## Contents\n\n1\. Setup\n2\. Modules\n3\. Express \(not written\)/);
  // Chapters in order, and a chapter's own "# " title becomes a chapter heading.
  assert.ok(book.indexOf("## Chapter 1: Setup") < book.indexOf("## Chapter 2: Modules"));
  assert.doesNotMatch(book, /^# Chapter/m);
});
