import { editImage } from "../lib/imageGen";

const EDIT_RE = /\b(add|remove|replace|change|edit|modify|put|place|insert|erase|delete|move|recolor|retouch|extend|expand|background|next to|beside|behind|in front of|wearing|hair|clothes|outfit)\b/i;

export const isImageEditRequest = (text = "") => EDIT_RE.test(text);

// A message sent right after a generated image that asks to change it:
// "make the sky orange", "add a hat", "now in watercolor", "more vibrant".
// Questions about the image ("what is this?") still go to the chat model.
const FOLLOW_UP_RE = /^(now|make|turn|change|add|remove|replace|put|give|use|try|can you|could you|please|instead)\b|\b(make it|make the|make him|make her|make them|turn it|instead|more|less|brighter|darker|bigger|smaller|colou?r|style|version|background|in (?:the )?style of|as a|like a)\b/i;
export const isImageFollowUpEdit = (text = "") => {
  const t = String(text).trim();
  if (!t || t.length > 400 || /^(what|why|who|where|when|how|is|are|does|explain|describe|tell me)\b/i.test(t)) return false;
  return FOLLOW_UP_RE.test(t) || EDIT_RE.test(t);
};

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("Could not read the attached image."));
  reader.readAsDataURL(file);
});

// Edits attached photos with Gemini 3.1 Flash Lite Image (AI Router).
export const editImageWithGemini = async (prompt, inputFiles) => {
  const images = (inputFiles || []).filter((file) => file instanceof File && file.type.startsWith("image/"));
  if (!images.length) throw new Error("Attach an image to edit.");

  const identityPrompt = `Edit the supplied image instead of recreating it. Preserve the original person's identity and face exactly: facial geometry, eyes, nose, lips, jawline, skin tone, hairline, expression, age, body proportions, pose, camera perspective, lighting and all unchanged details. Do not beautify, restyle, regenerate, face-swap, or alter the original person unless the user explicitly requests that exact change. Make only this requested edit: ${prompt}`;
  return editImage(identityPrompt, await Promise.all(images.map(fileToDataUrl)));
};
