"""VetroAI Voice Cover worker, on Modal's free monthly credits.

The browser uploads a short song clip and the user's voice sample. This
worker separates the singer from the music (Demucs htdemucs), re-sings the
vocals in the user's voice with Seed-VC's singing model (pitch-following,
44.1 kHz), mixes them back over the instrumental and returns MP3 or WAV.

    POST /cover          multipart: song, voice, format=mp3|wav, pitch=0
                         -> 202 {"job": "<id>"}
    GET  /cover/{job}    -> 202 {"status": "running"} | 200 audio | 4xx/5xx {"message"}
    GET  /health         -> {"ok": true}

Jobs run on one T4 GPU container that loads the models once and shuts down a
minute after the last job, so idle time costs nothing. Model weights are
cached in a Modal Volume. A daily cap and an Origin check keep the free
credits from being spent by anything but VetroAI.

Deploy: `modal deploy modal/voice_cover.py` (GitHub Actions does this on
push, see .github/workflows/voice-cover-worker.yml).
"""
import os
import re
import subprocess
import tempfile

import modal

APP_NAME = "vetroai-voice-cover"
SEED_VC_COMMIT = "51383efd921027683c89e5348211d93ff12ac2a8"
DAILY_LIMIT = 25
MAX_UPLOAD_BYTES = 40 * 1024 * 1024
MAX_SONG_SECONDS = 300
ALLOWED_ORIGIN = r"^(https://([a-z0-9-]+\.)?vetroai-frontend\.pages\.dev|http://localhost:\d+)$"

app = modal.App(APP_NAME)
cache = modal.Volume.from_name("vetroai-voice-cover-cache", create_if_missing=True)
usage = modal.Dict.from_name("vetroai-voice-cover-usage", create_if_missing=True)

gpu_image = (
    modal.Image.debian_slim(python_version="3.11")  # Modal's 2026.10 builder: 3.11+
    .apt_install("git", "ffmpeg")
    .pip_install("torch==2.4.0", "torchaudio==2.4.0", index_url="https://download.pytorch.org/whl/cu121")
    .pip_install(
        # Seed-VC's inference dependencies (its requirements.txt minus the GUI,
        # training and evaluation packages), plus Demucs for separation.
        "numpy==1.26.4",
        "scipy==1.13.1",
        "librosa==0.10.2",
        "huggingface-hub>=0.28.1,<1",
        "munch==4.0.0",
        "einops==0.8.0",
        "descript-audio-codec==1.0.0",
        "pydub==0.25.1",
        "transformers==4.46.3",
        "soundfile==0.12.1",
        "pyyaml",
        "matplotlib",
        "onnxruntime",
        "tqdm",
        "demucs==4.0.1",
    )
    .run_commands(
        "git clone https://github.com/Plachtaa/seed-vc /seed-vc",
        f"cd /seed-vc && git checkout {SEED_VC_COMMIT}",
    )
    .env({"HF_HOME": "/cache/hf", "TORCH_HOME": "/cache/torch"})
)

web_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "fastapi[standard]==0.115.12", "python-multipart==0.0.20"
)


def _ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def _finish(result):
    """Seed-VC's convert_voice is a generator even when not streaming; its
    full output is the generator's return value."""
    if not hasattr(result, "__next__"):
        return result
    last = None
    try:
        while True:
            last = next(result)
    except StopIteration as stop:
        if stop.value is not None:
            return stop.value
    return last[1] if isinstance(last, tuple) else last


def _load_seed_vc(device):
    import sys

    sys.path.insert(0, "/seed-vc")
    os.chdir("/seed-vc")  # Seed-VC resolves some config paths relative to its repo
    from seed_vc_wrapper import SeedVCWrapper

    return SeedVCWrapper(device=device)


