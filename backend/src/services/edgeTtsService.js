"use strict";

// Free Microsoft Edge neural voices (Edge's "Read Aloud" service) for the
// voice picker: Jenny, Aria, Guy, Steffan, Sonia, Ryan, Neerja, Prabhat...
// No API key and no billing. Runs server-side only (the service requires an
// Edge user agent, which browsers other than Edge cannot send).

let modulePromise = null;
const loadEdge = () => (modulePromise ||= import("msedge-tts"));

const NEURAL_VOICE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$/;
const isEdgeVoice = (voice) => NEURAL_VOICE.test(String(voice || ""));

async function synthesize(text, { voice = "en-US-JennyNeural", timeoutMs = 25000 } = {}) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await loadEdge();
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT?.AUDIO_24KHZ_48KBITRATE_MONO_MP3 || "audio-24khz-48kbitrate-mono-mp3");
    // msedge-tts drops the text into its SSML as-is, so escape XML here or a
    // reply containing "&" or "<" would break the request.
    const ssmlText = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const { audioStream } = await tts.toStream(ssmlText);
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

module.exports = { synthesize, isEdgeVoice };
