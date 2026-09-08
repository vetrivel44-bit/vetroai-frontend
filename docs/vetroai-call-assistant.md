# VetroAI Call Assistant

Two problems, one on-call layer:

- **Scam protection** — people hand over OTPs, card numbers and passwords to callers who sound official.
- **Language barrier** — people who speak one or two languages cannot talk to a caller who speaks another.

This document records what is built in this repository, what is deliberately
not built, and what has to happen before the rest can be.

---

## Status: Phase 1 is built here

The build plan has three phases. Only the first is in this repository, and the
reason is in the next section.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Post-call analysis. A recording or transcript is transcribed, redacted, scored against scam patterns, translated and spoken back. No live audio, no telephony permissions. | **Built** — this repo |
| 2 | Live translation, manually activated per call, user present throughout. | Not built — needs an Android app |
| 3 | Background/auto-answer with the full scam filter. | Not built — needs Phase 2 plus the legal work below |

Phase 1 was chosen first because it carries the entire safety-critical
detector — the same rules Phases 2 and 3 would run — with none of the
permission, platform or consent risk. If the detector is wrong, it is much
better to find out here.

## Platform reality

**Android only, when the live phases are built.** Android exposes
`CallScreeningService`, `InCallService` and `ConnectionService`, which let an
app see incoming calls, screen them, and — on some OEMs — inject audio. From
Android 10 the app must be the default Phone or Call Screening app to intercept
calls at all: a high-friction ask for users, and one Play Store review
scrutinises closely under the sensitive-permissions policy.

**iOS cannot do this.** CallKit does not permit third-party audio injection into
a live call, and does not permit programmatic speakerphone control. The most iOS
can offer is post-call transcription and translation, or Live Voicemail-style
screening. iOS parity should not be promised anywhere in product copy; plan a
reduced iOS feature set separately.

This is why the live phases are not "the next sprint". They are a different
application on a different platform, gated on the questions below.

## Legal — needs sign-off before any live-call code

These are not engineering decisions and should go to legal before a line of
Phase 2 is written.

- **Call recording consent varies by jurisdiction.** Many require all-party
  consent: several US states, and the EU under GDPR plus ePrivacy. The user
  consenting is not the same as the caller consenting.
- **Auto-answering and auto-recording likely requires an audible disclosure to
  the caller** ("this call is being assisted by AI translation and security"),
  not just a setting the user ticked once.
- **Platform and carrier policy.** Google Play sensitive-permission review, and
  any carrier restrictions, need their own compliance pass.

Phase 1 sidesteps all of this by never touching a live call — but it still
depends on the user having obtained consent to record, which the consent screen
states plainly before anything can be uploaded.

## Open questions

1. Which jurisdictions launch first, and what does each require for call
   recording and AI disclosure?
2. Should the assistant ever auto-answer, or only assist after the user has
   answered? Auto-answer is the highest-risk, highest-friction part of the whole
   feature.
3. What is the fallback when speech recognition or translation confidence is
   low — a noisy line, a rare language? Today Phase 1 shows what the recogniser
   returned and marks the detected language; a live pipeline needs a defined
   behaviour, because a mistranslation delivered confidently is worse than an
   admission of uncertainty.

---

## What Phase 1 does

`backend/src/services/callGuard/` — the detector. Pure functions, no network,
no keys, deterministic.

- **`redactor.js`** — finds and masks one-time codes, card numbers (Luhn-checked),
  CVVs, PINs, expiry dates, account numbers, IFSC codes, Aadhaar and social
  security numbers, and spoken passwords. Built for speech, not typing: a code
  read out as "four five six seven eight nine", in English, romanised Hindi,
  romanised Tamil or Spanish, is one entity. It returns the masked text plus
  entity types, positions and lengths — never the value, not even hashed.
- **`scamPatterns.js`** — the intent classifier: OTP requests, credential
  requests, remote-access and screen-share pushes, payment redirects, authority
  claims, urgency and threats, verification pretexts. Multi-language, because a
  scam script translated is the same scam.
- **`index.js`** — scoring and the escalation ladder: soft warning → hard
  interrupt → mute the user's own microphone. It also owns
  `assertSafeToTransmit()`, the gate every outbound call goes through.

Two invariants hold everywhere:

1. **Redaction runs first.** Scoring, logging, storage and every network call
   see redacted text. There is no endpoint that returns a raw transcript.
