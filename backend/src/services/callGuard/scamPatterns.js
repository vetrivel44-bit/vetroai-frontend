// Rule-based scam-intent classifier (spec §5.2).
//
// The spec is explicit that detection "must NOT rely solely on an LLM's
// judgment call", and the reason is latency and determinism as much as
// accuracy: the interrupt has to fire before the user finishes answering, and
// the same sentence has to produce the same verdict every time so the
// behaviour can be tested and audited. So the first layer is this table.
//
// Two things about how the patterns are written, both learned from feeding it
// real-shaped scripts rather than English test sentences:
//
//   1. Word order is not a given. English puts the verb first ("install
//      AnyDesk", "share the OTP"); Hindi and Tamil put it last ("AnyDesk
//      install kijiye", "OTP sollunga"). Every subject/action rule is
//      therefore generated in both directions by `demand()` instead of being
//      written out once in English order.
//   2. Script is not a given either. A Hindi call comes back from the
//      recogniser as Devanagari or as romanised Hinglish depending on the
//      audio, the model and the speaker's code-switching — and code-switched
//      "bank se bol raha hoon, OTP bataiye" is the common case, not the edge
//      case. Both spellings are listed for every language.
//
// Weights are additive per utterance and capped at 100. Two categories are
// worth calling out:
//   - `otp_request` and `credential_request` alone are enough to interrupt.
//   - `authority_claim` and `urgency_pressure` are weak on their own — a real
//     bank does say "this is your bank" — but their combination is the single
//     most reliable signal of a live social-engineering script, so the
//     combination is scored separately in index.js.

// Verbs that turn a mention of a code into a demand for one, across the launch
// languages. Romanised forms carry the spelling variants people actually use.
const ASK = [
  // English
  "share", "tell", "send", "give", "read", "repeat", "confirm", "provide", "type",
  "enter", "say", "verify", "what is", "what's", "need", "require",
  // Hindi / Urdu, romanised — verb-final, so these usually follow the subject
  "bataiye", "bataye", "batao", "bata", "bolo", "boliye", "bhejiye", "bhejo",
  "dijiye", "dijie", "de dijiye", "kijiye", "kariye", "karo",
  // Tamil, romanised
  "sollunga", "sollu", "kodunga", "kudunga", "anuppunga", "pannunga", "panunga",
  // Spanish
  "digame", "dígame", "dame", "envie", "envíe", "comparta", "confirme", "proporcione",
].join("|");

// Native-script equivalents, kept separate because they need no word boundaries
// (\b is ASCII-only and never matches at a Devanagari or Tamil boundary).
const ASK_NATIVE = "बताइए|बताओ|बताएं|भेजिए|भेजो|शेयर|दीजिए|कीजिए|சொல்லுங்க|சொல்லு|கொடுங்க|அனுப்புங்க|பண்ணுங்க";

/**
 * A demand for something, in either word order.
 *
 * English asks before naming the thing; Hindi and Tamil name it first and put
 * the verb at the end. Generating both directions from one declaration is what
 * keeps a Hinglish script from walking straight past the classifier.
 *
 * @param {string} subject regex source for the thing being demanded
 * @param {number} gap how many characters may sit between the two halves
 */
function demand(subject, gap = 60) {
  return [
    new RegExp(`(?:${subject})[\\s\\S]{0,${gap}}?(?:\\b(?:${ASK})\\b|${ASK_NATIVE})`, "i"),
    new RegExp(`(?:\\b(?:${ASK})\\b|${ASK_NATIVE})[\\s\\S]{0,${gap}}?(?:${subject})`, "i"),
  ];
}

const CODE_SUBJECT = "\\botp\\b|\\bo\\.?t\\.?p\\.?\\b|one[\\s-]?time (?:password|code|pin)|verification code|security code|auth(?:entication)? code|passcode|sms code|confirmation code|ओटीपी|कोड|ஓடிபி|குறியீடு|c[oó]digo";
const CREDENTIAL_SUBJECT = "card (?:number|no\\.?|details)|debit card|credit card|\\bcvv\\b|\\bcvc\\b|atm pin|upi pin|card pin|\\bmpin\\b|net ?banking (?:password|login|user ?id)|internet banking password|account password|login (?:password|credentials)|कार्ड|पिन|पासवर्ड|கார்டு|பின்|கடவுச்சொல்|n[uú]mero de (?:la )?tarjeta|contrase[nñ]a";
const REMOTE_SUBJECT = "any ?desk|team ?viewer|quick ?support|air ?droid|screen ?share|remote (?:access|support|desktop)|\\bapk\\b|ऐप|एप्लीकेशन|aplicaci[oó]n";
const INSTALL = "install|download|open|get|instale|descargue|इंस्टॉल|डाउनलोड";

