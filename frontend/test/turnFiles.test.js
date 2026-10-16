import test from "node:test";
import assert from "node:assert/strict";

import { carryTurnFiles, dataUrlToFile, filesOfTurn, rememberTurnFiles } from "../src/lib/turnFiles.js";
import { IMAGE_ANSWER_STYLE, imageQuestion } from "../src/lib/imagePrompt.js";

const PNG_URL = "data:image/png;base64,iVBORw0KGgo=";

test("Retry sends the very files the message was sent with", () => {
  const photo = new File([new Uint8Array([1, 2, 3])], "cat.jpg", { type: "image/jpeg" });
  const doc = new File(["notes"], "notes.txt", { type: "text/plain" });
  const message = { role: "user", content: "what is this?", files: [{ name: "cat.jpg", size: 3, preview: PNG_URL }, { name: "notes.txt", size: 5, preview: null }] };
  rememberTurnFiles(message, [photo, doc]);
  assert.deepEqual(filesOfTurn(message), [photo, doc]);
});

test("after a reload, images come back from the saved previews", async () => {
  const saved = { role: "user", content: "what is this?", files: [{ name: "cat.png", size: 8, preview: PNG_URL }, { name: "notes.txt", preview: null }] };
  const files = filesOfTurn(saved);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "cat.png");
  assert.equal(files[0].type, "image/png");
  assert.deepEqual([...new Uint8Array(await files[0].arrayBuffer())], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(filesOfTurn({ role: "user", content: "hi" }), null);
  assert.equal(filesOfTurn(undefined), null);
});

test("an edited message keeps its attachments", () => {
  const photo = new File([new Uint8Array([9])], "a.png", { type: "image/png" });
  const original = { role: "user", content: "what is it" };
  const edited = { role: "user", content: "what breed is it" };
  rememberTurnFiles(original, [photo]);
  carryTurnFiles(original, edited);
  assert.deepEqual(filesOfTurn(edited), [photo]);
});

test("decodes plain data URLs too", async () => {
  const f = dataUrlToFile("data:text/plain,hello%20there", "a.txt");
  assert.equal(await f.text(), "hello there");
});

test("browser image prompt leads with the main subject and keeps the question", () => {
  assert.match(IMAGE_ANSWER_STYLE, /main subject/);
  const p = imageQuestion("what breed is this dog?");
  assert.ok(p.startsWith(IMAGE_ANSWER_STYLE));
  assert.ok(p.endsWith("Question: what breed is this dog?"));
  assert.ok(imageQuestion("").endsWith("Question: What is this?"));
  assert.match(imageQuestion("x", 1, 3), /image 2 of 3/);
  assert.doesNotMatch(imageQuestion("x"), /in detail/i);
});
