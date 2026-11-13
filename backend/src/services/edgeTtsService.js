"use strict";

// Free Microsoft Edge neural voices (Edge's "Read Aloud" service) for the
// voice picker: Ava, Andrew, Emma, Brian (the newer conversational voices),
// Jenny, Aria, Guy, Sonia, Ryan, Neerja, Prabhat... No API key and no
// billing. Runs server-side only (the service requires an Edge user agent,
// which browsers other than Edge cannot send).

let modulePromise = null;
const loadEdge = () => (modulePromise ||= import("msedge-tts"));

const NEURAL_VOICE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$/;
const isEdgeVoice = (voice) => NEURAL_VOICE.test(String(voice || ""));

// The free service turns away a burst of connections from one address, and a
// clip it turns away is read by the next voice in line (a different one),
// so a reply could change voice half way. Only a few clips are made at once;
// the rest wait their turn, which takes far less time than a clip lasts.
const MAX_AT_ONCE = 4;
let inFlight = 0;
const waiting = [];
async function turn() {
  if (inFlight < MAX_AT_ONCE) { inFlight++; return; }
  await new Promise((resolve) => waiting.push(resolve));
}
function done() {
  const next = waiting.shift();
  if (next) next(); else inFlight--;
}

// rate: speaking speed relative to the voice's own, "+6%" / "-10%".
async function synthesize(text, options = {}) {
  await turn();
  try {
    return await synthesizeNow(text, options);
  } finally {
    done();
  }
}

async function synthesizeNow(text, { voice = "en-US-AvaMultilingualNeural", rate, timeoutMs = 25000 } = {}) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await loadEdge();
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT?.AUDIO_24KHZ_48KBITRATE_MONO_MP3 || "audio-24khz-48kbitrate-mono-mp3");
    // msedge-tts drops the text into its SSML as-is, so escape XML here or a
    // reply containing "&" or "<" would break the request.
    const ssmlText = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const { audioStream } = await tts.toStream(ssmlText, rate ? { rate } : undefined);
    const chunks = [];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Edge neural voice timed out")), timeoutMs);
      const done = () => { clearTimeout(timer); resolve(); };
      audioStream.on("data", (data) => chunks.push(Buffer.from(data)));
      audioStream.on("end", done);
      audioStream.on("close", done);
      audioStream.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
    const buffer = Buffer.concat(chunks);
    if (buffer.length < 200) throw new Error("Edge neural voice returned no audio");
    return { buffer, contentType: "audio/mpeg", provider: "edge-neural" };
  } finally {
    try { tts.close?.(); } catch { /* already closed */ }
  }
}

/**
 * The voices to try for `voice`, best first: the newer conversational voices
 * ("…MultilingualNeural", "…ExpressiveNeural") fall back to the classic voice
 * of the same name, then to Jenny, in case the free service drops one.
 */
function voiceFallbacks(voice) {
  const list = [voice];
  const classic = String(voice || "").replace(/(Multilingual|Expressive)Neural$/, "Neural");
  if (classic !== voice) list.push(classic);
  if (!list.includes("en-US-JennyNeural") && String(voice || "").startsWith("en-")) list.push("en-US-JennyNeural");
  return list.filter(isEdgeVoice);
}

module.exports = { synthesize, isEdgeVoice, voiceFallbacks };
