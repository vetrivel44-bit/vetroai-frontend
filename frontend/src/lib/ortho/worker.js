// Works a drawing out off the main thread (a busy part takes a second or
// more on a phone), so the chat keeps scrolling meanwhile.
import { renderOrtho } from "./index.js";

self.onmessage = (event) => {
  const { id, code } = event.data || {};
  let result;
  try { result = renderOrtho(code); } catch (err) { result = { error: `The drawing couldn't be worked out (${err?.message || err}).` }; }
  self.postMessage({ id, result });
};
