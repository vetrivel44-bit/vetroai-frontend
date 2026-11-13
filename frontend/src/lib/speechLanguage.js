// The language a reply is written in, so it is read aloud by a native voice
// (the backend picks it) instead of the English voice from settings, which
// sounds robotic on Tamil, Hindi, Arabic… Returns a code like "ta", or null for
// English / unsure (the picked voice is kept).

const SCRIPTS = [
  ["ta", /[஀-௿]/g],
  ["te", /[ఀ-౿]/g],
  ["kn", /[ಀ-೿]/g],
  ["ml", /[ഀ-ൿ]/g],
  ["bn", /[ঀ-৿]/g],
  ["gu", /[઀-૿]/g],
  ["pa", /[਀-੿]/g],
  ["or", /[଀-୿]/g],
  ["si", /[඀-෿]/g],
  ["hi", /[ऀ-ॿ]/g], // Devanagari (Hindi, Marathi, Nepali) — see below
  ["ar", /[؀-ۿݐ-ݿ]/g], // Arabic script (Arabic, Urdu) — see below
  ["he", /[֐-׿]/g],
  ["th", /[฀-๿]/g],
  ["el", /[Ͱ-Ͽ]/g],
  ["ru", /[Ѐ-ӿ]/g],
  ["ko", /[가-힯ᄀ-ᇿ]/g],
  ["ja", /[぀-ヿ]/g], // kana; checked before Han so Japanese isn't read as Chinese
  ["zh", /[一-鿿]/g],
];

// Common words of Latin-script languages the app supports.
const WORDS = {
  es: "el la los las de del que y en un una por para con no es está son como pero más muy también este esta lo se su al".split(" "),
  fr: "le la les de des du et est que un une pour dans pas ce qui sur avec vous nous je il elle au aux sont mais très".split(" "),
  de: "der die das und ist nicht ein eine ich zu mit auf für sie den dem des sind auch wie aber oder wird".split(" "),
  pt: "o a os as de do da dos das que e em um uma para com não é você mais mas como por está são muito".split(" "),
  it: "il lo la gli le di del della che e è un una per con non sono come ma più anche questo questa nel".split(" "),
  en: "the and is are of to in that it you for with this on be was have not but what can your".split(" "),
};

const URDU_ONLY = /[ٹڈڑںھہے]/; // ٹ ڈ ڑ ں ھ ہ ے
// \b doesn't see Devanagari as word characters, so whole words are matched
// with Unicode-aware lookarounds (letters and vowel signs).
const word = (list) => new RegExp(`(?<![\\p{L}\\p{M}])(${list})(?![\\p{L}\\p{M}])`, "u");
const MARATHI_WORDS = word("आहे|आहेत|आणि|नाही|मध्ये|होते|केले");
const MARATHI_HINT = { test: (s) => MARATHI_WORDS.test(s) || /ळ/.test(s) }; // ळ: Marathi, not Hindi
const NEPALI_HINT = word("छ|छन्|हुन्छ|गर्न|भएको|पनि");

export function detectSpeechLanguage(text) {
  const sample = String(text || "").slice(0, 4000);
  const letters = (sample.match(/\p{L}/gu) || []).length;
  if (!letters) return null;

  let best = null;
  let bestCount = 0;
  for (const [lang, rx] of SCRIPTS) {
    const count = (sample.match(rx) || []).length;
    if (count > bestCount) { best = lang; bestCount = count; }
  }
  // A non-Latin script that makes up a good share of the letters wins.
  if (best && bestCount >= Math.max(2, letters * 0.3)) {
    if (best === "ar" && URDU_ONLY.test(sample)) return "ur";
    if (best === "hi" && MARATHI_HINT.test(sample)) return "mr";
    if (best === "hi" && NEPALI_HINT.test(sample)) return "ne";
    return best;
  }

  // Latin script: count each language's common words.
  const words = sample.toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length < 4) return null;
  const scores = Object.fromEntries(Object.entries(WORDS).map(([lang, list]) => {
    const set = new Set(list);
    return [lang, words.filter((w) => set.has(w)).length];
  }));
  const [top, topScore] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (top === "en" || topScore < Math.max(2, words.length * 0.15) || topScore <= scores.en) return null;
  return top;
}

/**
 * The language someone types in, for the microphone's hints: like
 * detectSpeechLanguage, except that plain Latin-script writing counts as
 * English ("en") rather than "unsure", since that's how they'll want spoken
 * English (or romanised Tamil, Hindi…) written. null with too little to go on.
 */
export function typedLanguage(text) {
  const detected = detectSpeechLanguage(text);
  if (detected) return detected;
  const sample = String(text || "").slice(0, 4000);
  const letters = (sample.match(/\p{L}/gu) || []).length;
  const latin = (sample.match(/\p{Script=Latin}/gu) || []).length;
  return letters >= 8 && latin >= letters * 0.8 ? "en" : null;
}