@app.cls(
    image=gpu_image,
    gpu="T4",
    memory=16384,  # MiB; the separator and Seed-VC's models together need several GB of RAM
    volumes={"/cache": cache},
    timeout=900,
    scaledown_window=60,
    max_containers=1,
)
class VoiceCover:
    @modal.enter()
    def load(self):
        import torch
        from demucs.pretrained import get_model

        self.vc = _load_seed_vc(torch.device("cuda"))
        self.separator = get_model("htdemucs").to("cuda").eval()
        cache.commit()  # keep any newly downloaded weights for the next cold start

    @modal.method()
    def cover(self, song: bytes, song_name: str, voice: bytes, voice_name: str,
              out_format: str = "mp3", pitch: int = 0) -> bytes:
        import numpy as np
        import soundfile as sf
        import torch
        from demucs.apply import apply_model

        ext = lambda name: os.path.splitext(name or "")[1][:8] or ".bin"  # noqa: E731
        with tempfile.TemporaryDirectory() as tmp:
            path = lambda name: os.path.join(tmp, name)  # noqa: E731
            with open(path("song_in" + ext(song_name)), "wb") as f:
                f.write(song)
            with open(path("voice_in" + ext(voice_name)), "wb") as f:
                f.write(voice)
            _ffmpeg("-i", path("song_in" + ext(song_name)), "-t", str(MAX_SONG_SECONDS),
                    "-ac", "2", "-ar", "44100", path("song.wav"))
            _ffmpeg("-i", path("voice_in" + ext(voice_name)), "-t", "30",
                    "-ac", "1", "-ar", "44100", path("voice.wav"))

            # 1. Separate the singer from the music.
            audio, _ = sf.read(path("song.wav"), dtype="float32", always_2d=True)
            wav = torch.from_numpy(audio.T.copy()).to("cuda")
            ref = wav.mean(0)
            mean, std = ref.mean(), ref.std() + 1e-8
            with torch.no_grad():
                sources = apply_model(self.separator, ((wav - mean) / std)[None],
                                      device="cuda", split=True, overlap=0.25, progress=False)[0]
            sources = sources * std + mean
            names = list(self.separator.sources)
            vocals = sources[names.index("vocals")]
            instrumental = sum(sources[i] for i, n in enumerate(names) if n != "vocals")
            sf.write(path("vocals.wav"), vocals.cpu().numpy().T, 44100)
            sf.write(path("instrumental.wav"), instrumental.cpu().numpy().T, 44100)
            del wav, sources
            torch.cuda.empty_cache()

            # 2. Re-sing the vocals in the user's voice (melody kept, moved into
            #    the user's range).
            converted = _finish(self.vc.convert_voice(
                source=path("vocals.wav"), target=path("voice.wav"),
                diffusion_steps=25, length_adjust=1.0, inference_cfg_rate=0.7,
                f0_condition=True, auto_f0_adjust=True, pitch_shift=int(pitch),
                stream_output=False,
            ))
            rate, wave = converted if isinstance(converted, tuple) else (44100, converted)
            sf.write(path("converted.wav"), np.asarray(wave, dtype=np.float32).reshape(-1), int(rate))

            # 3. Mix the new vocals over the instrumental and encode.
            out = path("cover." + out_format)
            codec = ["-c:a", "libmp3lame", "-b:a", "192k"] if out_format == "mp3" else ["-c:a", "pcm_s16le"]
            _ffmpeg("-i", path("instrumental.wav"), "-i", path("converted.wav"),
                    "-filter_complex",
                    "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[out]",
                    "-map", "[out]", "-ar", "44100", *codec, out)
            with open(out, "rb") as f:
                return f.read()


@app.function(image=gpu_image, memory=8192, volumes={"/cache": cache}, timeout=1800)
def prefetch():
    """Download every model into the cache volume once (CPU only, cheap), so the
    first real cover doesn't wait for downloads. Also proves the imports work."""
    import torch
    from demucs.pretrained import get_model

    _load_seed_vc(torch.device("cpu"))
    get_model("htdemucs")
    cache.commit()
    print("Models cached.")


@app.function(image=web_image, timeout=60, max_containers=2)
@modal.asgi_app()
def web():
    import datetime

    from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse, Response

    api = FastAPI(title="VetroAI Voice Cover")
    api.add_middleware(
        CORSMiddleware,
        allow_origin_regex=ALLOWED_ORIGIN,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        max_age=3600,
    )
    origin_ok = re.compile(ALLOWED_ORIGIN)

    def check_origin(request: Request) -> None:
        if not origin_ok.match(request.headers.get("origin", "")):
            raise HTTPException(403, "This voice cover service only answers VetroAI.")

    @api.get("/health")
    def health():
        return {"ok": True, "dailyLimit": DAILY_LIMIT}

    @api.post("/cover", status_code=202)
    async def start(request: Request, song: UploadFile = File(...), voice: UploadFile = File(...),
                    format: str = Form("mp3"), pitch: int = Form(0)):
        check_origin(request)
        song_bytes, voice_bytes = await song.read(), await voice.read()
        if not song_bytes or not voice_bytes:
            raise HTTPException(400, "Both the song and your voice sample are required.")
        if len(song_bytes) > MAX_UPLOAD_BYTES or len(voice_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Files must be 40 MB or smaller.")
        day = datetime.date.today().isoformat()
        used = usage.get(day, 0)
        if used >= DAILY_LIMIT:
            raise HTTPException(429, f"Today's limit of {DAILY_LIMIT} covers is used up. It resets at midnight UTC.")
        usage[day] = used + 1
        call = VoiceCover().cover.spawn(
            song_bytes, song.filename or "song.wav", voice_bytes, voice.filename or "voice.wav",
            "wav" if format == "wav" else "mp3", max(-12, min(12, int(pitch))),
        )
        return {"job": call.object_id}

    @api.get("/cover/{job}")
    def result(job: str, request: Request):
        check_origin(request)
        if not re.fullmatch(r"fc-[A-Za-z0-9]+", job):
            raise HTTPException(400, "Unknown job.")
        try:
            audio = modal.FunctionCall.from_id(job).get(timeout=0)
        except TimeoutError:  # builtin: the job has not finished yet
            return JSONResponse({"status": "running"}, status_code=202)
        except modal.exception.OutputExpiredError:
            return JSONResponse({"message": "This cover expired. Please make it again."}, status_code=410)
        except Exception as err:  # the job itself failed
            return JSONResponse({"message": f"Voice cover failed: {err}"}, status_code=500)
        media = "audio/wav" if audio[:4] == b"RIFF" else "audio/mpeg"
        return Response(content=audio, media_type=media)

    return api
