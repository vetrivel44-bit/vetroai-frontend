import React, { useMemo, useRef, useState } from "react";
import { Mic, Music2, Upload, Download, X, Square, CircleStop, CheckCircle2, AlertCircle, Search } from "lucide-react";
import "./VoiceCoverPanel.css";

const ACCEPTED = ["audio/mpeg","audio/wav","audio/x-wav","audio/mp4","audio/x-m4a","audio/aac","audio/ogg","audio/flac","audio/webm"];
const MAX_MB = 50;
const STAGES = ["Uploading","Separating Vocals","Learning My Voice","Converting Singer","Mixing","Complete"];

function validateAudio(file) {
  if (!file) return "Choose an audio file.";
  if (file.size > MAX_MB * 1024 * 1024) return `File must be ${MAX_MB} MB or smaller.`;
  const ext=file.name.split(".").pop()?.toLowerCase();
  if (!ACCEPTED.includes(file.type) && !["mp3","wav","m4a","aac","ogg","flac","mp4","webm"].includes(ext)) return "Unsupported audio format.";
  return "";
}

async function readErrorMessage(response) {
  const raw = await response.text().catch(() => "");
  if (!raw) return `Voice cover request failed (${response.status}).`;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.message || parsed?.detail || raw;
  } catch {
    return raw.length > 700 ? `${raw.slice(0, 700)}…` : raw;
  }
}

