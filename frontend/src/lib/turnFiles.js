// The files a user message was sent with, so Retry and Edit can send them
// again. Without them a regenerated "what is this?" reached the model with no
// picture, and it asked the user to upload it again.
//
// The original File objects are kept in memory, keyed by the message object.
// After a reload only the saved message is left: its images come back from the
// data: URL previews it keeps; other files' contents are never saved.

const sentFiles = new WeakMap();

export function rememberTurnFiles(message, files) {
  if (message && files?.length) sentFiles.set(message, [...files]);
}

export function dataUrlToFile(url, name = "image") {
  const [head, data = ""] = String(url).split(",");
  const type = head.match(/^data:([^;,]+)/)?.[1] || "application/octet-stream";
  const bytes = /;base64$/.test(head) ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(data));
  return new File([bytes], name, { type });
}

// File[] to send again with this message, or null.
export function filesOfTurn(message) {
  if (!message) return null;
  const kept = sentFiles.get(message);
  if (kept?.length) return kept;
  const images = (message.files || [])
    .filter((f) => typeof f?.preview === "string" && f.preview.startsWith("data:image/"))
    .map((f) => dataUrlToFile(f.preview, f.name || "image"));
  return images.length ? images : null;
}

// An edited message replaces the original: it keeps the attachments.
export function carryTurnFiles(from, to) {
  const kept = sentFiles.get(from);
  if (kept) sentFiles.set(to, kept);
}
