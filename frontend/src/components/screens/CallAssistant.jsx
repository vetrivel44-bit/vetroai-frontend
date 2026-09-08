import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ShieldCheck, ShieldAlert, X, Upload, Mic, CircleStop, FileText, Languages,
  Volume2, Trash2, AlertTriangle, Loader2, PhoneCall, Lock, Info,
} from "lucide-react";
import {
  parseTranscript, maskDigits, splitRedactions, RISK_META, ACTION_META, SPEAKERS,
} from "../../utils/callGuardLocal";
import "./CallAssistant.css";

const CONSENT_KEY = "vetroai_call_assistant_consent_v1";
const HISTORY_KEY = "vetroai_call_assistant_history_v1";
const HISTORY_LIMIT = 20;

// Languages the pipeline is wired for. The list doubles as the BCP-47 mapping
// the speech endpoint needs, since Google TTS wants a region.
const LANGUAGES = [
  { code: "en", speech: "en-US", name: "English" },
  { code: "hi", speech: "hi-IN", name: "Hindi" },
  { code: "ta", speech: "ta-IN", name: "Tamil" },
  { code: "te", speech: "te-IN", name: "Telugu" },
  { code: "ml", speech: "ml-IN", name: "Malayalam" },
  { code: "kn", speech: "kn-IN", name: "Kannada" },
  { code: "bn", speech: "bn-IN", name: "Bengali" },
  { code: "mr", speech: "mr-IN", name: "Marathi" },
  { code: "es", speech: "es-ES", name: "Spanish" },
  { code: "fr", speech: "fr-FR", name: "French" },
  { code: "de", speech: "de-DE", name: "German" },
  { code: "pt", speech: "pt-BR", name: "Portuguese" },
  { code: "ar", speech: "ar-XA", name: "Arabic" },
  { code: "zh", speech: "cmn-CN", name: "Chinese (Mandarin)" },
  { code: "ja", speech: "ja-JP", name: "Japanese" },
  { code: "ru", speech: "ru-RU", name: "Russian" },
];

// A 404 here is not "this call was bad", it is "this backend has never heard of
// the Call Assistant". Saying so is the difference between a user retrying the
// same upload forever and knowing the API needs redeploying.
const NO_ENDPOINT = "This backend does not serve the Call Assistant endpoints (HTTP 404). It is running a build from before Call Assistant shipped — redeploy the API to enable it.";

async function readError(response) {
  if (response.status === 404) return NO_ENDPOINT;
  const raw = await response.text().catch(() => "");
  if (!raw) return `Request failed (${response.status}).`;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.message || `Request failed (${response.status}).`;
  } catch {
    return raw.slice(0, 300);
  }
}

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function RedactedText({ text }) {
  return (
    <>
      {splitRedactions(text).map((part, index) =>
        part.type === "redacted" ? (
          <span key={index} className="ca-redacted" title="Masked on this device. This value was never sent for translation or speech.">
            <Lock size={11} /> {part.value} hidden
          </span>
        ) : (
          <span key={index}>{part.value}</span>
        )
      )}
    </>
  );
}

