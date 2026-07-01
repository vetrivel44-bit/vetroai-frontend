const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

const MEDICAL_API_HOST = "ai-doctor-api-ai-medical-chatbot-healthcare-ai-assistant.p.rapidapi.com";
const TTS_API_HOST = "text-to-speech141.p.rapidapi.com";

/**
 * Proxies a health question to the AI Doctor API (RapidAPI). Keeps the API key
 * server-side — this used to be called directly from the browser with the key
 * embedded in the bundle.
 */
async function fetchMedicalAnswer(query, specialization = "general medicine", language = "en") {
  const apiKey = config.chatgptApiKey;
  if (!apiKey) throw new ApiError(500, "Medical API key not configured.");

  try {
    const res = await fetch(`https://${MEDICAL_API_HOST}/chat?noqueue=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": MEDICAL_API_HOST,
        "x-rapidapi-key": apiKey,
      },
      body: JSON.stringify({ message: query, specialization, language }),
    });
    if (!res.ok) {
      logger.warn("medicalService.fetchMedicalAnswer.failed", { status: res.status });
      return null;
    }
    const data = await res.json();
    const answer = data?.response || data?.message || data?.answer || data?.reply;
    if (!answer) return null;
    return { answer, specialization };
  } catch (err) {
    logger.warn("medicalService.fetchMedicalAnswer.error", { error: err.message });
    return null;
  }
}

/**
 * Proxies text-to-speech synthesis (RapidAPI). Returns the raw audio buffer
 * and content-type so the controller can stream it straight to the client.
 */
async function synthesizeSpeech(text, voice = "en-US-JennyNeural") {
  const apiKey = config.chatgptApiKey;
  if (!apiKey) throw new ApiError(500, "TTS API key not configured.");

  const res = await fetch(`https://${TTS_API_HOST}/api/GenerateSpeech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": TTS_API_HOST,
      "x-rapidapi-key": apiKey,
    },
    body: JSON.stringify({ speech: text, voice }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new ApiError(502, `TTS API error: ${res.status} ${errText.slice(0, 200)}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return { buffer, contentType: sniffAudioMimeType(buffer) };
}

// The upstream API mislabels its Content-Type header (often "text/plain"), so
// detect the real format from the file's magic bytes instead of trusting it.
function sniffAudioMimeType(buffer) {
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") {
    return "audio/wav";
  }
  if (buffer.length >= 3 && buffer.toString("ascii", 0, 3) === "ID3") return "audio/mpeg";
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "audio/mpeg";
  return "audio/mpeg";
}

module.exports = { fetchMedicalAnswer, synthesizeSpeech };
