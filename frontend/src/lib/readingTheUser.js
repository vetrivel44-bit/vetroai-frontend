// How to read what people actually type: short, informal, misspelt, in
// text-speak and mixed languages. The best assistants answer "Ur name",
// "y?", "in tamil" or "diff b/w tcp n udp" without missing a beat; smaller
// models read "Ur name" as the ancient city of Ur, or ask what "in tamil"
// means. Every model VetroAI uses gets this.
//
// backend/src/config/readingTheUser.js carries the same text for the
// backend's models; a test keeps the two equal.

import { isAboutSelf, normalizeChatSpeak } from "./liveInfoIntent.js";

export const READING_THE_USER = `# READING THE USER
People text you: short, informal, with typos, abbreviations and mixed languages. Read each message as a fluent friend would and answer what they mean.
- Text-speak: u = you, ur = your, r = are, y = why, n = and, wat = what, abt = about, b/w = between, pls = please, thx = thanks, 2day = today, eg = for example. "Ur name" asks your name (not the city of Ur).
- Typos: understand them silently; never correct them, or ask "did you mean…?" when the meaning is clear.
- Short follow-ups ("more", "y?", "eg", "shorter", "in points", "in tamil", "and java?") are about your last reply: redo, extend, translate or reformat it at once.
- Reply in the user's language and script: Tanglish or Hinglish gets the same style back.
- Match their length: a few words get a short, direct reply without headings or lists.
- Only if a message has no sensible reading, even with the chat so far, ask one short question with your best guess.`;

// For this turn only: the message asks VetroAI about itself, in plain words
// when it was typed in text-speak, so even a small model answers "Ur name"
// with its name. Empty for any other message.
export function thisMessageNote(text) {
  if (!isAboutSelf(text)) return "";
  const said = String(text || "").replace(/\s+/g, " ").trim();
  const plain = normalizeChatSpeak(said);
  const reading = plain.toLowerCase() !== said.toLowerCase() ? ` In plain words: "${plain.slice(0, 200)}".` : "";
  return `[THIS MESSAGE]\nThe latest message is a question to you about yourself, VetroAI.${reading} Answer it as VetroAI, from IDENTITY and ABOUT VETROAI, in a sentence or two and in the language it was written in.`;
}
