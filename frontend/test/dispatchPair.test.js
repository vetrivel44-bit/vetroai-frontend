import { test } from "node:test";
import assert from "node:assert/strict";
import { isComputerDevice, isOnline, maskEmail, pairLink, pairMatchesAccount, phoneLabel, readPairLink } from "../src/lib/dispatchCore.js";

test("a pairing link round-trips through the QR code URL", () => {
  const link = pairLink("https://vetroai-frontend.pages.dev/", { deviceId: "dev_abc-123", uid: "UID1234567890xyz", email: "vel21873@gmail.com" });
  const url = new URL(link);
  assert.equal(url.origin + url.pathname, "https://vetroai-frontend.pages.dev/");
  const pair = readPairLink(url.search);
  assert.deepEqual(pair, { deviceId: "dev_abc-123", acct: "UID1234567", as: "ve•••@gmail.com" });
  assert.ok(!link.includes("vel21873"), "the full email is not in the link");
});

test("only the signed-in account the code was made for matches", () => {
  const pair = readPairLink("?dispatch=dev_1&acct=UID1234567");
  assert.equal(pairMatchesAccount(pair, "UID1234567890xyz"), true);
  assert.equal(pairMatchesAccount(pair, "someoneElse999"), false);
});

test("malformed or missing pairing params are ignored", () => {
  assert.equal(readPairLink(""), null);
  assert.equal(readPairLink("?billing=success"), null);
  assert.equal(readPairLink("?dispatch=<script>"), null);
});

test("helpers: masked email, phone names, phones never count as computers", () => {
  assert.equal(maskEmail("ab@x.com"), "ab•••@x.com");
  assert.equal(maskEmail("nope"), "");
  assert.equal(phoneLabel("Mozilla/5.0 (Linux; Android 14)"), "Android phone");
  assert.equal(phoneLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"), "iPhone");
  const phone = { kind: "phone", accepting: false, lastSeen: Date.now() };
  assert.equal(isComputerDevice(phone), false);
  assert.equal(isOnline(phone), false);
  assert.equal(isComputerDevice({ name: "Windows PC" }), true);
});
