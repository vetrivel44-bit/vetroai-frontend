// Voice Cover engine: free, no API keys, no paid services.
//
// 1. The song is split into vocals + instrumental on free CPU Spaces running
//    UVR5's Kim_Vocal_2 model (no GPU allowance used), with the free GPU
//    Demucs Space "abidlabs/music-separation" as the last resort.
// 2. Seed-VC's singing model on the free Space "Plachta/Seed-VC" (/predict_1,
//    pitch-following) re-sings those vocals in the user's own voice, using
//    their recording as the reference.
// 3. The browser mixes the new vocals over the instrumental (Web Audio) and
//    encodes MP3 (lamejs) or WAV.
//
// Seed-VC runs on Hugging Face's free ZeroGPU: 2 GPU-minutes a day without an
// account, 5 with a free account's token (each run reserves ~60 s). Errors
// from Hugging Face are shown as they are, so a used-up allowance is clear.

// Copies of the same UVR5 Space; the first one that answers is used. (Other
// CPU separators were tried: their output files are blocked (403) or they run
// a Gradio too old for the client.)
const CPU_SEPARATORS = ["Erickeee/UVR5_UI", "stdz/UVR5_UI_2", "DilshanIRU/UVR5_UI"];
const UVR_OPTIONS = {
  model: "Kim_Vocal_2.onnx", out_format: "wav", hop_length: 1024, segment_size: 256,
  denoise: true, overlap: 0.25, batch_size: 1, norm_thresh: 0.9, amp_thresh: 0.7, single_stem: "",
};
const SEPARATOR_SPACE = "abidlabs/music-separation";
const CONVERTER_SPACE = "Plachta/Seed-VC";
const SAMPLE_RATE = 44100;
const REFERENCE_SECONDS = 30; // Seed-VC only uses ~25 s of reference anyway

const abortError = () => new DOMException("Voice cover cancelled", "AbortError");

export function friendly(message, space) {
  const text = String(message || "").trim();
  if (/quota|runs limit|exceeded/i.test(text)) {
    return "Hugging Face's free GPU time for today is used up (2 minutes a day without an account). "
      + "Add your free Hugging Face token below to get 5 minutes a day, or try again tomorrow. "
      + `(Hugging Face said: ${text})`;
  }
  if (/sleep|building|starting|not running|runtime/i.test(text)) {
    return `The free ${space} model is waking up. Wait a minute and try again.`;
  }
  return text ? `${space}: ${text}` : `${space} did not return any audio. Please try again.`;
}

