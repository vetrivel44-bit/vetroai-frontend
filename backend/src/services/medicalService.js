const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

const MEDICAL_API_HOST = "ai-doctor-api-ai-medical-chatbot-healthcare-ai-assistant.p.rapidapi.com";

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

module.exports = { fetchMedicalAnswer };
