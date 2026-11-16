// Asking for a picture to be made, two ways:
//
// 1. Recognised in the message itself (detectImagePrompt), which goes
//    straight to the image model (App.jsx runImageJob). It used to miss
//    plurals ("create images of cats"), "pic", "cartoon", "i want an image
//    of…", and those went to the chat model, which said it couldn't make
//    images. It now also leaves a question about the ability ("can you create
//    images?") to the chat model, which says yes and how, instead of drawing a
//    picture of the question.
// 2. Recognised by the chat model, in any wording or language ("ஒரு பூனையின்
//    படம் உருவாக்கு"): it writes one short line and a ```image block with a
//    description of the picture (PICTURES_IN_CHAT in lib/aboutVetroAI.js and
//    the backend's), and the app makes the picture from it once the reply is
//    complete (imageBlockPrompt, App.jsx).
//
// Drawings and diagrams ("draw the heart", "sketch a circuit") are neither:
// they're drawn in the chat as a ```sketch (wantsDrawing).

// Asking to draw or sketch something, or for a drawing or diagram, is a
// drawing in the chat (a ```sketch, with a detailed version): only other
// image requests ("generate an image of…") go straight to the image model.
export const wantsDrawing = (text) => /\b(draw|drawing|sketch|diagram)\b/i.test(String(text || ""));

const MAKE = "generate|create|make|paint|design|render|produce|imagine|illustrate";
const WANT = "show me|give me|send me|get me|i want|i need|i'd like|can i (?:get|have|see)";
// Pictures in general: the word is dropped from what's sent ("an image of a
// cat" → "a cat").
// Typos too ("Generate imag of…" went to the chat model and was refused).
const PLAIN = "images?|imag|imges?|imgae|pictures?|pictur|picure|photos?|fotos?|pics?|renders?";
// Kinds of picture: the word is kept ("a logo for my bakery").
const KINDS = "artworks?|art|illustrations?|portraits?|logos?|wallpapers?|icons?|posters?|banners?|thumbnails?|graphics?|memes?|avatars?|covers?|cartoons?|paintings?|stickers?";
const ARTICLE = "(?:an?|the|some|two|three|four|few|\\d+)\\s+";
const LINKS = "(?:of|for|about|showing|that shows|with|where|in which)\\s+";

const MADE = new RegExp(`\\b(?:${MAKE})\\b.{0,80}?\\b(?:${PLAIN}|${KINDS})\\b`, "i");
// "show me a picture of…" (one picture: made); "show me photos of Ooty" stays
// a request for real photos (the gallery under the answer).
const WANTED = new RegExp(`\\b(?:${WANT})\\s+(?:${ARTICLE})?(?:(?:image|picture|pic)\\b|(?:${KINDS})\\b)`, "i");
// "can you create images?", "do you make logos" — about the ability.
const ABILITY = /^\s*(?:hey\s+|hi\s+)?(?:can|could|do|does|are|will|would|is it possible)\b/i;

const FILLER = /^(?:please|pls|kindly|for me|me)\s+/i;

/** What to picture: the request without the asking. "" when it names nothing. */
function subjectOf(text) {
  const kinds = new RegExp(`^.*?\\b(?:${MAKE}|${WANT})\\b\\s+(?:me\\s+)?(?:${ARTICLE})?(?:(${KINDS})\\s+)?(?:(?:${PLAIN})\\s+)?(${LINKS})?`, "i");
  const match = kinds.exec(text);
  if (!match) return "";
  let rest = text.slice(match[0].length).trim();
  while (FILLER.test(rest)) rest = rest.replace(FILLER, "");
  rest = rest.replace(/[?.!\s]+$/, "").trim();
  if (rest.length < 2) return "";
  // A kind of picture is part of what's wanted: "a logo for my bakery".
  return match[1] ? `a ${match[1].replace(/s$/i, "")} ${match[2] || "of "}${rest}`.replace(/\s+/g, " ").trim() : rest;
}

/**
 * The picture a message asks to be made, as the prompt for the image model,
 * or null when it doesn't ask for one (a drawing, a photo search, a question
 * about the ability, or no subject).
 */
export function detectImagePrompt(text) {
  const message = String(text || "").trim();
  if (!message || wantsDrawing(message)) return null;
  if (!MADE.test(message) && !WANTED.test(message)) return null;
  const subject = subjectOf(message);
  if (!subject) return null;
  // "Can you create images?" has no subject; "can you create an image of a
  // sunset?" does.
  if (ABILITY.test(message) && !new RegExp(`\\b(?:${PLAIN}|${KINDS})\\s+(?:${LINKS})`, "i").test(message) && subject.split(/\s+/).length < 2) return null;
  return subject;
}

// Words that describe a scene or a style rather than name a subject.
const SCENE = /\b(?:as|with|in|on|at|and|of|from|wearing|playing|riding|holding|doing|eating|drinking|sitting|standing|walking|running|flying|dancing|fighting|singing|style|styled|version|cartoon|anime|logo|poster|wallpaper|superhero|realistic|cute|happy|sad|angry)\b/i;

/**
 * The name a picture request starts with, when it may be a real person:
 * "Kajal Aggarwal" in "Kajal Agarwal as a superhero", "virat kohli". The
 * words before any scene or style, up to four, not "a…"/"the…". VetroAI
 * doesn't make AI pictures of real people; it shows real photos of them
 * instead (App.jsx asks the server, which checks Wikipedia:
 * /api/photos?person=1). null when there's no such name.
 */
export function personCandidate(subject) {
  const words = String(subject || "").trim().replace(/[?.!,]+$/, "").split(/\s+/).filter(Boolean);
  const cut = words.findIndex((w) => SCENE.test(w));
  const name = cut === -1 ? words : words.slice(0, cut);
  if (!name.length || name.length > 4) return null;
  if (/^(?:an?|the|some|my|our|your|his|her|their|this|that|two|three|\d+)$/i.test(name[0])) return null;
  return name.join(" ");
}

const IMAGE_BLOCK = /```image[^\n]*\n([\s\S]*?)(?:```|$)/i;

/** The description in a reply's ```image block, or null. */
export function imageBlockPrompt(content) {
  const match = IMAGE_BLOCK.exec(String(content || ""));
  const prompt = match ? match[1].replace(/\s+/g, " ").trim() : "";
  return prompt.length >= 3 ? prompt.slice(0, 1500) : null;
}

/** The reply without its ```image block. */
export function withoutImageBlock(content) {
  return String(content || "").replace(IMAGE_BLOCK, "").replace(/\n{3,}/g, "\n\n").trim();
}
