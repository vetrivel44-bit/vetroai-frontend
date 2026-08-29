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

const convertImageFormat = async (dataUrl, format) => {
  const blob = await dataUrlToBlob(dataUrl);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const img = new Image();
  
  return new Promise((resolve, reject) => {
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      const mimeType = {
        png: "image/png",
        jpg: "image/jpeg",
        webp: "image/webp",
      }[format] || "image/png";
      
      const quality = format === "webp" ? 0.85 : undefined;
      canvas.toBlob((b) => resolve(b || blob), mimeType, quality);
    };
    img.onerror = () => reject(new Error(`Could not convert image to ${format.toUpperCase()}.`));
    img.src = URL.createObjectURL(blob);
  });
};

export const downloadImageWithFormat = async (src, format = "png") => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const ext = format === "jpg" ? "jpg" : format;
  const filename = `vetroai-image-${timestamp}.${ext}`;
  
  const blob = await convertImageFormat(src, format);
  downloadBlob(blob, filename);
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
