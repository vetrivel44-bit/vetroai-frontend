import { test } from "node:test";
import assert from "node:assert/strict";
import { friendly } from "../src/lib/voiceCoverEngine.js";

test("a used-up free GPU allowance is explained, with the fix", () => {
  const msg = friendly("You have exceeded your ZeroGPU runs limit. Authenticate with a Hugging Face token for more quota", "Plachta/Seed-VC");
  assert.match(msg, /free GPU time for today is used up/);
  assert.match(msg, /free Hugging Face token/);
});

test("other errors keep Hugging Face's own words", () => {
  assert.equal(friendly("CUDA out of memory", "Plachta/Seed-VC"), "Plachta/Seed-VC: CUDA out of memory");
  assert.match(friendly("", "x/y"), /did not return any audio/);
});