export default function VoiceCoverPanel({apiBase,authToken,onClose,addToast}) {
  const [songFile,setSongFile]=useState(null);
  const [songName,setSongName]=useState("");
  const [voiceFile,setVoiceFile]=useState(null);
  const [consent,setConsent]=useState(false);
  const [stage,setStage]=useState(null);
  const [error,setError]=useState("");
  const [resultUrl,setResultUrl]=useState("");
  const [exportFormat,setExportFormat]=useState("mp3");
  const [recording,setRecording]=useState(false);
  const recorderRef=useRef(null); const chunksRef=useRef([]); const abortRef=useRef(null);
  const progress=useMemo(()=>stage==null?0:Math.max(0,STAGES.indexOf(stage)+1),[stage]);

  const addSong=(file)=>{const p=validateAudio(file);if(p){setError(p);return;}setError("");setSongFile(file);setSongName(file.name.replace(/\.[^.]+$/, ""));setResultUrl("");};
  const addVoice=(file)=>{const p=validateAudio(file);if(p){setError(p);return;}setError("");setVoiceFile(file);};

  const startRecording=async()=>{
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
      const rec=new MediaRecorder(stream); chunksRef.current=[];
      rec.ondataavailable=e=>{if(e.data.size)chunksRef.current.push(e.data);};
      rec.onstop=()=>{const blob=new Blob(chunksRef.current,{type:rec.mimeType||"audio/webm"});setVoiceFile(new File([blob],`my-voice-${Date.now()}.webm`,{type:blob.type}));stream.getTracks().forEach(t=>t.stop());};
      rec.start(); recorderRef.current=rec; setRecording(true); setError("");
    } catch(e){setError(e?.message||"Microphone permission was denied.");}
  };
  const stopRecording=()=>{recorderRef.current?.stop();recorderRef.current=null;setRecording(false);};
  const cancel=()=>{abortRef.current?.abort();abortRef.current=null;setStage(null);addToast?.("Voice cover cancelled","info");};

  const generate=async()=>{
    if(!songFile){setError("Upload the song audio you are permitted to process.");return;}
    if(!voiceFile){setError("Record or upload your own voice first. This is what VetroAI uses to make the singer sound like you.");return;}
    if(!consent){setError("Confirm that the reference recording is your voice or you have explicit permission to use it.");return;}
    const controller=new AbortController();abortRef.current=controller;setError("");setResultUrl("");setStage("Uploading");
    try{
      const body=new FormData();body.append("song",songFile);body.append("referenceVoice",voiceFile);body.append("songName",songName);body.append("outputFormat",exportFormat);body.append("consent","true");
      setStage("Separating Vocals");
      const response=await fetch(`${apiBase}/voice-cover/process`,{method:"POST",signal:controller.signal,headers:authToken?{Authorization:`Bearer ${authToken}`} : undefined,body});
      if(!response.ok) throw new Error(await readErrorMessage(response));
      setStage("Learning My Voice");
      const audioBlob=await response.blob();
      setStage("Converting Singer");
      if(!audioBlob.size)throw new Error("Voice engine returned an empty audio file.");
      setStage("Mixing");
      const url=URL.createObjectURL(audioBlob);setResultUrl(url);setStage("Complete");addToast?.("Your voice cover is ready","success");
    }catch(e){if(e?.name!=="AbortError"){setError(e?.message||"Voice cover generation failed.");setStage(null);}}finally{abortRef.current=null;}
  };

  return <div className="vc-shell">
    <div className="vc-header"><div><div className="vc-eyebrow">Audio Studio</div><h2><Music2 size={24}/> Voice Cover</h2><p>Upload a permitted song, give VetroAI a sample of your own voice, and create a cover that uses your vocal identity.</p></div><button className="vc-icon-btn" onClick={onClose}><X size={20}/></button></div>
    <div className="vc-grid">
      <section className="vc-card"><div className="vc-step-title"><span>1</span> Choose the song</div><div className="vc-row"><Search size={18}/><input className="vc-input" value={songName} onChange={e=>setSongName(e.target.value)} placeholder="Song name"/></div><small className="vc-note">Upload audio you own or are permitted to process.</small><label className="vc-dropzone"><Upload size={24}/><strong>{songFile?songFile.name:"Upload song audio"}</strong><small>MP3, WAV, M4A, AAC, OGG or FLAC · max {MAX_MB} MB</small><input type="file" accept="audio/*" hidden onChange={e=>addSong(e.target.files?.[0])}/></label></section>
      <section className="vc-card"><div className="vc-step-title"><span>2</span> Give VetroAI my voice</div><p className="vc-note">This is the main voice used for the cover. Speak naturally in a quiet room. About 30–60 seconds of clean audio is a good reference.</p><div className="vc-sample-actions"><label className="vc-secondary"><Upload size={16}/> {voiceFile?"Replace voice sample":"Upload my voice"}<input type="file" accept="audio/*" hidden onChange={e=>addVoice(e.target.files?.[0])}/></label><button className={recording?"vc-danger":"vc-secondary"} onClick={recording?stopRecording:startRecording}>{recording?<CircleStop size={16}/>:<Mic size={16}/>} {recording?"Stop & use recording":"Record my voice"}</button></div>{voiceFile&&<div className="vc-chips"><span>✓ {voiceFile.name}</span></div>}<label className="vc-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I confirm this is my own voice or I have explicit permission to use it.</span></label></section>
    </div>
    <section className="vc-card vc-progress-card"><div className="vc-progress-head"><div><div className="vc-step-title"><span>3</span> Generate in my voice</div><p>Song → isolate singer → learn your reference voice → convert vocals → remix instrumental → export.</p></div><select value={exportFormat} onChange={e=>setExportFormat(e.target.value)}><option value="mp3">MP3</option><option value="wav">WAV</option></select></div><div className="vc-stages">{STAGES.map((s,i)=><div key={s} className={`vc-stage ${progress>i?"done":""} ${stage===s?"active":""}`}><span>{progress>i?<CheckCircle2 size={16}/>:i+1}</span><b>{s}</b></div>)}</div>{error&&<div className="vc-error"><AlertCircle size={17}/>{error}</div>}<div className="vc-actions"><button className="vc-primary" onClick={generate} disabled={!!stage&&stage!=="Complete"}>Generate Song in My Voice</button>{stage&&stage!=="Complete"&&<button className="vc-danger" onClick={cancel}><Square size={15}/> Cancel</button>}</div>{resultUrl&&<div className="vc-result"><audio controls src={resultUrl}/><a className="vc-download" href={resultUrl} download={`${(songName||"my-voice-cover").replace(/[^a-z0-9-_]+/gi,"-")}.${exportFormat}`}><Download size={16}/> Download {exportFormat.toUpperCase()}</a></div>}</section>
  </div>;
}
