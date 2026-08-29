import React, { useMemo, useRef, useState } from "react";
import { Mic, Music2, Upload, Download, X, Square, CircleStop, CheckCircle2, AlertCircle, Search } from "lucide-react";
import "./VoiceCoverPanel.css";

const ACCEPTED = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/flac"];
const MAX_MB = 50;
const STAGES = ["Uploading", "Separating Vocals", "Converting Voice", "Mixing", "Complete"];

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
  const [voiceSamples, setVoiceSamples] = useState([]);
  const [voiceId, setVoiceId] = useState("");
  const [profileName, setProfileName] = useState("My Voice");
  const [consent, setConsent] = useState(false);
  const [stage, setStage] = useState(null);
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [exportFormat, setExportFormat] = useState("mp3");
  const [recording, setRecording] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const abortRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const cancelledRef = useRef(false);

  const progress = useMemo(() => stage == null ? 0 : Math.max(0, STAGES.indexOf(stage) + 1), [stage]);

  const addSong = (file) => {
    const problem = validateAudio(file);
    if (problem) { setError(problem); return; }
    setError(""); setSongFile(file); setSongName(file.name.replace(/\.[^.]+$/, "")); setResultUrl("");
  };

  const addSamples = (files) => {
    const next = [];
    for (const file of files) {
      const problem = validateAudio(file);
      if (problem) { setError(problem); return; }
      next.push(file);
    }
    setError(""); setVoiceSamples((prev) => [...prev, ...next].slice(0, 10));
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const sample = new File([blob], `voice-sample-${Date.now()}.webm`, { type: blob.type });
        setVoiceSamples((prev) => [...prev, sample].slice(0, 10));
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start(); recorderRef.current = recorder; setRecording(true);
    } catch (e) { setError(e?.message || "Microphone permission was denied."); }
  };

  const stopRecording = () => { recorderRef.current?.stop(); recorderRef.current = null; setRecording(false); };

  const createVoiceProfile = async () => {
    if (!consent) { setError("Confirm that the voice samples are yours or that you have permission to use them."); return; }
    if (!voiceSamples.length) { setError("Upload or record at least 30 seconds of clean voice audio. 1–3 minutes is recommended for better quality."); return; }
    setCreatingProfile(true); setError("");
    try {
      const body = new FormData();
      body.append("name", profileName || "My Voice"); body.append("consent", "true");
      voiceSamples.forEach((f) => body.append("samples", f));
      const res = await fetch(`${apiBase}/voice-cover/voices`, { method: "POST", headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Voice profile creation is not configured on the backend yet.");
      setVoiceId(data.voiceId || data.data?.voiceId || ""); addToast?.("Voice profile created", "success");
    } catch (e) { setError(e?.message || "Could not create voice profile."); }
    finally { setCreatingProfile(false); }
  };

  const cancel = () => {
    cancelledRef.current = true; abortRef.current?.abort(); abortRef.current = null; setStage(null); addToast?.("Voice cover cancelled", "info");
  };

  const generate = async () => {
    if (!songFile) { setError("Choose the licensed/permitted song audio file first. A song title alone is not used to rip copyrighted audio from streaming sites."); return; }
    if (!voiceId.trim()) { setError("Create or enter your permitted voice profile first."); return; }
    if (!consent) { setError("Confirm voice authorization before generating."); return; }
    if (!window.puter?.ai?.speech2speech) { setError("Puter.js speech2speech is unavailable in this browser."); return; }

    cancelledRef.current = false; setError(""); setResultUrl("");
    const controller = new AbortController(); abortRef.current = controller;
    try {
      setStage("Uploading");
      const body = new FormData(); body.append("song", songFile); body.append("songName", songName); body.append("outputFormat", exportFormat);
      const sep = await fetch(`${apiBase}/voice-cover/separate`, { method: "POST", signal: controller.signal, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined, body });
      setStage("Separating Vocals");
      const sepData = await sep.json().catch(() => ({}));
      if (!sep.ok) throw new Error(sepData?.message || "Vocal separation failed. Configure the backend separator provider/model.");
      const vocalsUrl = sepData.vocalsUrl || sepData.data?.vocalsUrl;
      const instrumentalUrl = sepData.instrumentalUrl || sepData.data?.instrumentalUrl;
      if (!vocalsUrl || !instrumentalUrl) throw new Error("Separator did not return both vocals and instrumental tracks.");

      setStage("Converting Voice");
      const converted = await window.puter.ai.speech2speech({ audio: vocalsUrl, voice: voiceId.trim(), model: "eleven_multilingual_sts_v2", output_format: "mp3_44100_128", remove_background_noise: true });
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
        <div><div className="vc-eyebrow">Audio Studio</div><h2><Music2 size={24}/> Voice Cover</h2><p>Hear how a song would sound in your authorized voice while preserving the source performance and instrumental.</p></div>
        <button className="vc-icon-btn" onClick={onClose} aria-label="Close"><X size={20}/></button>
      </div>

      <div className="vc-grid">
        <section className="vc-card">
          <div className="vc-step-title"><span>1</span> Choose the song</div>
          <div className="vc-row"><Search size={18}/><input className="vc-input" value={songName} onChange={(e)=>setSongName(e.target.value)} placeholder="Song name (for your project)"/></div>
          <small className="vc-note">You can type the song name, then provide audio you own or are licensed/permitted to use. VetroAI will not rip a full copyrighted recording from YouTube, Spotify, or another streaming service just from its title.</small>
          <label className="vc-dropzone">
            <Upload size={24}/><strong>{songFile ? songFile.name : "Upload the permitted song audio"}</strong>
            <small>MP3, WAV, M4A, AAC, OGG or FLAC · maximum {MAX_MB} MB</small>
            <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" hidden onChange={(e)=>addSong(e.target.files?.[0])}/>
          </label>
        </section>

        <section className="vc-card">
          <div className="vc-step-title"><span>2</span> Your voice</div>
          <div className="vc-row"><input className="vc-input" value={profileName} onChange={(e)=>setProfileName(e.target.value)} placeholder="Voice profile name"/><input className="vc-input" value={voiceId} onChange={(e)=>setVoiceId(e.target.value)} placeholder="Permitted voice ID (optional if creating below)"/></div>
          <div className="vc-sample-actions">
            <label className="vc-secondary"><Upload size={16}/> Upload voice sample<input type="file" accept="audio/*" multiple hidden onChange={(e)=>addSamples([...e.target.files])}/></label>
            <button className={recording ? "vc-danger" : "vc-secondary"} onClick={recording ? stopRecording : startRecording}>{recording ? <CircleStop size={16}/> : <Mic size={16}/>} {recording ? "Stop recording" : "Record my voice"}</button>
          </div>
          <small className="vc-note">30 seconds minimum is a practical starting point; 1–3 minutes of clean, dry voice is recommended for better results.</small>
          {!!voiceSamples.length && <div className="vc-chips">{voiceSamples.map((f,i)=><span key={`${f.name}-${i}`}>{f.name}<button onClick={()=>setVoiceSamples(v=>v.filter((_,x)=>x!==i))}>×</button></span>)}</div>}
          <label className="vc-consent"><input type="checkbox" checked={consent} onChange={(e)=>setConsent(e.target.checked)}/><span>I confirm this is my own voice or I have explicit permission to use it.</span></label>
          <button className="vc-secondary vc-wide" disabled={creatingProfile || !voiceSamples.length} onClick={createVoiceProfile}>{creatingProfile ? "Creating profile…" : "Create my voice profile"}</button>
        </section>
      </div>

      <section className="vc-card vc-progress-card">
        <div className="vc-progress-head"><div><div className="vc-step-title"><span>3</span> Generate my cover</div><p>Song → isolate singer → convert isolated vocal to your voice → remix with instrumental → full permitted cover.</p></div><select value={exportFormat} onChange={(e)=>setExportFormat(e.target.value)} disabled={!!stage && stage!=="Complete"}><option value="mp3">MP3</option><option value="wav">WAV</option></select></div>
        <div className="vc-stages">{STAGES.map((s,i)=><div key={s} className={`vc-stage ${progress>i?"done":""} ${stage===s?"active":""}`}><span>{progress>i?<CheckCircle2 size={16}/>:i+1}</span><b>{s}</b></div>)}</div>
        {error && <div className="vc-error"><AlertCircle size={17}/>{error}</div>}
        <div className="vc-actions"><button className="vc-primary" onClick={generate} disabled={!!stage && stage!=="Complete"}>Generate Full Voice Cover</button>{stage && stage!=="Complete" && <button className="vc-danger" onClick={cancel}><Square size={15}/> Cancel</button>}</div>
        {resultUrl && <div className="vc-result"><audio controls src={resultUrl}/><a className="vc-download" href={resultUrl} download={`${(songName || "voice-cover").replace(/[^a-z0-9-_]+/gi,"-")}.${exportFormat}`}><Download size={16}/> Download {exportFormat.toUpperCase()}</a></div>}
      </section>
    </div>
  );
}
