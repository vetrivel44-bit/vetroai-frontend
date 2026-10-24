// Chats keep attached pictures as data: URLs (`files[].preview`), up to the
// 20 MB attachment limit each. A handful of those filled the ~5 MB
// localStorage quota, after which nothing else could be saved on the device.
//
// The on-device cache therefore keeps only small data: URLs. Big ones are
// replaced by `thumb`, a downscaled copy made when the message is sent, so old
// chats still show the picture. The in-memory chat and the Firestore copy are
// not affected.

// Data URLs up to this many characters (~48 KB) are cheap enough to keep.
export const MAX_CACHED_DATA_URL = 64 * 1024;

const isBigDataUrl = (v) => typeof v === "string" && v.startsWith("data:") && v.length > MAX_CACHED_DATA_URL;

function trimFile(f) {
  if (!f || !isBigDataUrl(f.preview)) return f;
  const thumb = isBigDataUrl(f.thumb) ? null : f.thumb || null;
  return { ...f, preview: thumb, thumb: undefined };
}

function trimMessage(m) {
  if (!m || typeof m !== "object") return m;
  let out = m;
  if (Array.isArray(m.files) && m.files.some((f) => isBigDataUrl(f?.preview) || isBigDataUrl(f?.thumb))) {
    out = { ...out, files: m.files.map(trimFile) };
  }
  if (isBigDataUrl(m.generatedImageUrl)) out = { ...out, generatedImageUrl: null };
  return out;
}

/** The sessions list with large inline images swapped for thumbnails, for localStorage. */
export function trimSessionsForCache(list) {
  if (!Array.isArray(list)) return list;
  return list.map((s) => {
    if (!s || !Array.isArray(s.messages)) return s;
    const messages = s.messages.map(trimMessage);
    return messages.some((m, i) => m !== s.messages[i]) ? { ...s, messages } : s;
  });
}

/** Downscale an image data URL to a small JPEG for the device cache. Resolves null on failure. */
export function makeThumbnail(dataUrl, maxSide = 320, quality = 0.7) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return Promise.resolve(null);
  if (dataUrl.length <= MAX_CACHED_DATA_URL) return Promise.resolve(dataUrl);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
