"use strict";

// Free Google text-to-speech: the voice behind Google Translate.
//
// No API key and no billing account are needed (it is the endpoint the
// open-source gTTS library uses), so speech works out of the box. Google caps
// each request at ~200 characters, so longer text is split at sentence/word
// boundaries and the MP3 pieces are joined; MP3 frames concatenate cleanly.

const MAX_CHUNK = 180;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
// Regional accents come from the Google domain, not the language code.
const REGION_TLD = { US: "com", GB: "co.uk", AU: "com.au", IN: "co.in", CA: "ca", IE: "ie", ZA: "co.za", NZ: "co.nz" };
// Translate's codes for languages whose BCP-47 tag differs.
const LANG_ALIASES = { zh: "zh-CN", fil: "tl", he: "iw" };

function splitText(text, max = MAX_CHUNK) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks = [];
  let current = "";
  for (let word of words) {
    while (word.length > max) {
      if (current) { chunks.push(current); current = ""; }
      chunks.push(word.slice(0, max));
      word = word.slice(max);
    }
    if (!word) continue;
    const next = current ? `${current} ${word}` : word;
    if (next.length > max) { chunks.push(current); current = word; } else current = next;
    // Prefer to break at the end of a sentence once a chunk has some length.
    if (/[.!?;:]$/.test(current) && current.length > max * 0.5) { chunks.push(current); current = ""; }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** "en-US-JennyNeural" / "hi-IN" / "ta" -> { tl: "en", tld: "com" } */
function resolveLanguage(languageCode = "en-US") {
  const match = String(languageCode || "").match(/^([a-zA-Z]{2,3})(?:[-_]([a-zA-Z]{2}))?/);
  const lang = (match?.[1] || "en").toLowerCase();
  const region = (match?.[2] || "").toUpperCase();
  return { tl: LANG_ALIASES[lang] || lang, tld: (lang === "en" && REGION_TLD[region]) || "com" };
}

async function fetchChunkDirect(chunk, idx, total, tl, tld) {
  const url = `https://translate.google.${tld}/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(tl)}`
    + `&q=${encodeURIComponent(chunk)}&total=${total}&idx=${idx}&textlen=${chunk.length}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: `https://translate.google.${tld}/` } });
  if (!res.ok) throw new Error(`Google free TTS returned ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 100) throw new Error("Google free TTS returned no audio");
  return buffer;
}

// Same voice through Translate's web RPC, used when the direct endpoint refuses.
async function fetchChunkRpc(chunk, tl, tld) {
  const rpc = JSON.stringify([[["jQ1olc", JSON.stringify([chunk, tl, null, "null"]), null, "generic"]]]);
  const res = await fetch(`https://translate.google.${tld}/_/TranslateWebserverUi/data/batchexecute`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8", "User-Agent": UA, Referer: `https://translate.google.${tld}/` },
    body: `f.req=${encodeURIComponent(rpc)}`,
  });
  if (!res.ok) throw new Error(`Google free TTS (rpc) returned ${res.status}`);
  const match = (await res.text()).match(/jQ1olc","\[\\"(.*?)\\"\]/);
  if (!match?.[1]) throw new Error("Google free TTS (rpc) returned no audio");
  return Buffer.from(match[1], "base64");
}

async function fetchChunk(chunk, idx, total, tl, tld) {
  try {
    return await fetchChunkDirect(chunk, idx, total, tl, tld);
  } catch (directErr) {
    try { return await fetchChunkRpc(chunk, tl, tld); } catch { throw directErr; }
  }
}

/**
 * Speak `text` with Google's free voice.
 * @returns {Promise<{ buffer: Buffer, contentType: string, provider: string }>}
 */
async function synthesize(text, { languageCode = "en-US" } = {}) {
  const chunks = splitText(text);
  if (!chunks.length) throw new Error("Nothing to speak.");
  const { tl, tld } = resolveLanguage(languageCode);
  const parts = new Array(chunks.length);
  // A few requests at a time: quick for a paragraph, polite to Google.
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      parts[i] = await fetchChunk(chunks[i], i, chunks.length, tl, tld);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, worker));
  return { buffer: Buffer.concat(parts), contentType: "audio/mpeg", provider: "google-free" };
}

module.exports = { synthesize, splitText, resolveLanguage };
