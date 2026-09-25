import { createContext } from "react";

// A ```choices block: when a request is unclear, the assistant asks back with
// tappable options instead of guessing. Tapping one sends it as the user's
// next message.
//
// {"question": "Which topic should I explain?", "multi": false, "other": true,
//  "options": [{"label": "Photosynthesis", "description": "How plants make food"}, "Respiration"]}

const text = (v) => (v == null ? "" : String(v).trim());

export function parseChoices(code) {
  const data = JSON.parse(String(code).trim().replace(/,\s*([}\]])/g, "$1"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("expected a JSON object");
  const question = text(data.question);
  if (!question) throw new Error("missing \"question\"");
  const options = (Array.isArray(data.options) ? data.options : [])
    .map((o) => (typeof o === "object" && o ? { label: text(o.label), description: text(o.description) } : { label: text(o), description: "" }))
    .filter((o) => o.label)
    .slice(0, 6);
  if (options.length < 2) throw new Error("needs at least 2 options");
  return { question, options, multi: data.multi === true, other: data.other !== false };
}

// The message a pick sends: the option labels, or what was typed under Other.
export function choiceReply(options, picked, otherText) {
  const labels = options.filter((_, i) => picked.includes(i)).map((o) => o.label);
  const typed = text(otherText);
  if (typed) labels.push(typed);
  return labels.join(", ");
}

// Supplied per assistant message by the chat: { canReply, reply }. `canReply`
// marks the newest reply (its options are docked above the input box);
// `reply` is the user's next message once the question was answered.
export const ReplyContext = createContext(null);

// The last ```choices block in a reply, parsed, or null. The chat docks it
// above the input box while it is the newest, unanswered message.
export function findChoices(content) {
  const blocks = [...String(content || "").matchAll(/```choices[^\n]*\n([\s\S]*?)```/g)];
  if (!blocks.length) return null;
  try { return parseChoices(blocks[blocks.length - 1][1]); } catch { return null; }
}
