const EDIT_RE = /\b(add|remove|replace|change|edit|modify|put|place|insert|erase|delete|move|recolor|retouch|extend|expand|background|next to|beside|behind|in front of|wearing|hair|clothes|outfit)\b/i;

export const isImageEditRequest = (text = "") => EDIT_RE.test(text);

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("Could not read the attached image."));
  reader.readAsDataURL(file);
});

const normalizeImageResult = async (image) => {
  const src = image?.src || image?.url;
  if (!src) throw new Error("GPT Image 2 returned an empty image.");
  if (!src.startsWith("blob:")) return src;
  const response = await fetch(src);
  if (!response.ok) throw new Error("GPT Image 2 returned an unreadable image.");
  return fileToDataUrl(await response.blob());
};

export const editImageViaPuter = async (prompt, inputFiles) => {
  if (!window.puter?.ai?.txt2img) throw new Error("GPT Image 2 could not load. Refresh and try again.");
  const images = (inputFiles || []).filter((file) => file instanceof File && file.type.startsWith("image/"));
  if (!images.length) throw new Error("Attach an image to edit.");

  const identityPrompt = `Edit the supplied image instead of recreating it. Preserve the original person's identity and face exactly: facial geometry, eyes, nose, lips, jawline, skin tone, hairline, expression, age, body proportions, pose, camera perspective, lighting and all unchanged details. Do not beautify, restyle, regenerate, face-swap, or alter the original person unless the user explicitly requests that exact change. Make only this requested edit: ${prompt}`;
  const inputImages = await Promise.all(images.map(fileToDataUrl));
  const result = await window.puter.ai.txt2img(identityPrompt, {
    model: "gpt-image-2",
    input_images: inputImages,
  });
  return normalizeImageResult(result);
};
