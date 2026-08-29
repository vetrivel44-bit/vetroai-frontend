import React, { useEffect, useMemo, useRef, useState } from "react";
import { Music2, Upload, Download, X, Square, CheckCircle2, AlertCircle, Search, Sparkles } from "lucide-react";
import "./VoiceCoverPanel.css";

const ACCEPTED = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/flac"];
const MAX_MB = 50;
const STAGES = ["Uploading", "Separating Vocals", "Converting Voice", "Mixing", "Complete"];
const DEFAULT_VOICE = { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", provider: "elevenlabs" };

function validateAudio(file) {
  if (!file) return "Choose an audio file.";
  if (file.size > MAX_MB * 1024 * 1024) return `File must be ${MAX_MB} MB or smaller.`;
  const ext = file.name.split(".").pop()?.toLowerCase();
  const okExt = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "mp4"].includes(ext);
  if (!ACCEPTED.includes(file.type) && !okExt) return "Unsupported audio format. Use MP3, WAV, M4A, AAC, OGG, FLAC, or MP4 audio.";
  return "";
}

async function audioElementToBlob(audio) {
  const src = audio?.src || (typeof audio === "string" ? audio : "");
  if (!src) throw new Error("Voice conversion returned no audio source.");
  const response = await fetch(src);
  if (!response.ok) throw new Error("Could not read the converted vocal audio.");
  return response.blob();
}

