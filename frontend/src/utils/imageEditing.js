const EDIT_RE = /\b(add|remove|replace|change|edit|modify|put|place|insert|erase|delete|move|recolor|retouch|extend|expand|background|next to|beside|behind|in front of|wearing|hair|clothes|outfit)\b/i;

export const isImageEditRequest = (text = "") => EDIT_RE.test(text);

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("Could not read the attached image."));
  reader.readAsDataURL(file);
});

export const editImageViaBackend = async (prompt, inputFiles, apiBase) => {
  const images = (inputFiles || []).filter((file) => file instanceof File && file.type.startsWith("image/"));
  if (!images.length) throw new Error("Attach an image to edit.");
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("image", images[0]);
  const response = await fetch(`${apiBase}/images/generate`, { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Image editing failed.");
  if (!data.image) throw new Error("Image editing returned no image.");
  return data.image;
};
