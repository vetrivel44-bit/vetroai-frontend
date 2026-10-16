// Same image-answer guidance the backend adds (backend/src/services/imageAnswerPrompt.js),
// for the models that read images in the browser. A backend test keeps the two equal.
export const IMAGE_ANSWER_STYLE = "### ANSWERING ABOUT AN IMAGE\n- Answer the user's actual question about the image. If they ask what it is, or just to describe it, start with one plain sentence naming the main subject — what it is (be specific: the species, landmark, dish, product or model, kind of chart or document).\n- Then add only the few details that matter most about that main subject, in 2–4 short sentences or a few bullets: what it is doing or used for, its notable features, and useful context.\n- Don't list every object, colour and background detail, and don't comment on composition, lighting or photo style unless asked.\n- If it contains text that matters (a sign, label, screenshot or error message), give the relevant part.\n- If you aren't sure what something is, give your best identification and say how sure you are.\n- Keep it short; the user can ask for more. End with at most one short line offering more detail on something specific.";

// The prompt for a browser vision model, which gets no system prompt: the
// guidance, then the question (or "What is this?" when none was typed).
export function imageQuestion(question, index = 0, count = 1) {
  const q = String(question || "").trim() || "What is this?";
  const which = count > 1 ? `\n\n(This is image ${index + 1} of ${count}.)` : "";
  return `${IMAGE_ANSWER_STYLE}\n\nQuestion: ${q}${which}`;
}