async function runSpace(space, endpoint, payload, { signal, onStatus, token } = {}) {
  const { Client } = await import("@gradio/client");
  if (signal?.aborted) throw abortError();
  let client;
  try {
    // Without "status" events the client drops Hugging Face's errors (a used-up
    // GPU allowance looked like "returned no audio").
    client = await Client.connect(space, { events: ["data", "status"], ...(token ? { hf_token: token } : {}) });
  } catch (err) {
    throw new Error(friendly(err?.message || "could not connect", space));
  }
  const job = client.submit(endpoint, payload);
  const cancel = () => { try { job.cancel(); } catch { /* already finished */ } };
  signal?.addEventListener("abort", cancel, { once: true });
  let result = null;
  try {
    for await (const message of job) {
      if (signal?.aborted) throw abortError();
      if (message.type === "data") result = message.data;
      if (message.type === "status") {
        if (message.stage === "error") throw new Error(friendly(message.message, space));
        onStatus?.(message);
        if (message.stage === "complete" && result) break;
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
  if (signal?.aborted) throw abortError();
  if (!result) throw new Error(friendly("returned no audio", space));
  return result;
}

const fileUrl = (value) => value?.url || (typeof value === "string" ? value : "");

async function fetchAudio(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Could not download audio from Hugging Face (${res.status}).`);
  return res.blob();
}

async function decode(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close?.();
  }
}

function encodeWav(channels, sampleRate) {
  const frames = channels[0].length;
  const numCh = channels.length;
  const buffer = new ArrayBuffer(44 + frames * numCh * 2);
  const view = new DataView(buffer);
  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + frames * numCh * 2, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * numCh * 2, true); view.setUint16(32, numCh * 2, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, frames * numCh * 2, true);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** The user's reference recording as a short mono WAV (webm/m4a decode in the browser). */
async function referenceWav(file) {
  const audio = await decode(file);
  const frames = Math.min(audio.length, Math.floor(REFERENCE_SECONDS * audio.sampleRate));
  const mono = new Float32Array(frames);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < frames; i++) mono[i] += data[i] / audio.numberOfChannels;
  }
  return new File([encodeWav([mono], audio.sampleRate)], "my-voice.wav", { type: "audio/wav" });
}

/** The first `seconds` of a song as WAV (shorter clips fit the free GPU slot), and its length. */
async function trimmedSong(file, seconds) {
  const audio = await decode(file);
  if (!seconds || audio.duration <= seconds + 0.5) return { clip: file, duration: audio.duration };
  const frames = Math.floor(seconds * audio.sampleRate);
  const channels = [];
  for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) channels.push(audio.getChannelData(c).slice(0, frames));
  const name = file.name.replace(/\.[^.]+$/, "") + `-first-${seconds}s.wav`;
  return { clip: new File([encodeWav(channels, audio.sampleRate)], name, { type: "audio/wav" }), duration: seconds };
}

// The free CPU separator runs at roughly 3.6x the clip's length.
const separationEstimate = (seconds) => {
  const minutes = Math.max(1, Math.round((seconds * 3.6) / 60));
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
};

function pickStems(files) {
  const list = Array.isArray(files) ? files : [];
  const name = (f) => String(f?.orig_name || f?.path || f?.url || "");
  return {
    vocals: list.find((f) => /vocals/i.test(name(f)) && !/instrumental|no_vocals/i.test(name(f))) || list[1],
    instrumental: list.find((f) => /instrumental|no_vocals/i.test(name(f))) || list[0],
  };
}

async function separate(song, { signal, token, onStatus }) {
  const { handle_file } = await import("@gradio/client");
  for (const space of CPU_SEPARATORS) {
    try {
      const stems = pickStems(await runSpace(space, "/mdxnet_separator", { audio: handle_file(song), ...UVR_OPTIONS }, { signal, onStatus }));
      if (fileUrl(stems.vocals) && fileUrl(stems.instrumental)) return stems;
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      console.warn(`${space} could not separate the song`, err);
    }
  }
  // Last resort: the GPU separator (uses ~60 s of the daily free GPU time).
  const [vocals, instrumental] = await runSpace(SEPARATOR_SPACE, "/inference", { audio: handle_file(song) }, { signal, onStatus, token });
  return { vocals, instrumental };
}

async function encodeMp3(channels, sampleRate) {
  const lame = await import("@breezystack/lamejs");
  const Mp3Encoder = lame.Mp3Encoder || lame.default?.Mp3Encoder;
  const encoder = new Mp3Encoder(channels.length, sampleRate, 192);
  const toInt16 = (f32) => { const out = new Int16Array(f32.length); for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return out; };
  const left = toInt16(channels[0]);
  const right = channels[1] ? toInt16(channels[1]) : null;
  const parts = [];
  const block = 1152;
  for (let i = 0, n = 0; i < left.length; i += block, n++) {
    const chunk = right ? encoder.encodeBuffer(left.subarray(i, i + block), right.subarray(i, i + block)) : encoder.encodeBuffer(left.subarray(i, i + block));
    if (chunk.length) parts.push(new Uint8Array(chunk));
    if (n % 400 === 0) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  return new Blob(parts, { type: "audio/mpeg" });
}

async function mix(instrumentalBlob, vocalsBlob, format) {
  const [inst, voc] = await Promise.all([decode(instrumentalBlob), decode(vocalsBlob)]);
  const length = Math.ceil(Math.max(inst.duration, voc.duration) * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
  for (const buffer of [inst, voc]) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(0);
  }
  const rendered = await ctx.startRendering();
  const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
  if (peak > 0.98) { const g = 0.98 / peak; for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= g; }
  if (format === "mp3") {
    try { return await encodeMp3(channels, SAMPLE_RATE); } catch (err) { console.warn("MP3 encoding failed, using WAV", err); }
  }
  return encodeWav(channels, SAMPLE_RATE);
}

/**
 * Make a cover of `song` sung in the voice from `referenceVoice`.
 * @param {{ song: File, referenceVoice: File, format?: "mp3"|"wav", signal?: AbortSignal,
 *           onStage?: (stage: string) => void, onDetail?: (text: string) => void }} options
 * @returns {Promise<Blob>}
 */
export async function createVoiceCover({ song, referenceVoice, format = "mp3", signal, onStage, onDetail, maxSeconds = 60, hfToken = "" }) {
  const token = String(hfToken || "").trim() || undefined;
  const { handle_file } = await import("@gradio/client");
  const queueDetail = (label, where) => (status) => {
    if (status.stage === "pending" && Number.isFinite(status.position)) onDetail?.(`${label}: waiting in the free queue (position ${status.position + 1})…`);
    else if (status.stage === "pending" || status.stage === "generating") onDetail?.(`${label}: running on ${where}…`);
  };

  onStage?.("Uploading");
  onDetail?.(maxSeconds ? `Preparing the first ${maxSeconds} seconds of the song…` : "Preparing the song…");
  const { clip, duration } = await trimmedSong(song, maxSeconds);
  if (signal?.aborted) throw abortError();
  onStage?.("Separating Vocals");
  const eta = separationEstimate(duration);
  onDetail?.(`Separating the singer from the music on a free CPU model (${eta})…`);
  const { vocals, instrumental } = await separate(clip, { signal, token, onStatus: queueDetail("Separating vocals", `a free CPU model (${eta})`) });
  if (!fileUrl(vocals) || !fileUrl(instrumental)) throw new Error("The separator did not return both the vocals and the instrumental.");

  onStage?.("Learning My Voice");
  onDetail?.("Preparing your voice sample…");
  const reference = await referenceWav(referenceVoice);
  if (signal?.aborted) throw abortError();

  onStage?.("Converting Singer");
  const convertWith = (source) => runSpace(CONVERTER_SPACE, "/predict_1", {
    source_audio_path: source,
    target_audio_path: handle_file(reference),
    diffusion_steps: 10,
    length_adjust: 1,
    inference_cfg_rate: 0.7,
    f0_condition: true, // singing: follow the original melody
    auto_f0_adjust: true, // move the melody into the user's vocal range
    pitch_shift: 0,
  }, { signal, token, onStatus: queueDetail("Converting to your voice", "Hugging Face's free GPU") });
  let converted;
  try {
    converted = await convertWith(handle_file(fileUrl(vocals)));
  } catch (err) {
    if (err?.name === "AbortError" || /quota|runs limit|GPU time/i.test(err?.message || "")) throw err;
    // The Space could not fetch the vocals by URL: upload the bytes instead.
    converted = await convertWith(handle_file(await fetchAudio(fileUrl(vocals), signal)));
  }
  const fullOutput = Array.isArray(converted) ? (converted[1] || converted[0]) : converted;
  if (!fileUrl(fullOutput)) throw new Error("Seed-VC did not return the converted vocals.");

  onStage?.("Mixing");
  onDetail?.("Mixing your vocals with the instrumental…");
  const [instBlob, vocBlob] = await Promise.all([fetchAudio(fileUrl(instrumental), signal), fetchAudio(fileUrl(fullOutput), signal)]);
  const result = await mix(instBlob, vocBlob, format);
  onDetail?.("");
  return result;
}