export default function CallAssistant({ apiBase, onClose }) {
  const [consented, setConsented] = useState(() => localStorage.getItem(CONSENT_KEY) === "true");
  const [consentChecks, setConsentChecks] = useState({ processing: false, parties: false, retention: false });

  // "loading" until /config answers. "unavailable" means the deployment serves
  // no Call Assistant routes at all, which is a different thing from a backend
  // that answered and reported one provider key missing.
  const [backend, setBackend] = useState({ status: "loading", capabilities: null, detail: "" });
  const [draft, setDraft] = useState("");
  const [recording, setRecording] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [translations, setTranslations] = useState({});
  const [history, setHistory] = useState(loadHistory);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);

  const { capabilities } = backend;
  const backendMissing = backend.status === "unavailable";
  // While /config is still in flight nothing is disabled. Once it answers, a
  // missing provider key disables only its own feature; a missing backend
  // disables every control, because all of them are server round-trips.
  const featureOff = (feature) => backendMissing || (capabilities ? !capabilities[feature]?.available : false);

  const loadConfig = useCallback(async (signal) => {
    setBackend((prev) => ({ ...prev, status: "loading" }));
    let next;
    try {
      const response = await fetch(`${apiBase}/call-assistant/config`, { signal });
      if (response.ok) {
        const body = await response.json();
        next = { status: "ready", capabilities: body?.data?.capabilities || null, detail: "" };
      } else {
        next = { status: "unavailable", capabilities: null, detail: await readError(response) };
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      next = { status: "unavailable", capabilities: null, detail: err?.message || "The backend could not be reached." };
    }
    setBackend(next);
  }, [apiBase]);

  useEffect(() => {
    const controller = new AbortController();
    loadConfig(controller.signal);
    return () => controller.abort();
  }, [loadConfig]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const acceptConsent = () => {
    localStorage.setItem(CONSENT_KEY, "true");
    setConsented(true);
  };

  const rememberInHistory = useCallback((result, label) => {
    const entry = {
      id: `${Date.now()}`,
      at: new Date().toISOString(),
      label,
      riskLevel: result.riskLevel,
      score: result.score,
      action: result.action,
      flags: result.flags.map((f) => f.label),
      // The server already redacted this. maskDigits is a second pass so a
      // stray number in a transcript never reaches this device's storage.
      turns: result.turns.map((t) => ({ speaker: t.speaker, text: maskDigits(t.text) })),
    };
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, HISTORY_LIMIT);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
      return next;
    });
  }, []);

  const analyzeText = async () => {
    const turns = parseTranscript(draft);
    if (!turns.length) { setError("Paste the call transcript first, or upload a recording."); return; }
    setBusy("analyzing"); setError(""); setTranslations({});
    try {
      const response = await fetch(`${apiBase}/call-assistant/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json();
      setAnalysis(body.data);
      setSourceLabel("Pasted transcript");
      rememberInHistory(body.data, "Pasted transcript");
      // The draft is the one place a real code can still be sitting in plain
      // text. Once the redacted version exists, drop it.
      setDraft("");
    } catch (err) {
      setError(err?.message || "Analysis failed.");
    } finally {
      setBusy("");
    }
  };

  const analyzeRecording = async (file) => {
    if (!file) return;
    setBusy("transcribing"); setError(""); setTranslations({}); setRecording(file);
    try {
      const form = new FormData();
      form.append("recording", file);
      const response = await fetch(`${apiBase}/call-assistant/transcribe`, { method: "POST", body: form });
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json();
      setAnalysis(body.data.analysis);
      setSourceLabel(`${file.name} · detected ${body.data.language}`);
      rememberInHistory(body.data.analysis, file.name);
    } catch (err) {
      setError(err?.message || "Transcription failed.");
    } finally {
      setBusy("");
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        analyzeRecording(new File([blob], `call-${Date.now()}.webm`, { type: blob.type }));
      };
      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
      setError("");
    } catch (err) {
      setError(err?.message || "Microphone permission was denied.");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setIsRecording(false);
  };

  // Speaker attribution comes from the user, not the recogniser: nothing in the
  // audio tells us which voice is theirs, and the direction changes what the
  // live assistant would do about a spoken code.
  const reassignSpeaker = async (index) => {
    if (!analysis) return;
    const turns = analysis.turns.map((turn, i) => ({
      speaker: i === index ? (turn.speaker === SPEAKERS.USER ? SPEAKERS.CALLER : SPEAKERS.USER) : turn.speaker,
      text: turn.text,
    }));
    setBusy("analyzing");
    try {
      const response = await fetch(`${apiBase}/call-assistant/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json();
      setAnalysis(body.data);
    } catch (err) {
      setError(err?.message || "Could not re-analyse the call.");
    } finally {
      setBusy("");
    }
  };

  const translateAll = async () => {
    if (!analysis?.turns?.length) return;
    setBusy("translating"); setError("");
    try {
      const response = await fetch(`${apiBase}/call-assistant/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: analysis.turns.map((t) => t.text), targetLanguage }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json();
      const next = {};
      body.data.translations.forEach((text, index) => { next[index] = text; });
      setTranslations(next);
    } catch (err) {
      setError(err?.message || "Translation failed.");
    } finally {
      setBusy("");
    }
  };

  const speak = async (text, languageCode) => {
    if (!text?.trim()) return;
    setBusy("speaking"); setError("");
    try {
      const response = await fetch(`${apiBase}/call-assistant/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, languageCode }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json();
      audioRef.current?.pause();
      const audio = new Audio(`data:${body.data.mimeType};base64,${body.data.audioBase64}`);
      audioRef.current = audio;
      await audio.play();
    } catch (err) {
      setError(err?.message || "Could not play the spoken warning.");
    } finally {
      setBusy("");
    }
  };

  const clearHistory = () => {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  };

  const risk = analysis ? RISK_META[analysis.riskLevel] || RISK_META.none : null;
  const action = analysis ? ACTION_META[analysis.action] || ACTION_META.none : null;
  const speechLanguage = useMemo(
    () => LANGUAGES.find((l) => l.code === targetLanguage)?.speech || "en-US",
    [targetLanguage]
  );

  if (!consented) {
    const allChecked = Object.values(consentChecks).every(Boolean);
    return (
      <div className="ca-shell">
        <div className="ca-consent">
          <div className="ca-consent-head">
            <ShieldCheck size={26} />
            <div>
              <h2>Before VetroAI listens to a call</h2>
              <p>Read this once. It is the whole deal, not a summary of it.</p>
            </div>
            <button className="ca-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>

          <label className="ca-check">
            <input type="checkbox" checked={consentChecks.processing} onChange={(e) => setConsentChecks((c) => ({ ...c, processing: e.target.checked }))} />
            <span><b>Audio is processed by AI.</b> A recording you upload is sent to a speech-to-text provider to be turned into text. It is held in memory for that request and is not stored on VetroAI's servers.</span>
          </label>
          <label className="ca-check">
            <input type="checkbox" checked={consentChecks.parties} onChange={(e) => setConsentChecks((c) => ({ ...c, parties: e.target.checked }))} />
            <span><b>Everyone on the call must know.</b> Recording a call without the other party's consent is illegal in many places, including much of the EU and several US states. You are responsible for having that consent before you upload anything.</span>
          </label>
          <label className="ca-check">
            <input type="checkbox" checked={consentChecks.retention} onChange={(e) => setConsentChecks((c) => ({ ...c, retention: e.target.checked }))} />
            <span><b>Codes are never kept.</b> One-time codes, card numbers, PINs and passwords are masked before the transcript is returned, translated, spoken or saved. Transcripts stay in this browser and nowhere else — you can delete them below at any time.</span>
          </label>

          <button className="ca-primary ca-wide" disabled={!allChecked} onClick={acceptConsent}>I understand — turn on Call Assistant</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ca-shell">
      <header className="ca-header">
        <div>
          <div className="ca-eyebrow">Phase 1 · Post-call analysis</div>
          <h2><ShieldCheck size={26} /> Call Assistant</h2>
          <p>
            Upload a call you are permitted to record, or paste what was said. VetroAI masks any code or card
            number, flags the scam script it matches, and translates what is left.
          </p>
        </div>
        <button className="ca-icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
      </header>

      <div className="ca-notice">
        <Info size={16} />
        <span>
          This does not listen to live calls. Answering calls, speaking over them and muting your microphone
          mid-sentence need Android call permissions and jurisdiction-by-jurisdiction legal sign-off, and are not
          shipped here. What you see below is the same detector those phases would run.
        </span>
      </div>

      {backendMissing && (
        <div className="ca-notice ca-notice-error">
          <AlertTriangle size={16} />
          <span>
            <b>Call Assistant is unavailable on this backend.</b> {backend.detail} Analysis, transcription,
            translation and playback all run on the server, so nothing below will work until the API is redeployed.
          </span>
          <button className="ca-secondary ca-notice-retry" onClick={() => loadConfig()} disabled={backend.status === "loading"}>
            {backend.status === "loading" ? <Loader2 size={14} className="ca-spin" /> : null} Retry
          </button>
        </div>
      )}

      {backend.status === "ready" && capabilities && (!capabilities.transcription.available || !capabilities.speech.available) && (
        <div className="ca-notice ca-notice-warn">
          <AlertTriangle size={16} />
          <span>
            {!capabilities.transcription.available && "Recording upload is off on this deployment (no speech-to-text key). "}
            {!capabilities.speech.available && "Spoken playback is off (no Google Text-to-Speech key). "}
            Pasting a transcript and analysing it works regardless — that part runs without any provider.
          </span>
        </div>
      )}

      <section className="ca-card">
        <div className="ca-step"><span>1</span> The call</div>
        <div className="ca-sources">
          <label className={`ca-drop ${featureOff("transcription") ? "disabled" : ""}`}>
            <Upload size={22} />
            <strong>{recording ? recording.name : "Upload a recording"}</strong>
            <small>MP3, WAV, M4A, OGG, WEBM · max 25 MB</small>
            <input
              type="file"
              accept="audio/*"
              hidden
              disabled={!!busy || featureOff("transcription")}
              onChange={(e) => analyzeRecording(e.target.files?.[0])}
            />
          </label>
          <button
            className={isRecording ? "ca-danger ca-drop-btn" : "ca-secondary ca-drop-btn"}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isRecording ? false : (!!busy || featureOff("transcription"))}
          >
            {isRecording ? <CircleStop size={18} /> : <Mic size={18} />}
            {isRecording ? "Stop and analyse" : "Record from this device"}
          </button>
        </div>

        <div className="ca-or">or paste the transcript</div>
        <textarea
          className="ca-textarea"
          rows={6}
          value={draft}
          placeholder={"Caller: Hello, I am calling from your bank.\nCaller: Please share the OTP we just sent.\nMe: It is …"}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="ca-row-between">
          <small className="ca-note">Label lines with <code>Caller:</code> and <code>Me:</code> if you can. Unlabelled lines are treated as the caller.</small>
          <button className="ca-primary" onClick={analyzeText} disabled={!!busy || backendMissing}>
            {busy === "analyzing" ? <Loader2 size={16} className="ca-spin" /> : <FileText size={16} />} Analyse call
          </button>
        </div>
        {busy === "transcribing" && <div className="ca-progress"><Loader2 size={15} className="ca-spin" /> Transcribing and redacting…</div>}
        {error && <div className="ca-error"><AlertTriangle size={16} /> {error}</div>}
      </section>

      {analysis && (
        <>
          <section className="ca-card ca-verdict" style={{ "--risk": risk.tone }}>
            <div className="ca-verdict-head">
              <div className="ca-risk-badge">
                {analysis.riskLevel === "none" ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
                <div>
                  <strong>{risk.label} risk</strong>
                  <small>{analysis.score}/100 · {sourceLabel}</small>
                </div>
              </div>
              <div className="ca-action-chip" title={action.detail}>
                <PhoneCall size={14} /> Live response: {action.label}
              </div>
            </div>

            <p className="ca-summary">{analysis.summary}</p>

            {analysis.spokenWarning && (
              <div className="ca-warning-line">
                <span>“{analysis.spokenWarning}”</span>
                <button
                  className="ca-secondary"
                  disabled={!!busy || featureOff("speech")}
                  onClick={() => speak(analysis.spokenWarning, "en-US")}
                >
                  {busy === "speaking" ? <Loader2 size={15} className="ca-spin" /> : <Volume2 size={15} />} Hear it
                </button>
              </div>
            )}

            {analysis.flags.length > 0 && (
              <ul className="ca-flags">
                {analysis.flags.map((flag) => (
                  <li key={flag.id} className={`ca-flag sev-${flag.severity}`}>
                    <strong>{flag.label}</strong>
                    <span>{flag.explanation}</span>
                  </li>
                ))}
              </ul>
            )}

            {analysis.disclosureDetected && (
              <div className="ca-exposure">
                <Lock size={16} />
                <span>
                  Sensitive digits were spoken during this call. VetroAI masked them everywhere, but the other
                  party heard them. Call your bank on the number printed on your card and have the account checked.
                </span>
              </div>
            )}
          </section>

          <section className="ca-card">
            <div className="ca-row-between ca-transcript-head">
              <div className="ca-step"><span>2</span> Transcript</div>
              <div className="ca-translate-controls">
                <Languages size={16} />
                <select value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)}>
                  {LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
                </select>
                <button className="ca-secondary" onClick={translateAll} disabled={!!busy || featureOff("translation")}>
                  {busy === "translating" ? <Loader2 size={15} className="ca-spin" /> : <Languages size={15} />} Translate
                </button>
              </div>
            </div>

            <ol className="ca-turns">
              {analysis.turns.map((turn, index) => (
                <li key={index} className={`ca-turn ${turn.speaker} risk-${turn.riskLevel}`}>
                  <button
                    className="ca-speaker"
                    onClick={() => reassignSpeaker(index)}
                    title="Wrong speaker? Tap to switch. Direction decides whether a spoken code would have muted your microphone."
                  >
                    {turn.speaker === SPEAKERS.USER ? "You" : "Caller"}
                  </button>
                  <div className="ca-turn-body">
                    <p><RedactedText text={turn.text} /></p>
                    {translations[index] && (
                      <p className="ca-translation">
                        <RedactedText text={translations[index]} />
                        <button
                          className="ca-inline-btn"
                          disabled={!!busy || featureOff("speech")}
                          onClick={() => speak(translations[index], speechLanguage)}
                          aria-label="Play translation"
                        >
                          <Volume2 size={14} />
                        </button>
                      </p>
                    )}
                    {turn.matches.length > 0 && (
                      <div className="ca-turn-flags">
                        {turn.matches.map((match) => <span key={match.id}>{match.label}</span>)}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      <section className="ca-card">
        <div className="ca-row-between">
          <div className="ca-step"><span>3</span> Saved on this device</div>
          {history.length > 0 && (
            <button className="ca-secondary" onClick={clearHistory}><Trash2 size={15} /> Delete all</button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="ca-note">Nothing saved yet. Analysed calls are kept in this browser only, already masked.</p>
        ) : (
          <ul className="ca-history">
            {history.map((entry) => (
              <li key={entry.id}>
                <span className="ca-history-dot" style={{ background: (RISK_META[entry.riskLevel] || RISK_META.none).tone }} />
                <div>
                  <strong>{entry.label}</strong>
                  <small>{new Date(entry.at).toLocaleString()} · {(RISK_META[entry.riskLevel] || RISK_META.none).label} · {entry.flags.join(", ") || "no indicators"}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
