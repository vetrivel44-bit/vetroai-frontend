// Rule-based scam-intent classifier (spec §5.2).
//
// The spec is explicit that detection "must NOT rely solely on an LLM's
// judgment call", and the reason is latency and determinism as much as
// accuracy: the interrupt has to fire before the user finishes answering, and
// the same sentence has to produce the same verdict every time so the
// behaviour can be tested and audited. So the first layer is this table.
//
// Patterns are grouped by the intent behind them rather than by wording, and
// each group carries phrasings in the languages the feature launches into
// (English, Hindi, Tamil, Spanish — romanised and native script), because a
// scam script translated into the user's language is the same scam.
//
// Weights are additive per utterance and capped at 100. Two categories are
// worth calling out:
//   - `otp_request` and `credential_request` alone are enough to interrupt.
//   - `authority_claim` and `urgency_pressure` are weak on their own — a real
//     bank does say "this is your bank" — but their combination is the single
//     most reliable signal of a live social-engineering script, so the
//     combination is scored separately in index.js.

const CATEGORIES = [
  {
    id: "otp_request",
    label: "Asked for a one-time password",
    explanation: "The caller asked for an OTP or verification code. No real bank, delivery service or government office ever asks for one.",
    weight: 75,
    severity: "critical",
    patterns: [
      /\b(otp|one[\s-]?time (?:password|code|pin)|verification code|security code|auth(?:entication)? code|passcode|sms code|confirmation code)\b[\s\S]{0,60}?\b(?:share|tell|send|give|read|repeat|confirm|provide|type|enter|say|bata|batao|bolo|sollunga|kodunga|dime|dame)\b/i,
      /\b(?:share|tell|send|give|read|repeat|confirm|provide|say|what(?:'s| is))\b[\s\S]{0,60}?\b(otp|one[\s-]?time (?:password|code|pin)|verification code|security code|passcode|sms code|code (?:you|u) (?:just )?(?:got|received))\b/i,
      /\b(?:code|otp)\b[\s\S]{0,30}\b(?:on|in) (?:your|the) (?:phone|mobile|sms|message|screen)\b[\s\S]{0,40}\b(?:tell|read|share|say|confirm)\b/i,
      /ओटीपी[\s\S]{0,40}(?:बताइए|बताओ|भेजिए|शेयर)/,
      /ஓடிபி[\s\S]{0,40}(?:சொல்லுங்க|கொடுங்க|அனுப்புங்க)/,
      /\bc[oó]digo\b[\s\S]{0,40}\b(?:d[ií]game|dame|env[ií]e|comparta|confirme)\b/i,
    ],
  },
  {
    id: "credential_request",
    label: "Asked for card, PIN or banking credentials",
    explanation: "The caller asked for card details, a PIN or banking login credentials. These are never needed by a legitimate inbound caller.",
    weight: 70,
    severity: "critical",
    patterns: [
      /\b(?:card (?:number|no\.?)|debit card|credit card|cvv|cvc|atm pin|upi pin|card pin|mpin|net ?banking (?:password|login|user ?id)|internet banking password|account password|login (?:password|credentials))\b[\s\S]{0,60}?\b(?:share|tell|send|give|read|confirm|provide|type|enter|say|verify|bata|batao|sollunga|kodunga|dime|dame)\b/i,
      /\b(?:share|tell|send|give|read|confirm|provide|verify|what(?:'s| is))\b[\s\S]{0,60}?\b(?:card (?:number|no\.?|details)|cvv|cvc|atm pin|upi pin|card pin|mpin|net ?banking password|full card|last (?:four|4) digits and (?:the )?cvv)\b/i,
      /\b(?:back of (?:the|your) card|three digits? (?:on|at) the back|expiry date and cvv)\b/i,
      /(?:कार्ड|पिन|पासवर्ड)[\s\S]{0,40}(?:बताइए|बताओ|शेयर)/,
      /(?:கார்டு|பின்|கடவுச்சொல்)[\s\S]{0,40}(?:சொல்லுங்க|கொடுங்க)/,
      /\b(?:n[uú]mero de (?:la )?tarjeta|clave|contrase[nñ]a)\b[\s\S]{0,40}\b(?:d[ií]game|dame|confirme|proporcione)\b/i,
    ],
  },
  {
    id: "remote_access",
    label: "Asked you to install an app or share your screen",
    explanation: "Remote-access and screen-share apps hand the caller live control of your phone, including your banking apps.",
    weight: 45,
    severity: "high",
    patterns: [
      /\b(?:install|download|open|get)\b[\s\S]{0,40}\b(?:any ?desk|team ?viewer|quick ?support|air ?droid|screen ?share|remote (?:access|support|desktop)|apk)\b/i,
      /\b(?:share|mirror|show me)\b[\s\S]{0,30}\b(?:your )?screen\b/i,
      /\b(?:play ?store|app ?store)\b[\s\S]{0,40}\b(?:install|download|search for)\b[\s\S]{0,40}\b(?:app|application)\b[\s\S]{0,60}\b(?:so (?:that )?(?:i|we) can|to (?:help|verify|fix))\b/i,
      /(?:ऐप|एप्लीकेशन)[\s\S]{0,30}(?:इंस्टॉल|डाउनलोड)/,
      /\b(?:instale|descargue)\b[\s\S]{0,30}\b(?:aplicaci[oó]n|app)\b/i,
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
      /\b(?:within|in) (?:the next )?(?:\d{1,2}|two|three|five|ten|fifteen|thirty) (?:minutes?|hours?)\b[\s\S]{0,60}\b(?:otp|verify|confirm|blocked|suspended|pay|transfer)\b/i,
      /\b(?:do not|don'?t) (?:tell|inform|discuss with|hang up|disconnect|cut the call)\b[\s\S]{0,40}\b(?:anyone|bank|family|police|call)\b/i,
      /\b(?:immediately|right now|urgent(?:ly)?)\b[\s\S]{0,40}\b(?:otp|verify|confirm|pay|transfer|share)\b/i,
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
      /\b(?:kyc|know your customer|re-?kyc)\b[\s\S]{0,50}\b(?:update|complete|pending|expired|verify)\b/i,
      /\b(?:just )?(?:to )?verify (?:your )?(?:identity|account|details|profile)\b/i,
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
