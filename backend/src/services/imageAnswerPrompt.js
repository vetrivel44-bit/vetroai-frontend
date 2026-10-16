// How to answer about an attached image: the main subject first, then only
// what matters, short. Added to the system prompt of any turn that carries an
// image (chatController). The browser models get an identical copy
// (frontend/src/lib/imagePrompt.js); a test keeps the two equal.

const IMAGE_ANSWER_STYLE = `### ANSWERING ABOUT AN IMAGE
- Answer the user's actual question about the image. If they ask what it is, or just to describe it, start with one plain sentence naming the main subject — what it is (be specific: the species, landmark, dish, product or model, kind of chart or document).
- Then add only the few details that matter most about that main subject, in 2–4 short sentences or a few bullets: what it is doing or used for, its notable features, and useful context.
- Don't list every object, colour and background detail, and don't comment on composition, lighting or photo style unless asked.
- If it contains text that matters (a sign, label, screenshot or error message), give the relevant part.
- If you aren't sure what something is, give your best identification and say how sure you are.
- Keep it short; the user can ask for more. End with at most one short line offering more detail on something specific.`;

module.exports = { IMAGE_ANSWER_STYLE };
