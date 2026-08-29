export const downloadBlob = (blob, filename) => {
  if (!(blob instanceof Blob)) throw new Error("Nothing to download.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
};

export const dataUrlToBlob = async (src) => {
  const response = await fetch(src);
  if (!response.ok) throw new Error("Could not prepare this file for download.");
  return response.blob();
};

export const downloadImage = async (src, filename = "vetroai-image.png") => {
  const blob = await dataUrlToBlob(src);
  downloadBlob(blob, filename);
};

export const shareImage = async (src, filename = "vetroai-image.png") => {
  const blob = await dataUrlToBlob(src);
  const file = new File([blob], filename, { type: blob.type || "image/png" });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ files: [file], title: "VetroAI image" });
    return true;
  }
  return false;
};