const CATEGORIES = [
  {
    id: "otp_request",
    label: "Asked for a one-time password",
    explanation: "The caller asked for an OTP or verification code. No real bank, delivery service or government office ever asks for one.",
    weight: 75,
    severity: "critical",
    patterns: [
      ...demand(CODE_SUBJECT),
      /\b(?:code|otp)\b[\s\S]{0,30}\b(?:on|in) (?:your|the) (?:phone|mobile|sms|message|screen)\b[\s\S]{0,40}\b(?:tell|read|share|say|confirm)\b/i,
    ],
  },
  {
    id: "credential_request",
    label: "Asked for card, PIN or banking credentials",
    explanation: "The caller asked for card details, a PIN or banking login credentials. These are never needed by a legitimate inbound caller.",
    weight: 70,
    severity: "critical",
    patterns: [
      ...demand(CREDENTIAL_SUBJECT),
      /\b(?:back of (?:the|your) card|three digits? (?:on|at) the back|expiry date and cvv)\b/i,
      /\blast (?:four|4) digits\b[\s\S]{0,40}\b(?:and|plus)\b[\s\S]{0,20}\bcvv\b/i,
    ],
  },
  {
    id: "remote_access",
    label: "Asked you to install an app or share your screen",
    explanation: "Remote-access and screen-share apps hand the caller live control of your phone, including your banking apps.",
    weight: 45,
    severity: "high",
    patterns: [
      // Either order: "install AnyDesk" and "AnyDesk install kijiye".
      new RegExp(`(?:${REMOTE_SUBJECT})[\\s\\S]{0,40}?(?:${INSTALL})`, "i"),
      new RegExp(`(?:${INSTALL})[\\s\\S]{0,40}?(?:${REMOTE_SUBJECT})`, "i"),
      /\b(?:share|mirror|show me)\b[\s\S]{0,30}\b(?:your )?screen\b/i,
      /\bscreen\b[\s\S]{0,20}(?:share|dikhaiye|dikhao|காட்டுங்க)/i,
      /\b(?:play ?store|app ?store)\b[\s\S]{0,40}\b(?:install|download|search for)\b[\s\S]{0,40}\b(?:app|application)\b[\s\S]{0,60}\b(?:so (?:that )?(?:i|we) can|to (?:help|verify|fix))\b/i,
    ],
  },
  {
    id: "payment_redirect",
    label: "Pushed you to send money or buy vouchers",
    explanation: "Requests to transfer money, scan a QR code to 'receive' funds, or buy gift cards are the payout step of a scam.",
    weight: 40,
    severity: "high",
    patterns: [
      /\b(?:transfer|send|deposit|pay)\b[\s\S]{0,40}\b(?:rs\.?|rupees|inr|dollars?|usd|euros?|₹|\$)\b/i,
      /\b(?:rs\.?|rupees|inr|₹)[\s\S]{0,30}\b(?:transfer|bhejiye|bhejo|dijiye|anuppunga)\b/i,
      /\b(?:gift ?card|google play card|amazon voucher|itunes card|steam card|crypto|bitcoin|usdt)\b[\s\S]{0,50}\b(?:buy|purchase|send|share (?:the )?code)\b/i,
      /\bscan (?:this|the) (?:qr|barcode)\b[\s\S]{0,50}\b(?:receive|refund|credit|get (?:your )?money)\b/i,
      /\b(?:refund|cashback)\b[\s\S]{0,40}\b(?:enter (?:your )?(?:upi )?pin|approve the request|accept the request)\b/i,
      /\b(?:security|verification) (?:deposit|fee|charge)\b/i,
    ],
  },
  {
    id: "authority_claim",
    label: "Claimed to be your bank or an official",
    explanation: "Claiming to call from a bank, police force or government office is the standard opening of an impersonation scam.",
    weight: 15,
    severity: "medium",
    patterns: [
      /\b(?:i am|this is|calling from|on behalf of)\b[\s\S]{0,30}\b(?:your bank|the bank|hdfc|icici|sbi|axis|kotak|paytm|phonepe|visa|mastercard|amazon|microsoft|apple support|customer (?:care|support)|police|cyber ?crime|income tax|tax department|social security|medicare|court|customs|trai|fedex|dhl|courier)\b/i,
      /\b(?:bank|card) (?:security|fraud|risk) (?:department|team|cell)\b/i,
      // Hinglish/Tanglish: "main aapke bank se bol raha hoon", "bank la irundhu pesuren"
      /\b(?:bank|police|cyber ?crime|customer care)\b[\s\S]{0,25}\b(?:se|say|la|il|irundhu)\b[\s\S]{0,25}\b(?:bol|bat|call|phone|pesu|pesuren|raha|rahi|hoon|hun|kar)/i,
      /\b(?:main|mai|hum|naan|naa)\b[\s\S]{0,25}\b(?:bank|police|cyber)\b/i,
      /(?:मैं|हम)[\s\S]{0,20}(?:बैंक|पुलिस|साइबर)/,
      /\b(?:soy|le llamo) de\b[\s\S]{0,25}\b(?:su banco|el banco|la polic[ií]a)\b/i,
    ],
  },
  {
    id: "urgency_pressure",
    label: "Used urgency or threats to rush you",
    explanation: "Legitimate organisations do not threaten arrest, account closure or a deadline measured in minutes.",
    weight: 20,
    severity: "medium",
    patterns: [
      /\b(?:you (?:will|'ll) be (?:arrested|jailed|prosecuted)|arrest warrant|legal action will be taken|case (?:has been )?(?:filed|registered) against you)\b/i,
      /\b(?:account|card|sim|number) (?:will be|is being|is about to be) (?:blocked|suspended|deactivated|closed|frozen)\b/i,
      // Hinglish/Tanglish: "card block ho jayega", "account band ho jayega", "block aagidum"
      /\b(?:account|card|sim|khata|kanakku)\b[\s\S]{0,25}\b(?:block|band|close|freeze|suspend)\b[\s\S]{0,20}\b(?:ho|hoga|jayega|jaayega|jaega|aagidum|aagum|pogum)\b/i,
      /\b(?:arrest|giraftar)\b[\s\S]{0,20}\b(?:ho|hoga|jayega|kar)\b/i,
      /\b(?:within|in) (?:the next )?(?:\d{1,2}|two|three|five|ten|fifteen|thirty) (?:minutes?|hours?)\b[\s\S]{0,60}\b(?:otp|verify|confirm|blocked|suspended|pay|transfer)\b/i,
      /\b(?:do not|don'?t) (?:tell|inform|discuss with|hang up|disconnect|cut the call)\b[\s\S]{0,40}\b(?:anyone|bank|family|police|call)\b/i,
      /\b(?:kisi ko|kisiko|yaarukkum)\b[\s\S]{0,25}\b(?:mat|nahi|na|vendam|solla)\b/i,
      /\b(?:immediately|right now|urgent(?:ly)?|turant|abhi|udane|seekiram)\b[\s\S]{0,40}\b(?:otp|verify|confirm|pay|transfer|share|bataiye|batao|sollunga)\b/i,
      /(?:गिरफ्तार|ब्लॉक हो जाएगा|तुरंत)/,
      /\b(?:ser[aá] (?:bloqueada|suspendida)|de inmediato|ahora mismo)\b/i,
    ],
  },
  {
    id: "verification_pretext",
    label: "Framed the request as a routine verification",
    explanation: "'Just to verify your identity' is the pretext that makes handing over a code feel reasonable.",
    weight: 15,
    severity: "medium",
    patterns: [
      /\b(?:kyc|know your customer|re-?kyc)\b[\s\S]{0,50}\b(?:update|complete|pending|expired|verify|karna|kijiye|pannunga)\b/i,
      /\b(?:just )?(?:to )?verify (?:your )?(?:identity|account|details|profile)\b/i,
      /\b(?:verification|verify)\b[\s\S]{0,20}\b(?:ke liye|ke lie|kaaga|kaga|purposes?)\b/i,
      /\b(?:for (?:security|verification) purposes|this call is being recorded for verification)\b/i,
      /केवाईसी|கேஒய்சி/,
    ],
  },
];

/**
 * Match one utterance against every category.
 * @param {string} text redacted utterance text
 * @returns {Array<{id: string, label: string, explanation: string, weight: number, severity: string}>}
 */
function matchCategories(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  const hits = [];
  for (const category of CATEGORIES) {
    if (category.patterns.some((re) => re.test(text))) {
      hits.push({
        id: category.id,
        label: category.label,
        explanation: category.explanation,
        weight: category.weight,
        severity: category.severity,
      });
    }
  }
  return hits;
}

module.exports = { CATEGORIES, matchCategories };