export default function VoiceCoverPanel({ apiBase, authToken, onClose, addToast }) {
  const [songFile, setSongFile] = useState(null);
  const [songName, setSongName] = useState("");
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE.id);
  const [voices, setVoices] = useState([DEFAULT_VOICE]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [consent, setConsent] = useState(false);
  const [stage, setStage] = useState(null);
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [exportFormat, setExportFormat] = useState("mp3");
  const abortRef = useRef(null);
  const cancelledRef = useRef(false);

  const progress = useMemo(() => stage == null ? 0 : Math.max(0, STAGES.indexOf(stage) + 1), [stage]);

  useEffect(() => {
    let alive = true;
    const loadVoices = async () => {
      try {
        if (!window.puter?.ai?.txt2speech?.listVoices) return;
        const list = await window.puter.ai.txt2speech.listVoices({ provider: "elevenlabs" });
        if (!alive || !Array.isArray(list) || !list.length) return;
        setVoices(list);
        if (!list.some((v) => v.id === voiceId)) setVoiceId(list[0].id);
      } catch (e) {
        console.warn("Could not load Puter voices", e);
      } finally {
        if (alive) setLoadingVoices(false);
      }
    };
    loadVoices();
    return () => { alive = false; };
  }, []);

  const addSong = (file) => {
    const problem = validateAudio(file);
    if (problem) { setError(problem); return; }
    setError(""); setSongFile(file); setSongName(file.name.replace(/\.[^.]+$/, "")); setResultUrl("");
  };

  const cancel = () => {
    cancelledRef.current = true; abortRef.current?.abort(); abortRef.current = null; setStage(null); addToast?.("Voice cover cancelled", "info");
  };

  const generate = async () => {
    if (!songFile) { setError("Choose the licensed/permitted song audio file first. A song title alone is not used to rip copyrighted audio from streaming sites."); return; }
    if (!voiceId.trim()) { setError("Choose a Puter-supported target voice first."); return; }
    if (!consent) { setError("Confirm that you are authorized to create and process this cover."); return; }
    if (!window.puter?.ai?.speech2speech) { setError("Puter.js speech2speech is unavailable in this browser."); return; }

    cancelledRef.current = false; setError(""); setResultUrl("");
    const controller = new AbortController(); abortRef.current = controller;
    try {
      setStage("Uploading");
      const body = new FormData(); body.append("song", songFile); body.append("songName", songName); body.append("outputFormat", exportFormat);
      const sep = await fetch(`${apiBase}/voice-cover/separate`, { method: "POST", signal: controller.signal, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined, body });
      setStage("Separating Vocals");
      const sepData = await sep.json().catch(() => ({}));
      if (!sep.ok) throw new Error(sepData?.message || "Vocal separation failed. Configure the backend separator model.");
      const vocalsUrl = sepData.vocalsUrl || sepData.data?.vocalsUrl;
      const instrumentalUrl = sepData.instrumentalUrl || sepData.data?.instrumentalUrl;
      if (!vocalsUrl || !instrumentalUrl) throw new Error("Separator did not return both vocals and instrumental tracks.");

      setStage("Converting Voice");
      const converted = await window.puter.ai.speech2speech({
        audio: vocalsUrl,
        voice: voiceId.trim(),
        model: "eleven_multilingual_sts_v2",
        output_format: "mp3_44100_128",
        remove_background_noise: true,
      });
      if (cancelledRef.current || controller.signal.aborted) return;
      const convertedBlob = await audioElementToBlob(converted);
      if (cancelledRef.current || controller.signal.aborted) return;

      setStage("Mixing");
      const mixBody = new FormData();
      mixBody.append("instrumentalUrl", instrumentalUrl);
      mixBody.append("convertedVocals", new File([convertedBlob], "converted-vocals.mp3", { type: convertedBlob.type || "audio/mpeg" }));
      mixBody.append("outputFormat", exportFormat);
      mixBody.append("songName", songName || "voice-cover");
      const mix = await fetch(`${apiBase}/voice-cover/mix`, { method: "POST", signal: controller.signal, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined, body: mixBody });
      const mixData = await mix.json().catch(() => ({}));
      if (!mix.ok) throw new Error(mixData?.message || "Final audio mixing failed.");
      const finalUrl = mixData.url || mixData.data?.url;
      if (!finalUrl) throw new Error("Mixer returned no final audio URL.");
      setResultUrl(finalUrl); setStage("Complete"); addToast?.("Voice cover complete", "success");
    } catch (e) {
      if (e?.name !== "AbortError") { setError(e?.message || "Voice cover generation failed."); setStage(null); }
    } finally { abortRef.current = null; }
  };

  return (
    <div className="vc-shell">
      <div className="vc-header">
        <div><div className="vc-eyebrow">Audio Studio</div><h2><Music2 size={24}/> Voice Cover</h2><p>Create a permitted cover with Puter speech-to-speech. No developer ElevenLabs API key is required.</p></div>
        <button className="vc-icon-btn" onClick={onClose} aria-label="Close"><X size={20}/></button>
      </div>

      <div className="vc-grid">
        <section className="vc-card">
          <div className="vc-step-title"><span>1</span> Choose the song</div>
          <div className="vc-row"><Search size={18}/><input className="vc-input" value={songName} onChange={(e)=>setSongName(e.target.value)} placeholder="Song name (for your project)"/></div>
          <small className="vc-note">Type a project name, then upload audio you own or are permitted to process. VetroAI does not rip full songs from streaming services.</small>
          <label className="vc-dropzone">
            <Upload size={24}/><strong>{songFile ? songFile.name : "Upload the permitted song audio"}</strong>
            <small>MP3, WAV, M4A, AAC, OGG or FLAC · maximum {MAX_MB} MB</small>
            <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" hidden onChange={(e)=>addSong(e.target.files?.[0])}/>
          </label>
        </section>

        <section className="vc-card">
          <div className="vc-step-title"><span>2</span> Choose the target voice</div>
          <div className="vc-row">
            <Sparkles size={18}/>
            <select className="vc-input" value={voiceId} onChange={(e)=>setVoiceId(e.target.value)} disabled={loadingVoices}>
              {voices.map((voice)=><option key={voice.id} value={voice.id}>{voice.name || voice.id}</option>)}
            </select>
          </div>
          <small className="vc-note">These voices are loaded through Puter. Puter handles the provider access, so VetroAI does not need your own ElevenLabs API key.</small>
          <div className="vc-self-voice-note">
            <strong>Want your exact voice?</strong>
            <span>Puter currently accepts a target voice ID but does not document creating a new custom clone from your recording. Exact self-voice cloning will use a separate self-hosted RVC service instead of a paid developer API.</span>
          </div>
          <label className="vc-consent"><input type="checkbox" checked={consent} onChange={(e)=>setConsent(e.target.checked)}/><span>I confirm I am authorized to process this song and use the selected voice for this cover.</span></label>
        </section>
      </div>

      <section className="vc-card vc-progress-card">
        <div className="vc-progress-head"><div><div className="vc-step-title"><span>3</span> Generate my cover</div><p>Song → isolate singer → Puter voice conversion → remix with instrumental → export.</p></div><select value={exportFormat} onChange={(e)=>setExportFormat(e.target.value)} disabled={!!stage && stage!=="Complete"}><option value="mp3">MP3</option><option value="wav">WAV</option></select></div>
        <div className="vc-stages">{STAGES.map((s,i)=><div key={s} className={`vc-stage ${progress>i?"done":""} ${stage===s?"active":""}`}><span>{progress>i?<CheckCircle2 size={16}/>:i+1}</span><b>{s}</b></div>)}</div>
        {error && <div className="vc-error"><AlertCircle size={17}/>{error}</div>}
        <div className="vc-actions"><button className="vc-primary" onClick={generate} disabled={!!stage && stage!=="Complete"}>Generate Full Voice Cover</button>{stage && stage!=="Complete" && <button className="vc-danger" onClick={cancel}><Square size={15}/> Cancel</button>}</div>
        {resultUrl && <div className="vc-result"><audio controls src={resultUrl}/><a className="vc-download" href={resultUrl} download={`${(songName || "voice-cover").replace(/[^a-z0-9-_]+/gi,"-")}.${exportFormat}`}><Download size={16}/> Download {exportFormat.toUpperCase()}</a></div>}
      </section>
    </div>
  );
}
