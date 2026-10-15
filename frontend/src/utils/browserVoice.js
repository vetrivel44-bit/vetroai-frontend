// When the TTS service can't be reached, replies are read by the browser's own
// speech synthesis. Without this, that fallback used the browser's default
// voice whatever the user picked — choosing Sonia (British, female) and
// hearing a US male voice. This picks the closest voice the browser has.

const VOICE_GENDER = {
  Jenny: "female", Aria: "female", Sonia: "female",
  Guy: "male", Steffan: "male", Ryan: "male",
};

const FEMALE = /\b(female|woman|zira|samantha|karen|moira|tessa|serena|susan|hazel|libby|aria|jenny|sonia|victoria|fiona|kate|catherine|allison|ava|joanna|salli|kimberly|emma|amy|michelle|heera|veena)\b/i;
const MALE = /\b(male|man|david|mark|daniel|alex|fred|george|guy|ryan|steffan|james|tom|oliver|arthur|aaron|rishi|thomas|ravi)\b/i;

/** "en-GB-SoniaNeural" → { lang: "en-GB", name: "Sonia", gender: "female" } */
export function describeTtsVoice(id) {
  const match = /^([a-z]{2}-[A-Z]{2})-([A-Za-z]+?)(?:Neural)?$/.exec(String(id || ""));
  if (!match) return { lang: "en-US", name: "", gender: null };
  return { lang: match[1], name: match[2], gender: VOICE_GENDER[match[2]] || null };
}

const genderOf = (voiceName) => (FEMALE.test(voiceName) ? "female" : MALE.test(voiceName) ? "male" : null);

/**
 * The browser voice closest to the chosen TTS voice, or null when the
 * browser lists none. Same voice by name (Edge ships the Microsoft neural
 * voices) beats same accent and gender, which beats same accent.
 */
export function pickBrowserVoice(voices, ttsVoiceId) {
  const list = Array.from(voices || []);
  if (!list.length) return null;
  const want = describeTtsVoice(ttsVoiceId);
  let best = null;
  let bestScore = -Infinity;
  for (const voice of list) {
    const name = String(voice.name || "");
    const lang = String(voice.lang || "").replace("_", "-");
    let score = 0;
    if (want.name && new RegExp(`\\b${want.name}\\b`, "i").test(name)) score += 10;
    if (lang.toLowerCase() === want.lang.toLowerCase()) score += 4;
    else if (lang.slice(0, 2).toLowerCase() === want.lang.slice(0, 2).toLowerCase()) score += 1;
    else score -= 10;
    const gender = genderOf(name);
    if (want.gender && gender === want.gender) score += 3;
    else if (want.gender && gender && gender !== want.gender) score -= 3;
    if (score > bestScore) { best = voice; bestScore = score; }
  }
  return bestScore > -10 ? best : null;
}
