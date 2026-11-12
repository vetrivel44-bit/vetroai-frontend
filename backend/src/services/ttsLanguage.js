"use strict";

// Natural voices for replies that aren't in the picked voice's language. The
// picked voice (Jenny, Guy, Neerja…) is English; asked to read Tamil or Hindi it
// either fails or sounds robotic. The app sends the reply's language ("ta",
// "hi"…) and it is read by Microsoft's free neural voice for that language,
// matching the picked voice's gender.

// [female, male] Edge neural voices per language.
const NATIVE_VOICES = {
  hi: ["hi-IN-SwaraNeural", "hi-IN-MadhurNeural"],
  ta: ["ta-IN-PallaviNeural", "ta-IN-ValluvarNeural"],
  te: ["te-IN-ShrutiNeural", "te-IN-MohanNeural"],
  kn: ["kn-IN-SapnaNeural", "kn-IN-GaganNeural"],
  ml: ["ml-IN-SobhanaNeural", "ml-IN-MidhunNeural"],
  bn: ["bn-IN-TanishaaNeural", "bn-IN-BashkarNeural"],
  mr: ["mr-IN-AarohiNeural", "mr-IN-ManoharNeural"],
  gu: ["gu-IN-DhwaniNeural", "gu-IN-NiranjanNeural"],
  ur: ["ur-IN-GulNeural", "ur-IN-SalmanNeural"],
  ne: ["ne-NP-HemkalaNeural", "ne-NP-SagarNeural"],
  si: ["si-LK-ThiliniNeural", "si-LK-SameeraNeural"],
  ar: ["ar-SA-ZariyahNeural", "ar-SA-HamedNeural"],
  zh: ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"],
  ja: ["ja-JP-NanamiNeural", "ja-JP-KeitaNeural"],
  ko: ["ko-KR-SunHiNeural", "ko-KR-InJoonNeural"],
  ru: ["ru-RU-SvetlanaNeural", "ru-RU-DmitryNeural"],
  th: ["th-TH-PremwadeeNeural", "th-TH-NiwatNeural"],
  el: ["el-GR-AthinaNeural", "el-GR-NestorasNeural"],
  he: ["he-IL-HilaNeural", "he-IL-AvriNeural"],
  es: ["es-ES-ElviraNeural", "es-ES-AlvaroNeural"],
  fr: ["fr-FR-DeniseNeural", "fr-FR-HenriNeural"],
  de: ["de-DE-KatjaNeural", "de-DE-ConradNeural"],
  pt: ["pt-BR-FranciscaNeural", "pt-BR-AntonioNeural"],
  it: ["it-IT-ElsaNeural", "it-IT-DiegoNeural"],
};

// Google's free voice, used if the neural voice fails (and for Punjabi, Odia…).
const GOOGLE_CODES = { hi: "hi-IN", ta: "ta-IN", te: "te-IN", kn: "kn-IN", ml: "ml-IN", bn: "bn-IN", mr: "mr-IN", gu: "gu-IN", ur: "ur-IN", pa: "pa-IN", or: "or-IN" };

const MALE_VOICE = /(Guy|Andrew|Steffan|Ryan|Prabhat|William|Christopher|Eric|Roger|Davis|Brian)Neural$/;

/** "ta" / "TA" → "ta"; anything that isn't a short language code → null. */
const cleanLang = (lang) => {
  const code = String(lang || "").trim().toLowerCase();
  return /^[a-z]{2,3}$/.test(code) ? code : null;
};

/** The language of a picked voice: "en-US-JennyNeural" / "google-en-IN" → "en". */
const voiceBaseLanguage = (voice) => (String(voice || "").replace(/^google-/, "").match(/^([a-z]{2,3})/)?.[1] || "en");

/**
 * The voice to use for text in `lang` when the picked voice is `voice`, or null
 * when the picked voice already speaks that language (or no language was given).
 * @returns {{ edgeVoice: string|null, languageCode: string } | null}
 */
function nativeVoiceFor(lang, voice) {
  const code = cleanLang(lang);
  if (!code || code === voiceBaseLanguage(voice)) return null;
  const pair = NATIVE_VOICES[code];
  const edgeVoice = pair ? pair[MALE_VOICE.test(String(voice || "")) ? 1 : 0] : null;
  const languageCode = edgeVoice ? edgeVoice.slice(0, 5) : (GOOGLE_CODES[code] || code);
  return { edgeVoice, languageCode };
}

module.exports = { nativeVoiceFor, cleanLang, NATIVE_VOICES };