2. **The transmit gate runs before the provider check.** A refusal to send a
   code to a translation model or a voice does not depend on how a deployment
   happens to be configured.

`backend/src/services/callAssistantService.js` — the pipeline: speech-to-text
(Groq Whisper, language auto-detected), translation (Groq, prompted to translate
only — never to answer or advise on the user's behalf, which is an explicit
non-goal), and speech (Google Cloud Text-to-Speech, picking the most natural
voice family the API actually offers for the language rather than hard-coding a
voice name that will be retired).

`frontend/src/components/screens/CallAssistant.jsx` — the panel: consent gate,
upload/record/paste, risk verdict with the live action that would have fired,
per-turn flags, masked values rendered as pills, translation, spoken playback,
and a history that lives in the browser and nowhere else.

### What it deliberately does not do

- It does not answer, monitor or listen to live calls.
- It does not put a call on speaker, speak over one, or mute a microphone.
- It does not negotiate, agree, or say anything on the user's behalf. It
  translates and it warns. That boundary is what keeps it out of the liability
  and trust problems of an AI impersonating its user mid-call.

## Configuration

| Variable | Purpose | Without it |
| --- | --- | --- |
| `GROQ_API_KEY` | Speech-to-text and translation | Upload and translate are reported unavailable; pasting a transcript and analysing it still works |
| `GOOGLE_TTS_API_KEY` | Google Cloud Text-to-Speech | Spoken playback is reported unavailable |
| `CALL_ASR_MODEL` | Override the recogniser (default `whisper-large-v3-turbo`) | Default used |
| `CALL_TRANSLATION_MODEL` | Override the translation model (defaults to `GROQ_MODEL`) | Default used |

The Google key needs the Cloud Text-to-Speech API enabled on its project. The
analysis endpoint needs no key at all, by design — the part that protects the
user is the part that must not depend on a provider being reachable.

## API

All routes are under `/api/call-assistant` and rate limited to 20 requests per
minute per client.

| Route | Purpose |
| --- | --- |
| `GET /config` | Phase, per-capability availability and limits, so the UI can say what is off instead of failing on the first click |
| `POST /analyze` | `{ turns: [{ speaker, text }] }` → redacted transcript, risk score and level, flags, escalation action, summary. Local; no provider needed |
| `POST /transcribe` | multipart `recording` → transcribed, redacted **and analysed**. Max 25 MB, held in memory only |
| `POST /translate` | `{ texts, targetLanguage }` → translations. Refuses (422) any text still carrying a sensitive value |
| `POST /speak` | `{ text, languageCode }` → base64 MP3 from Google TTS. Refuses (422) the same way |

Nothing is persisted server-side. The only surviving copy of a call is the
redacted one in the user's own browser, which the panel can delete.

## Known limits

- **No speaker separation.** The recogniser does not say whose voice is whose,
  so uploaded turns start attributed to the caller and the user re-assigns their
  own lines in the panel. Direction matters: a code spoken by the user is what
  triggers the microphone mute, so getting this wrong changes the verdict.
- **Redaction is deliberately over-eager.** A ten-digit number with no context
  is masked. Masking a phone number by mistake costs a little clarity; missing
  an OTP costs the user their account.
- **Spoken digits are recognised in English, romanised Hindi, romanised Tamil
  and Spanish.** Native-script number words and constructions like "double
  seven" are not yet covered, though digits themselves are caught in any script
  the recogniser transcribes as numerals.
- **The classifier is rules, not a model.** It is deterministic, testable and
  fast, and it will miss novel phrasings. It is the first layer, and the entity
  redaction behind it does not depend on the phrasing being recognised.

## Tests

`backend/test/callGuard.test.js` covers redaction (spoken and written codes,
Luhn, false positives on ordinary speech), the classifier across languages, the
escalation ladder, the transmit gate and log safety. Several tests assert
directly that no part of a code appears in a response, an error message or a log
line.

`backend/test/callAssistant.test.js` and `backend/test/callAssistantRoutes.test.js`
cover honest failures when providers are unconfigured, and that the transmit
gate fires before any provider is contacted.

`frontend/test/callGuardLocal.test.js` covers transcript parsing and the local
masking applied before anything is written to browser storage.

Run: `npm --prefix backend test` and `npm --prefix frontend test`.
