// Files attached earlier in a chat, for the turns after it.
//
// A document's text used to reach the model only on the turn it was attached
// to: the chat saved just its name. So "here's my worksheet" was answered, and
// the follow-up "now fill it out" reached the model with no worksheet, and it
// said it couldn't read the attached PDF. The text is now saved with the
// message it was sent with (`files[].text`), and sent again with later turns.
// The backend does the same budgeting for its own models (chatController.js).

// One file's saved text, and how much earlier files' text a turn carries.
export const DOC_TEXT_LIMIT = 20000;
export const EARLIER_DOCS_LIMIT = 20000;

// Documents arrive here already as text (PDF and Office files are converted
// when attached), so text types are the documents worth keeping.
export const isTextDocument = (file) =>
  !!file && typeof file.type === "string"
  && (file.type.startsWith("text/") || /^application\/(json|javascript|xml)$/.test(file.type));

// The text to save with a message for `file`, or null (images, raw binaries).
export async function documentText(file) {
  if (!isTextDocument(file)) return null;
  try {
    const text = (await file.text()).trim();
    if (!text || text.slice(0, 4000).includes("\u0000")) return null;
    return text.slice(0, DOC_TEXT_LIMIT);
  } catch {
    return null;
  }
}

// The text the server read from PDFs sent as they are (the browser couldn't
// read them), saved onto the files of the message they came with.
export function withServerText(files, read) {
  if (!Array.isArray(files) || !Array.isArray(read) || !read.length) return files;
  let changed = false;
  const out = files.map((f) => {
    if (!f || f.text) return f;
    const found = read.find((r) => r?.name === f.name && typeof r.text === "string" && r.text.trim());
    if (!found) return f;
    changed = true;
    return { ...f, text: found.text.slice(0, DOC_TEXT_LIMIT) };
  });
  return changed ? out : files;
}

const hasText = (f) => typeof f?.text === "string" && f.text.trim() !== "";

// The chat as sent to the backend. Earlier messages keep their files' text;
// the latest keeps names only, because its files are uploaded with it. Big
// image previews are never sent.
export function historyForServer(messages) {
  const last = messages.length - 1;
  return messages.map((m, i) => {
    if (!m?.files) return m;
    const { files, ...rest } = m;
    return {
      ...rest,
      files: files.map((f) => (i < last && m.role === "user" && hasText(f) ? { name: f.name, text: f.text } : { name: f?.name })),
    };
  });
}

// For models that run in the browser: earlier files' text put into the
// messages they were sent with, newest first within the budget, the same way
// the backend does it. Older files past the budget are named, so the model
// can ask for them again instead of guessing what they said.
export function withEarlierDocuments(messages, limit = EARLIER_DOCS_LIMIT) {
  let room = limit;
  const out = [...messages];
  for (let i = out.length - 2; i >= 0; i--) {
    const m = out[i];
    if (m?.role !== "user" || !Array.isArray(m.files)) continue;
    const blocks = [];
    for (const f of m.files.filter(hasText).slice(0, 10)) {
      const name = f.name || "file";
      const text = f.text.trim();
      if (room <= 0) {
        blocks.push(`[Earlier the user attached "${name}". Its text is no longer in view; if the answer needs it, say so and ask them to attach it again.]`);
        continue;
      }
      const piece = text.slice(0, Math.min(room, DOC_TEXT_LIMIT));
      room -= piece.length;
      blocks.push(`Attached file (${name}):\n${piece}${piece.length < text.length ? "\n[…the rest of this file was cut to fit. If the answer may be in the missing part, say so.]" : ""}`);
    }
    if (blocks.length) {
      out[i] = { ...m, content: `${m.content || "(no message)"}\n\n[Files the user attached with this message]\n${blocks.join("\n\n")}` };
    }
  }
  return out;
}
