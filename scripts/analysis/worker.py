"""One-request, local-only audio analysis worker. See README.md for the protocol."""

from __future__ import annotations

import contextlib
from fractions import Fraction
import gc
import hashlib
import importlib
import importlib.metadata
import importlib.util
import json
import math
from numbers import Real
import os
from pathlib import Path
import platform
import shutil
import socket
import stat
import sys
import threading
import time
import uuid


MAX_DURATION = 1800
MAX_EXCERPT = 600
STEMS = ("vocals", "drums", "bass", "other")
FORMATS = {".wav": "wav", ".flac": "flac", ".mp3": "mp3", ".ogg": "ogg", ".m4a": "mov"}
CORE_VERSIONS = {
    "av": "14.2.0", "numpy": "1.26.4", "scipy": "1.15.2",
    "librosa": "0.10.2.post1", "soundfile": "0.13.1",
}
PROFILES = {
    "stems": {
        "repo": "adefossez/HTDemucs",
        "revision": "cbc8a9b1a87023b7fd74e7b3412e6321c0eab003",
        "license": "MIT",
        "licenseUrl": "https://github.com/adefossez/demucs/blob/v4.1.0/LICENSE",
        "required": ["955717e8.safetensors", "htdemucs.yaml"],
        "packages": {"demucs": "4.1.0", "torch": "2.6.0+cpu", "safetensors": "0.5.3"},
    },
    "lyrics-tiny": {
        "repo": "Systran/faster-whisper-tiny",
        "revision": "d90ca5fe260221311c53c58e660288d3deb8d356",
        "license": "MIT",
        "licenseUrl": "https://github.com/SYSTRAN/faster-whisper/blob/v1.1.1/LICENSE",
        "required": ["model.bin", "config.json", "tokenizer.json", "vocabulary.txt"],
        "packages": {"faster-whisper": "1.1.1", "ctranslate2": "4.5.0", "setuptools": "75.8.2"},
    },
    "lyrics-base": {
        "repo": "Systran/faster-whisper-base",
        "revision": "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66",
        "license": "MIT",
        "licenseUrl": "https://github.com/SYSTRAN/faster-whisper/blob/v1.1.1/LICENSE",
        "required": ["model.bin", "config.json", "tokenizer.json", "vocabulary.txt"],
        "packages": {"faster-whisper": "1.1.1", "ctranslate2": "4.5.0", "setuptools": "75.8.2"},
    },
    "notes": {
        "repo": "spotify/basic-pitch",
        "revision": "9991303bba609a3b93089d13ec80d1d495083596",
        "license": "Apache-2.0",
        "licenseUrl": "https://github.com/spotify/basic-pitch/blob/9991303bba609a3b93089d13ec80d1d495083596/LICENSE",
        "required": ["nmp.tflite"],
        "packages": {"basic-pitch": "0.4.0", "tensorflow": "2.15.0", "setuptools": "75.8.2"},
    },
    "captions": {
        "repo": "Qwen/Qwen2-Audio-7B-Instruct",
        "revision": "0a095220c30b7b31434169c3086508ef3ea5bf0a",
        "license": "Apache-2.0",
        "licenseUrl": "https://huggingface.co/Qwen/Qwen2-Audio-7B-Instruct/blob/0a095220c30b7b31434169c3086508ef3ea5bf0a/README.md",
        "required": ["config.json", "preprocessor_config.json", "tokenizer_config.json",
                     "tokenizer.json", "model.safetensors.index.json"],
        "packages": {"transformers": "4.51.3", "torch": "2.6.0+cpu", "accelerate": "1.6.0", "psutil": "7.0.0"},
    },
}
_protocol = sys.stdout
_emit_lock = threading.Lock()

_native_spec = importlib.util.spec_from_file_location("soundstudio_native_captions", Path(__file__).with_name("native_captions.py"))
native = importlib.util.module_from_spec(_native_spec)
_native_spec.loader.exec_module(native)
PROFILES[native.PROFILE] = native.PROFILE_SPEC


class WorkerError(Exception):
    """Actionable error safe to display without exposing managed file paths."""


def emit(event: dict) -> None:
    with _emit_lock:
        _protocol.write(json.dumps(event, ensure_ascii=True, allow_nan=False, separators=(",", ":")) + "\n")
        _protocol.flush()


def progress(value: float, stage: str) -> None:
    emit({"type": "progress", "progress": max(0.0, min(1.0, float(value))), "stage": stage})


def check(condition: bool, message: str) -> None:
    if not condition:
        raise WorkerError(message)


def number(value, lower: float, upper: float) -> bool:
    return type(value) in (float, int) and math.isfinite(value) and lower <= value <= upper


def exact_keys(value, keys, label: str) -> None:
    check(isinstance(value, dict) and set(value) == set(keys), f"Invalid {label} fields.")


def validate_options(options: dict) -> dict:
    exact_keys(options, ("start", "end", "stems", "lyrics", "wordTimestamps", "notes", "captions", "captionModel"), "analysis options")
    check(number(options["start"], 0, MAX_DURATION) and number(options["end"], 0, MAX_DURATION),
          "Excerpt timestamps must be finite source seconds from 0 to 1800.")
    check(0 < options["end"] - options["start"] <= MAX_EXCERPT, "Select an excerpt of up to 600 seconds.")
    stems = options["stems"]
    check(isinstance(stems, list) and len(stems) <= 4 and all(s in STEMS for s in stems)
          and len(set(stems)) == len(stems), "Select unique stems: vocals, drums, bass, other.")
    check(options["lyrics"] in ("none", "tiny", "base"), "Choose lyrics none, tiny, or base.")
    check(options["captionModel"] in ("captions", "captions-native"), "Choose a supported caption model explicitly.")
    for key in ("wordTimestamps", "notes", "captions"):
        check(type(options[key]) is bool, f"{key} must be a boolean.")
    return options


def local_path(value: str, *, directory: bool = False, create: bool = False) -> Path:
    check(isinstance(value, str) and value and "\x00" not in value, "A local absolute path is required.")
    path = Path(value)
    check(path.is_absolute() and not value.startswith(("\\\\", "//")),
          "Only local absolute paths are accepted; network shares and URLs are not supported.")
    check(":" not in str(path)[len(path.anchor):], "Alternate streams and protocol paths are not supported.")
    # Refuse junctions as well as symlinks before resolving, including ancestor links.
    for part in (path, *path.parents):
        if part.exists() or part.is_symlink():
            attributes = getattr(part.lstat(), "st_file_attributes", 0)
            check(not part.is_symlink() and not attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400),
                  "Linked files and directories are not supported.")
    if create:
        path.mkdir(parents=True, exist_ok=True)
    check(path.is_dir() if directory else path.is_file(), "The managed directory or audio file is missing.")
    return path.resolve(strict=True)


def child_file(root: Path, name: str) -> Path:
    check(isinstance(name, str) and name and "\\" not in name and not name.startswith("/")
          and all(part not in ("", ".", "..") for part in name.split("/")) and ":" not in name,
          "Invalid managed model filename.")
    candidate = root.joinpath(*name.split("/"))
    check(candidate.resolve().is_relative_to(root.resolve()), "A model file escaped its managed directory.")
    for part in (candidate, *candidate.parents):
        if part == root.parent:
            break
        if part.exists() or part.is_symlink():
            attributes = getattr(part.lstat(), "st_file_attributes", 0)
            check(not part.is_symlink() and not attributes & 0x400, "Linked model files are not supported.")
    return candidate


@contextlib.contextmanager
def offline():
    """Defense in depth, not an OS sandbox: native libraries still require local-only APIs."""
    variables = {
        "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_DATASETS_OFFLINE": "1",
        "HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1", "HF_HUB_DISABLE_XET": "1",
        "TOKENIZERS_PARALLELISM": "false", "WANDB_DISABLED": "true",
    }
    previous = {key: os.environ.get(key) for key in variables}
    os.environ.update(variables)

    def deny(*args, **kwargs):
        raise WorkerError("Network access is disabled during import, diagnosis, and analysis. Install models explicitly first.")

    patches = [(socket, "create_connection"), (socket, "getaddrinfo"),
               (socket.socket, "connect"), (socket.socket, "connect_ex"), (socket.socket, "sendto")]
    originals = [(owner, name, getattr(owner, name)) for owner, name in patches]
    for owner, name, _ in originals:
        setattr(owner, name, deny)
    try:
        yield
    finally:
        for owner, name, value in originals:
            setattr(owner, name, value)
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def check_versions(versions: dict) -> None:
    for package, expected in versions.items():
        try:
            actual = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            raise WorkerError(f"Missing dependency {package}. Install this analysis profile in Model Settings.") from None
        check(actual == expected, f"{package} {expected} is required; found {actual}. Reinstall the analysis profile.")


def check_core() -> None:
    check_versions(CORE_VERSIONS)
    for module in CORE_VERSIONS:
        importlib.import_module(module)
    import av
    check(bool(av.library_versions.get("libavcodec")), "The bundled PyAV decoder is unavailable.")


def reject_external_io(*args, **kwargs):
    raise WorkerError("Audio must be self-contained. External files, playlists, and network references are not supported.")


def import_audio(source: Path, output: Path) -> dict:
    import av
    import numpy as np
    import soundfile as sf

    extension = source.suffix.lower()
    check(extension in FORMATS, "Supported imports are WAV, FLAC, MP3, OGG, and M4A.")
    final = output / "reference.wav"
    check(not final.exists(), "A reference already exists in this import directory.")
    partial = output / f".reference-{uuid.uuid4().hex}.wav"
    target_rate = 44100
    channels = 0
    count = 0
    decoded_duration = Fraction(0)
    last_progress = -1.0
    progress(0, "Validating and decoding local audio")
    try:
        # A Python file handle, forced demuxer, empty protocol allow-list, and custom IO
        # rejection prevent FFmpeg from following a disguised playlist or MOV reference.
        with source.open("rb") as handle, av.open(
            handle, mode="r", format=FORMATS[extension],
            options={"protocol_whitelist": "", "enable_drefs": "0", "use_absolute_path": "0"},
            io_open=reject_external_io,
        ) as container:
            check(len(container.streams.audio) == 1, "The file must contain exactly one audio stream.")
            stream = container.streams.audio[0]
            input_rate = stream.codec_context.sample_rate
            channels = stream.codec_context.channels
            check(channels in (1, 2), "Only mono or stereo audio is supported; downmix multichannel audio before import.")
            check(8000 <= input_rate <= 192000, "The source sample rate must be between 8000 and 192000 Hz.")
            declared_duration = float(stream.duration * stream.time_base) if stream.duration is not None else None
            if declared_duration is not None:
                check(math.isfinite(declared_duration) and 0 <= declared_duration <= MAX_DURATION,
                      "Audio exceeds the 30-minute import limit.")
            target_rate = 48000 if input_rate % 48000 == 0 else 44100
            resampler = av.AudioResampler(format="fltp", layout="mono" if channels == 1 else "stereo", rate=target_rate)
            with sf.SoundFile(partial, mode="x", samplerate=target_rate, channels=channels,
                              format="WAV", subtype="PCM_16") as writer:
                def write_frames(frames):
                    nonlocal count
                    for rendered in frames:
                        samples = rendered.to_ndarray().T
                        check(samples.ndim == 2 and samples.shape[1] == channels and np.isfinite(samples).all(),
                              "Decoded audio contains invalid or non-finite samples.")
                        count += len(samples)
                        check(count <= MAX_DURATION * target_rate, "Decoded audio exceeds the 30-minute import limit.")
                        writer.write(np.clip(samples, -1.0, 1.0))

                for frame in container.decode(stream):
                    check(len(frame.layout.channels) == channels and frame.sample_rate == input_rate,
                          "Changing channel counts or sample rates are not supported.")
                    check(np.isfinite(frame.to_ndarray()).all(), "Source audio contains non-finite samples.")
                    decoded_duration += Fraction(frame.samples, frame.sample_rate)
                    check(decoded_duration <= MAX_DURATION, "Decoded audio exceeds the 30-minute import limit.")
                    write_frames(resampler.resample(frame))
                    value = min(0.95, float(decoded_duration) / (declared_duration or MAX_DURATION) * 0.95)
                    if value - last_progress >= 0.01:
                        progress(value, "Decoding and normalizing audio")
                        last_progress = value
                write_frames(resampler.resample(None))
        check(count > 0, "No decodable audio samples were found.")
        peaks = []
        with sf.SoundFile(partial) as reader:
            block = max(1, math.ceil(reader.frames / 1600))
            for samples in reader.blocks(blocksize=block, dtype="float32", always_2d=True):
                peaks.append(float(np.max(np.abs(samples))))
        metadata = {"duration": count / target_rate, "sampleRate": target_rate, "channels": channels, "peaks": peaks}
        validate_metadata(metadata)
        check(not final.exists(), "The import destination changed during decoding.")
        partial.rename(final)
        progress(1, "Audio import complete")
        return metadata
    finally:
        partial.unlink(missing_ok=True)


def validate_metadata(value: dict) -> None:
    exact_keys(value, ("duration", "sampleRate", "channels", "peaks"), "audio metadata")
    check(number(value["duration"], 0, MAX_DURATION) and value["duration"] > 0, "Invalid decoded duration.")
    check(type(value["sampleRate"]) is int and 8000 <= value["sampleRate"] <= 192000, "Invalid sample rate.")
    check(type(value["channels"]) is int and value["channels"] in (1, 2), "Invalid channel count.")
    check(isinstance(value["peaks"], list) and 1 <= len(value["peaks"]) <= 1600
          and all(number(p, 0, 1) for p in value["peaks"]), "Invalid waveform peaks.")


def read_excerpt(source: Path, options: dict):
    import numpy as np
    import soundfile as sf

    check(source.name == "reference.wav", "Analysis requires the normalized managed reference.wav.")
    with sf.SoundFile(source) as reader:
        check(reader.format == "WAV" and reader.subtype == "PCM_16" and reader.channels in (1, 2)
              and reader.samplerate in (44100, 48000), "Reimport the source: the reference is not normalized PCM16 audio.")
        duration = reader.frames / reader.samplerate
        check(0 < duration <= MAX_DURATION, "The reference duration is invalid.")
        check(options["end"] <= duration, "The selected excerpt ends after the source audio.")
        first = round(options["start"] * reader.samplerate)
        last = round(options["end"] * reader.samplerate)
        check(last > first, "The selected excerpt is shorter than one sample.")
        reader.seek(first)
        audio = reader.read(last - first, dtype="float32", always_2d=True)
        check(len(audio) == last - first and np.isfinite(audio).all(), "The reference contains invalid audio.")
        return audio, reader.samplerate


def timed(start: float, end: float, text: str) -> dict:
    return {"start": float(start), "end": float(end), "text": text}


def musical_analysis(audio, sample_rate: int, options: dict) -> dict:
    import librosa
    import numpy as np

    start, end = options["start"], options["end"]
    mono = librosa.resample(audio.mean(axis=1), orig_sr=sample_rate, target_sr=22050)
    sr, hop = 22050, 1024
    result = {
        "tempo": None, "key": "Unknown (insufficient tonal evidence)", "chords": [], "sections": [],
        "descriptions": [], "lyrics": [], "beats": [], "energy": [], "stems": [], "midi": False,
        "warnings": ["Tempo, beats, key, chords, and section boundaries are signal-based estimates, not verified musical truth."],
        "provenance": [],
    }
    rms = librosa.feature.rms(y=mono, frame_length=2048, hop_length=hop)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    stride = max(1, math.ceil(len(rms) / 6000))
    result["energy"] = [
        {"time": float(start + times[i]), "rms": float(rms[i])}
        for i in range(0, len(rms), stride) if start + times[i] <= end
    ]
    if len(mono) < 2048 or float(np.max(rms, initial=0)) < 1e-5:
        result["warnings"].append("The excerpt is too short or too quiet for reliable musical estimates.")
        result["sections"] = [timed(start, end, "Section 1 (estimate; no reliable internal boundary)")]
        return result
    spectrum = np.abs(librosa.stft(mono, n_fft=4096, hop_length=hop))
    power = spectrum ** 2
    del spectrum
    mel = librosa.feature.melspectrogram(S=power, sr=sr, n_fft=4096, hop_length=hop)
    onset = librosa.onset.onset_strength(S=librosa.power_to_db(mel), sr=sr, hop_length=hop)
    if len(onset) > 4 and float(np.max(onset)) > 1e-5:
        tempo, frames = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop, trim=True)
        tempo_value = float(np.asarray(tempo).reshape(-1)[0])
        if 1 <= tempo_value <= 400 and len(frames) >= 2:
            result["tempo"] = tempo_value
            result["beats"] = [
                float(start + value) for value in librosa.frames_to_time(frames, sr=sr, hop_length=hop)
                if 0 <= value <= end - start
            ]
    chroma = librosa.feature.chroma_stft(S=power, sr=sr, n_fft=4096, hop_length=hop, tuning=0)
    del power, mel
    names = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    average = chroma.mean(axis=1)
    if float(np.std(average)) > 1e-6:
        scores = sorted(
            [(float(np.corrcoef(average, np.roll(profile, root))[0, 1]), names[root], quality)
             for quality, profile in (("major", major), ("minor", minor)) for root in range(12)],
            reverse=True,
        )
        if scores[0][0] >= 0.45 and scores[0][0] - scores[1][0] >= 0.015:
            result["key"] = f"{scores[0][1]} {scores[0][2]} (estimate)"
    templates, labels = [], []
    for root in range(12):
        for suffix, intervals in (("major", (0, 4, 7)), ("minor", (0, 3, 7))):
            template = np.zeros(12)
            template[[(root + interval) % 12 for interval in intervals]] = 1 / math.sqrt(3)
            templates.append(template)
            labels.append(f"{names[root]} {suffix} (estimate)")
    templates = np.asarray(templates)
    pooled, loudness, boundaries = [], [], []
    chroma_times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=hop)
    for offset in np.arange(0, end - start, 2.0):
        stop = min(float(offset + 2), end - start)
        indices = np.flatnonzero((chroma_times >= offset) & (chroma_times < stop))
        vector = chroma[:, indices].mean(axis=1) if len(indices) else np.zeros(12)
        norm = float(np.linalg.norm(vector))
        vector = vector / max(norm, 1e-12)
        begin_sample, end_sample = int(offset * sr), min(len(mono), math.ceil(stop * sr))
        level = float(np.sqrt(np.mean(mono[begin_sample:end_sample] ** 2))) if end_sample > begin_sample else 0
        ranking = np.argsort(templates @ vector)
        best, second = ranking[-1], ranking[-2]
        scores = templates @ vector
        label = "N / unclear (estimate)"
        if level < 1e-4:
            label = "N / silence (estimate)"
        elif scores[best] >= 0.65 and scores[best] - scores[second] >= 0.06:
            label = labels[best]
        a, b = start + float(offset), min(end, start + stop)
        if result["chords"] and result["chords"][-1]["text"] == label:
            result["chords"][-1]["end"] = b
        else:
            result["chords"].append(timed(a, b, label))
        pooled.append(vector)
        loudness.append(20 * math.log10(max(level, 1e-7)))
        boundaries.append(a)
    # Require both a substantial local change and at least 12 seconds on either side.
    candidates = []
    for i in range(2, len(pooled) - 2):
        left, right = np.mean(pooled[i - 2:i], axis=0), np.mean(pooled[i:i + 2], axis=0)
        similarity = float(np.dot(left, right) / max(np.linalg.norm(left) * np.linalg.norm(right), 1e-9))
        level_change = abs(float(np.mean(loudness[i - 2:i]) - np.mean(loudness[i:i + 2])))
        novelty = max(0.0, 1 - similarity) + min(level_change / 18, 1.0)
        if novelty >= 0.65 and (similarity < 0.7 or level_change >= 8):
            candidates.append((novelty, boundaries[i]))
    selected = [float(start), float(end)]
    for _, boundary in sorted(candidates, reverse=True):
        if all(abs(boundary - existing) >= 12 for existing in selected):
            selected.append(boundary)
    selected.sort()
    result["sections"] = [
        timed(a, b, f"Section {i + 1} (estimated boundary; no form label)")
        for i, (a, b) in enumerate(zip(selected, selected[1:]))
    ]
    return result


def read_manifest(models: Path, profile: str) -> tuple[Path, dict]:
    spec = PROFILES[profile]
    root = child_file(models, profile)
    if profile == native.PROFILE:
        return root, native.read_manifest(root)
    manifest_path = child_file(root, "manifest.json")
    check(manifest_path.is_file(), f"{profile}: model is not installed. Use Model Settings to install it explicitly.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    check(isinstance(manifest, dict) and manifest.get("profile") == profile
          and manifest.get("revision") == spec["revision"] and manifest.get("model") == spec["repo"],
          f"{profile}: the installed model revision is unsupported. Reinstall this profile.")
    files = manifest.get("files")
    check(isinstance(files, dict) and all(name in files for name in spec["required"]),
          f"{profile}: the model manifest is incomplete. Reinstall this profile.")
    for name, metadata in files.items():
        path = child_file(root, name)
        check(isinstance(metadata, dict) and type(metadata.get("size")) is int
              and isinstance(metadata.get("sha256"), str) and len(metadata["sha256"]) == 64
              and path.is_file() and path.stat().st_size == metadata["size"] and path.stat().st_size > 0,
              f"{profile}: a model file is missing or incomplete. Reinstall this profile.")
    if profile == "captions":
        index = json.loads(child_file(root, "model.safetensors.index.json").read_text(encoding="utf-8"))
        shards = set(index.get("weight_map", {}).values())
        check(shards and all(name.endswith(".safetensors") and name in files for name in shards),
              "captions: model weight shards are missing. Reinstall this profile.")
    return root, manifest


def import_profile(profile: str) -> None:
    check_versions(PROFILES[profile]["packages"])
    if profile == native.PROFILE:
        native.platform_check()
    elif profile == "stems":
        importlib.import_module("demucs.hf")
        importlib.import_module("demucs.apply")
    elif profile.startswith("lyrics-"):
        importlib.import_module("faster_whisper")
    elif profile == "notes":
        os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
        importlib.import_module("basic_pitch.inference")
    else:
        os.environ["USE_TF"] = "0"
        importlib.import_module("transformers.models.qwen2_audio.modeling_qwen2_audio")
        importlib.import_module("accelerate")


def load_stems(root: Path):
    from safetensors import safe_open
    from demucs.hf import load_safetensors_model
    path = child_file(root, "955717e8.safetensors")
    with safe_open(str(path), framework="pt", device="cpu") as handle:
        metadata = handle.metadata() or {}
        check(metadata.get("klass") == "demucs.htdemucs.HTDemucs" and "structure" not in metadata,
              "Unsupported Demucs checkpoint metadata.")
    model = load_safetensors_model(path).cpu().eval()
    check(set(model.sources) == set(STEMS) and model.samplerate == 44100 and model.audio_channels == 2,
          "The installed Demucs model does not provide the expected four stereo stems.")
    return model


def load_lyrics(root: Path):
    from faster_whisper import WhisperModel
    return WhisperModel(str(root), device="cpu", compute_type="int8", local_files_only=True,
                        cpu_threads=max(1, min(8, os.cpu_count() or 1)), num_workers=1)


def load_notes(root: Path):
    from basic_pitch.inference import Model
    return Model(child_file(root, "nmp.tflite"))


def check_caption_files(root: Path):
    from safetensors import safe_open
    from transformers import AutoConfig, AutoProcessor
    config = AutoConfig.from_pretrained(str(root), local_files_only=True, trust_remote_code=False)
    check(config.model_type == "qwen2_audio", "The installed caption model is not Qwen2-Audio.")
    processor = AutoProcessor.from_pretrained(str(root), local_files_only=True, trust_remote_code=False)
    index = json.loads((root / "model.safetensors.index.json").read_text(encoding="utf-8"))
    for name in set(index["weight_map"].values()):
        with safe_open(str(child_file(root, name)), framework="pt", device="cpu") as handle:
            check(bool(handle.keys()), "A caption model shard is empty.")
    return processor


def check_caption_memory() -> None:
    import psutil
    memory = psutil.virtual_memory()
    gib = 1024 ** 3
    check(memory.total >= 40 * gib and memory.available >= 35 * gib,
          "Qwen2-Audio CPU float32 needs approximately 40 GiB total RAM and at least 35 GiB currently available. "
          f"Detected {memory.total / gib:.1f} GiB total / {memory.available / gib:.1f} GiB available. "
          "Disable captions or use a machine with more available RAM; other analysis profiles can still be used.")


def diagnose(models: Path) -> dict:
    profiles = []
    try:
        check_core()
        profiles.append({"id": "core", "ready": True, "detail": "Pinned DSP packages and bundled PyAV decoder import successfully."})
    except Exception as error:
        profiles.append({"id": "core", "ready": False, "detail": safe_error(error)})
    for profile in PROFILES:
        try:
            root, _ = read_manifest(models, profile)
            import_profile(profile)
            if profile == native.PROFILE:
                profiles.append({"id": profile, "ready": True, "detail": "Pinned model sizes, native build identity and helper checksums verified. Each inference window separately requires 10 GiB available RAM; qualitative estimates need review."})
                continue
            elif profile == "captions":
                check_caption_memory()
                model = check_caption_files(root)
                detail = "Local files, shard headers, config, processor, and available RAM checked. Full CPU model loading is deferred; approximately 40 GiB RAM recommended."
            else:
                loader = load_stems if profile == "stems" else load_notes if profile == "notes" else load_lyrics
                model = loader(root)
                detail = "Pinned dependencies and local model loading checked on CPU; inference quality is not certified."
            del model
            gc.collect()
            profiles.append({"id": profile, "ready": True, "detail": detail})
        except Exception as error:
            profiles.append({"id": profile, "ready": False, "detail": safe_error(error)})
    return {"python": platform.python_version(), "profiles": profiles}


def run_stems(audio, sample_rate: int, root: Path, scratch: Path, selected: list[str], report) -> list[str]:
    import librosa
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model

    model = load_stems(root)
    waveform = librosa.resample(audio.T, orig_sr=sample_rate, target_sr=44100, axis=-1)
    if waveform.shape[0] == 1:
        waveform = np.repeat(waveform, 2, axis=0)
    mix = torch.from_numpy(np.ascontiguousarray(waveform))
    reference = mix.mean(0)
    mean, deviation = reference.mean(), reference.std().clamp_min(1e-8)
    normalized = (mix - mean) / deviation
    total = max(1, math.ceil(mix.shape[-1] / int(44100 * 7.8 * 0.75)))
    completed = 0

    def callback(event):
        nonlocal completed
        if event.get("state") == "end":
            completed += 1
            report(min(0.98, completed / total), "Separating selected stems (CPU)")

    with torch.inference_mode():
        estimates = apply_model(model, normalized[None], device="cpu", shifts=0, split=True,
                                overlap=0.25, segment=7.8, num_workers=0, progress=False, callback=callback)[0]
        estimates = estimates * deviation + mean
    warnings = []
    for stem in selected:
        samples = estimates[model.sources.index(stem)].cpu().numpy().T
        check(samples.shape == (len(waveform[0]), 2) and np.isfinite(samples).all(),
              "Demucs produced invalid audio; no stems were published.")
        peak = float(np.max(np.abs(samples), initial=0))
        if peak > 1:
            samples = samples / peak * 0.999
            warnings.append(f"{stem}: peak-normalized to avoid PCM16 clipping (gain {0.999 / peak:.6f}).")
        sf.write(scratch / f"{stem}.wav", samples, 44100, subtype="PCM_16")
    return warnings


def collect_lyrics(segments, options: dict, report) -> tuple[list[dict], list[str], dict]:
    output = []
    duration = options["end"] - options["start"]
    tolerance = 0.04  # Two Whisper timestamp ticks; larger overruns are not rounding.
    adjustments = []
    zero_duration = 0

    def interval(entry, segment_index, word_index):
        raw = []
        for value in (entry.start, entry.end):
            check(isinstance(value, Real) and not isinstance(value, bool) and math.isfinite(value),
                  "Whisper produced a non-finite or nonnumeric timestamp; no lyric result was published.")
            # faster-whisper word alignment returns NumPy real scalars, not always Python floats.
            raw.append(float(value))
        check(raw[1] >= raw[0], "Whisper produced reversed timestamps; no lyric result was published.")
        check(-tolerance <= raw[0] <= duration + tolerance and -tolerance <= raw[1] <= duration + tolerance,
              "Whisper timestamps exceed the excerpt by more than 40 ms. Choose a shorter excerpt or another lyric profile; no result was published.")
        normalized = [min(duration, max(0.0, value)) for value in raw]
        if raw != normalized:
            adjustments.append({"segment": segment_index, "word": word_index, "raw": raw, "normalized": normalized})
            check(len(adjustments) <= 16,
                  "Whisper produced too many out-of-bounds timestamps to preserve their evidence. Choose a shorter excerpt; no result was published.")
        return normalized

    for segment_index, segment in enumerate(segments):
        segment_interval = interval(segment, segment_index, None)
        words = segment.words if options["wordTimestamps"] and segment.words else None
        entries = words or [segment]
        for word_index, entry in enumerate(entries):
            text = (getattr(entry, "word", None) if hasattr(entry, "word") else entry.text).strip()
            begin, end = interval(entry, segment_index, word_index) if words else segment_interval
            if text:
                check(len(text) <= 20000, "Whisper produced an oversized lyric segment.")
                output.append(timed(min(options["end"], options["start"] + begin),
                                    min(options["end"], options["start"] + end), text))
                check(len(output) <= 5000, "Too many lyric timestamps; choose a shorter excerpt or disable word timestamps.")
                zero_duration += end == begin
        report(min(0.99, segment_interval[1] / duration), "Transcribing audio (CPU int8; lyrics may be inaccurate)")
    warnings = []
    if adjustments:
        warnings.append(f"Normalized {len(adjustments)} Whisper boundary timestamps within 40 ms of the excerpt. Original and normalized excerpt-relative times are retained in provenance; this is not proof of correct alignment.")
    if zero_duration:
        warnings.append(f"Whisper produced {zero_duration} zero-duration lyric entries. Their text and timestamps were preserved, but alignment is uncertain.")
    evidence = {
        "timestampScalarConversion": "finite real scalars converted to Python float without changing numeric values",
        "timestampBoundaryToleranceSeconds": tolerance,
        "timestampAdjustmentBasis": "excerpt-relative model seconds; exported lyric entries use absolute source seconds",
        "timestampAdjustments": adjustments,
        "zeroDurationEntries": zero_duration,
    }
    return output, warnings, evidence


def run_lyrics(audio, sample_rate: int, root: Path, options: dict, report) -> tuple[list[dict], list[str], dict]:
    import librosa
    import numpy as np
    model = load_lyrics(root)
    mono = librosa.resample(audio.mean(axis=1), orig_sr=sample_rate, target_sr=16000)
    segments, _ = model.transcribe(np.ascontiguousarray(mono), beam_size=5, temperature=0,
                                   word_timestamps=options["wordTimestamps"], vad_filter=False,
                                   condition_on_previous_text=False)
    return collect_lyrics(segments, options, report)


def prepare_lyric_input(audio, sample_rate: int, scratch: Path, options: dict):
    import numpy as np
    import soundfile as sf

    evidence = {
        "kind": "full-mix", "file": "reference.wav", "sampleRate": sample_rate,
        "channels": audio.shape[1], "sourceOffsetSeconds": options["start"],
        "durationSeconds": len(audio) / sample_rate,
    }
    if "vocals" not in options["stems"]:
        return audio, sample_rate, evidence
    path = child_file(scratch, "vocals.wav")
    check(path.is_file(), "The selected vocals stem is missing. Lyrics will not fall back to the full mix.")
    try:
        with sf.SoundFile(path) as reader:
            check(reader.format == "WAV" and reader.subtype == "PCM_16" and reader.channels in (1, 2)
                  and 8000 <= reader.samplerate <= 192000 and reader.frames > 0,
                  "The generated vocals stem is not valid PCM16 audio. Lyrics will not fall back to the full mix.")
            vocal_rate = reader.samplerate
            vocal_duration = reader.frames / vocal_rate
            check(abs(vocal_duration - len(audio) / sample_rate) <= 2 / vocal_rate + 1 / sample_rate,
                  "The generated vocals stem duration does not match the excerpt. Lyrics will not fall back to the full mix.")
            vocals = reader.read(dtype="float32", always_2d=True)
            check(len(vocals) == reader.frames and np.isfinite(vocals).all(),
                  "The generated vocals stem contains invalid samples. Lyrics will not fall back to the full mix.")
    except (sf.LibsndfileError, OSError):
        raise WorkerError("The generated vocals stem could not be decoded. Lyrics will not fall back to the full mix.") from None
    with path.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    evidence.update({
        "kind": "separated-vocals", "file": "vocals.wav", "sampleRate": vocal_rate,
        "channels": vocals.shape[1], "durationSeconds": vocal_duration, "sha256": digest,
        "separationModel": PROFILES["stems"]["repo"], "separationRevision": PROFILES["stems"]["revision"],
    })
    return vocals, vocal_rate, evidence


def normalize_note_timings(midi, duration: float) -> tuple[list[str], dict]:
    tolerance = 2 * 256 / 22050  # Two Basic Pitch analysis frames.
    adjustments = []
    note_count = 0

    def seconds(value):
        check(isinstance(value, Real) and not isinstance(value, bool) and math.isfinite(value),
              "Basic Pitch produced a non-finite or nonnumeric timestamp; no MIDI was published.")
        value = float(value)
        check(-tolerance <= value <= duration + tolerance,
              "Basic Pitch timestamps exceed the excerpt by more than two analysis frames (23.22 ms). Choose a shorter excerpt; no MIDI was published.")
        return value

    def record(kind, instrument_index, event_index, raw, normalized, **extra):
        if raw != normalized:
            adjustments.append({"kind": kind, "instrument": instrument_index, "event": event_index,
                                "raw": raw, "normalized": normalized, **extra})
            check(len(adjustments) <= 12,
                  "Basic Pitch produced too many boundary corrections to preserve their evidence. Choose a shorter excerpt; no MIDI was published.")

    def normalize_time(value):
        value = min(duration, max(0.0, value))
        # MIDI stores ticks. Rounding an arbitrary excerpt endpoint upward must
        # not place its final event outside the audio when the MIDI is read back.
        tick = midi.time_to_tick(value)
        if midi.tick_to_time(tick) > duration:
            value = float(midi.tick_to_time(max(0, tick - 1)))
        return value

    for instrument_index, instrument in enumerate(midi.instruments):
        for event_index, note in enumerate(instrument.notes):
            raw = [seconds(note.start), seconds(note.end)]
            check(raw[1] > raw[0], "Basic Pitch produced reversed or zero-duration notes; no MIDI was published.")
            normalized = [normalize_time(value) for value in raw]
            check(normalized[1] > normalized[0],
                  "A Basic Pitch note has no duration inside the excerpt; no MIDI was published.")
            record("note", instrument_index, event_index, raw, normalized,
                   pitch=int(note.pitch), velocity=int(note.velocity))
            note.start, note.end = normalized
            note_count += 1
        for kind, events in (("pitch-bend", instrument.pitch_bends), ("control", instrument.control_changes)):
            for event_index, event in enumerate(events):
                raw = seconds(event.time)
                normalized = normalize_time(raw)
                record(kind, instrument_index, event_index, [raw], [normalized])
                event.time = normalized
    warnings = []
    if adjustments:
        warnings.append(f"Normalized {len(adjustments)} Basic Pitch boundary events within two analysis frames (23.22 ms), including MIDI endpoint tick rounding where needed. Original and normalized excerpt-relative events are retained in provenance.")
    return warnings, {
        "timestampScalarConversion": "finite real scalars converted to Python float without changing numeric values",
        "timestampBoundaryToleranceSeconds": tolerance,
        "timestampAdjustmentBasis": "excerpt-relative model seconds",
        "timestampAdjustments": adjustments,
        "predictedNoteCount": note_count,
        "midiResolutionTicksPerQuarter": int(midi.resolution),
    }


def run_notes(audio, sample_rate: int, root: Path, scratch: Path, options: dict) -> tuple[list[str], dict]:
    import numpy as np
    import pretty_midi
    import soundfile as sf
    from basic_pitch.inference import predict

    excerpt = scratch / ".notes-input.wav"
    sf.write(excerpt, audio, sample_rate, subtype="PCM_16")
    try:
        output, midi, _ = predict(excerpt, model_or_model_path=load_notes(root))
        check(all(np.isfinite(value).all() for value in output.values()), "Basic Pitch returned non-finite predictions.")
        duration = options["end"] - options["start"]
        warnings, evidence = normalize_note_timings(midi, duration)
        destination = scratch / "notes.mid"
        midi.write(str(destination))
        check(destination.read_bytes()[:4] == b"MThd", "Basic Pitch did not create a valid MIDI file.")
        verified = pretty_midi.PrettyMIDI(str(destination))
        notes = [note for instrument in verified.instruments for note in instrument.notes]
        check(len(notes) == evidence["predictedNoteCount"],
              "MIDI serialization changed the predicted note count; no MIDI was published.")
        note_bounds = [(float(note.start), float(note.end)) for note in notes]
        check(all(number(start, 0, duration) and number(end, start, duration)
                  and end > start for start, end in note_bounds), "Serialized MIDI note timestamps are invalid.")
        for instrument in verified.instruments:
            check(all(number(float(event.time), 0, duration) for event in instrument.pitch_bends + instrument.control_changes),
                  "Serialized MIDI control timestamps are invalid.")
        evidence.update({"serializedNoteCount": len(notes), "serializedNoteBounds": [
            min((start for start, _ in note_bounds), default=0.0),
            max((end for _, end in note_bounds), default=0.0),
        ]})
        return warnings, evidence
    finally:
        excerpt.unlink(missing_ok=True)


def run_captions(audio, sample_rate: int, root: Path, options: dict, report) -> list[dict]:
    import librosa
    import torch
    from transformers import Qwen2AudioForConditionalGeneration

    check_caption_memory()
    processor = check_caption_files(root)
    model = Qwen2AudioForConditionalGeneration.from_pretrained(
        str(root), local_files_only=True, trust_remote_code=False, use_safetensors=True,
        torch_dtype=torch.float32, low_cpu_mem_usage=True, device_map="cpu",
        attn_implementation="eager",
    ).eval()
    prompt = [
        {"role": "system", "content": "Describe audible evidence only. Do not invent instruments, lyrics, genres, or context you cannot hear."},
        {"role": "user", "content": [
            {"type": "audio", "audio_url": "local-audio"},
            {"type": "text", "text": "Briefly describe this audio's audible instruments or sound sources, texture, and changes. State uncertainty. Do not transcribe lyrics."},
        ]},
    ]
    text = processor.apply_chat_template(prompt, add_generation_prompt=True, tokenize=False)
    rate = processor.feature_extractor.sampling_rate
    duration = options["end"] - options["start"]
    output = []
    for offset in range(0, math.ceil(duration), 30):
        stop = min(offset + 30, duration)
        waveform = audio[round(offset * sample_rate):round(stop * sample_rate)].mean(axis=1)
        waveform = librosa.resample(waveform, orig_sr=sample_rate, target_sr=rate)
        inputs = processor(text=text, audio=[waveform], sampling_rate=rate, return_tensors="pt", padding=True)
        check("input_features" in inputs and inputs["input_features"].numel() > 0,
              "The caption processor did not receive audio features.")
        with torch.inference_mode():
            generated = model.generate(**inputs, max_new_tokens=192, do_sample=False)
        tokens = generated[:, inputs["input_ids"].shape[1]:]
        caption = processor.batch_decode(tokens, skip_special_tokens=True, clean_up_tokenization_spaces=False)[0].strip()
        check(bool(caption) and len(caption) <= 20000, "Qwen2-Audio returned an empty or oversized caption.")
        output.append(timed(options["start"] + offset, min(options["end"], options["start"] + stop), caption))
        report(stop / duration, "Describing audio-backed windows (CPU; estimates)")
    return output


def stage_provenance(stage: str, profile: str | None, seconds: float, options: dict, details: dict) -> dict:
    spec = PROFILES[profile] if profile else None
    return {
        "stage": stage, "model": spec["repo"] if spec else "librosa DSP; not a generative model",
        "revision": spec["revision"] if spec else "librosa-0.10.2.post1;analysis-v1",
        "seconds": seconds,
        "details": json.dumps({"options": options, **details}, ensure_ascii=True, separators=(",", ":")),
    }


def analyze(source: Path, output: Path, models: Path, options: dict, *, defer_native=False) -> dict:
    options = validate_options(options)
    native_selected = options["captions"] and options["captionModel"] == native.PROFILE
    check(not native_selected or defer_native, "Native captions require the managed phased analysis job; no caption was silently skipped.")
    check(not native_selected or options["end"] - options["start"] >= 1, "Native captions require an excerpt of at least one second.")
    selected = []
    if options["stems"]:
        selected.append("stems")
    if options["lyrics"] != "none":
        selected.append("lyrics-" + options["lyrics"])
    if options["notes"]:
        selected.append("notes")
    if options["captions"]:
        selected.append(options["captionModel"])
    progress(0, "Checking all selected local model profiles")
    roots = {}
    for profile in selected:
        root, _ = read_manifest(models, profile)
        import_profile(profile)
        if profile == "captions":
            check_caption_memory()
        roots[profile] = root
    selected = [profile for profile in selected if profile != native.PROFILE]
    # No outputs or expensive DSP are started until every selected profile exists.
    audio, sample_rate = read_excerpt(source, options)
    names = [f"{stem}.wav" for stem in options["stems"]] + (["notes.mid"] if options["notes"] else [])
    check(all(not (output / name).exists() for name in names), "The job already contains generated outputs.")
    scratch = output / f".analysis-{uuid.uuid4().hex}"
    scratch.mkdir()
    published = []
    try:
        total_stages = 1 + len(selected)
        progress(0.03, "Estimating tempo, beats, energy, key, chords, and boundaries")
        before = time.perf_counter()
        result = musical_analysis(audio, sample_rate, options)
        result["provenance"].append(stage_provenance("musical-analysis", None, time.perf_counter() - before, options, {
            "sampleRate": 22050, "fft": 4096, "hop": 1024, "chordWindowSeconds": 2,
            "keyMethod": "Krumhansl-Schmuckler profile correlation",
            "sections": "conservative chroma/energy changes; minimum 12-second spacing",
            "timestamps": "absolute source seconds",
        }))
        for i, profile in enumerate(selected, 1):
            report = lambda fraction, label, i=i: progress(0.03 + 0.92 * (i + fraction) / total_stages, label)
            report(0, f"Loading {profile} from local managed files")
            before = time.perf_counter()
            details = {"device": "cpu", "timestamps": "absolute source seconds"}
            if profile == "stems":
                result["warnings"].extend(run_stems(audio, sample_rate, roots[profile], scratch, options["stems"], report))
                result["stems"] = list(options["stems"])
                details.update({"shifts": 0, "overlap": 0.25, "segment": 7.8, "sampleRate": 44100,
                                "stemAudioOffsetSeconds": options["start"], "format": "PCM16 stereo"})
                result["warnings"].append("Separated stems are estimates with possible bleed and artifacts; stem files contain only the selected excerpt.")
            elif profile.startswith("lyrics-"):
                lyric_audio, lyric_rate, input_evidence = prepare_lyric_input(audio, sample_rate, scratch, options)
                lyrics, lyric_warnings, timestamp_evidence = run_lyrics(
                    lyric_audio, lyric_rate, roots[profile], options, report)
                result["lyrics"] = lyrics
                result["warnings"].extend(lyric_warnings)
                details.update({"computeType": "int8", "beamSize": 5, "vadFilter": False,
                                "conditionOnPreviousText": False, "wordTimestamps": options["wordTimestamps"],
                                "inputAudio": input_evidence})
                details.update(timestamp_evidence)
                if input_evidence["kind"] == "separated-vocals":
                    result["warnings"].append("Lyric input: generated vocals stem. Separation artifacts can affect transcription.")
                else:
                    result["warnings"].append("Lyric input: full mix; no vocals stem was selected. Accompaniment can affect transcription.")
                result["warnings"].append("Whisper is a speech model: sung lyrics can be incomplete, incorrect, or hallucinated. Word timings do not prove correctness.")
                del lyric_audio
            elif profile == "notes":
                note_warnings, timestamp_evidence = run_notes(audio, sample_rate, roots[profile], scratch, options)
                result["warnings"].extend(note_warnings)
                result["midi"] = True
                details.update({"runtime": "TensorFlow Lite", "onsetThreshold": 0.5, "frameThreshold": 0.3,
                                "minimumNoteLengthMs": 127.7, "midiTempo": 120,
                                "timestamps": "excerpt-relative MIDI seconds; source offset recorded",
                                "midiTimeline": "excerpt-relative seconds; no fabricated notes",
                                "midiSourceOffsetSeconds": options["start"]})
                details.update(timestamp_evidence)
                result["warnings"].append("Basic Pitch MIDI is an imperfect polyphonic pitch estimate, not a score or verified transcription; silence may yield an empty MIDI.")
            else:
                result["descriptions"] = run_captions(audio, sample_rate, roots[profile], options, report)
                details.update({"dtype": "float32", "maximumAudioWindowSeconds": 30, "maxNewTokens": 192,
                                "doSample": False, "audioBacked": True})
                result["warnings"].append("Qwen2-Audio captions are audio-backed model estimates and may misidentify sounds. CPU inference requires substantial RAM and time.")
            result["provenance"].append(stage_provenance(profile, profile, time.perf_counter() - before, options, details))
            gc.collect()
        validate_result(result, options)
        for name in names:
            check((scratch / name).is_file() and (scratch / name).stat().st_size > 0, "A selected output was not produced.")
        progress(0.98, "Validating selected outputs")
        for name in names:
            check(not (output / name).exists(), "The job destination changed during analysis.")
            (scratch / name).rename(output / name)
            published.append(output / name)
        progress(1, "Audio analysis finished; native descriptions pending" if native_selected else "Analysis complete; estimates ready for review")
        return result
    except BaseException:
        for path in published:
            path.unlink(missing_ok=True)
        raise
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def validate_result(value: dict, options: dict) -> None:
    exact_keys(value, ("tempo", "key", "chords", "sections", "descriptions", "lyrics", "beats",
                       "energy", "stems", "midi", "warnings", "provenance"), "analysis result")
    check(value["tempo"] is None or number(value["tempo"], 1, 400), "Invalid estimated tempo.")
    check(isinstance(value["key"], str) and len(value["key"]) <= 120, "Invalid estimated key.")
    start, end = options["start"], options["end"]
    for field in ("chords", "sections", "descriptions", "lyrics"):
        rows = value[field]
        check(isinstance(rows, list) and len(rows) <= (5000 if field == "lyrics" else 2000), f"Too many {field} entries.")
        for row in rows:
            exact_keys(row, ("start", "end", "text"), field)
            check(number(row["start"], start, end) and number(row["end"], row["start"], end)
                  and isinstance(row["text"], str) and len(row["text"]) <= 20000, f"Invalid timed {field}.")
    check(isinstance(value["beats"], list) and len(value["beats"]) <= 20000
          and all(number(beat, start, end) for beat in value["beats"]), "Invalid beat timestamps.")
    check(isinstance(value["energy"], list) and len(value["energy"]) <= 6000, "Invalid energy envelope.")
    for row in value["energy"]:
        exact_keys(row, ("time", "rms"), "energy")
        check(number(row["time"], start, end) and number(row["rms"], 0, 10), "Invalid RMS measurement.")
    check(value["stems"] == options["stems"] and type(value["midi"]) is bool and value["midi"] == options["notes"],
          "The output selection does not match the request.")
    check(isinstance(value["warnings"], list) and len(value["warnings"]) <= 100
          and all(isinstance(item, str) and len(item) <= 2000 for item in value["warnings"]), "Invalid warnings.")
    check(isinstance(value["provenance"], list) and len(value["provenance"]) <= 30, "Invalid provenance.")
    for row in value["provenance"]:
        exact_keys(row, ("stage", "model", "revision", "seconds", "details"), "provenance")
        for field, limit in (("stage", 80), ("model", 200), ("revision", 200), ("details", 4000)):
            check(isinstance(row[field], str) and len(row[field]) <= limit, "Invalid stage provenance.")
        check(number(row["seconds"], 0, float("inf")), "Invalid processing duration.")
    json.dumps(value, allow_nan=False)


def download_file(url: str, destination: Path, expected_size: int, expected_hash: str, hash_kind: str, report) -> dict:
    import urllib.request

    check(url.startswith("https://"), "Model acquisition requires HTTPS.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    sha256 = hashlib.sha256()
    upstream = hashlib.sha256() if hash_kind == "sha256" else hashlib.sha1()
    if hash_kind == "git":
        upstream.update(f"blob {expected_size}\0".encode("ascii"))
    count = 0
    previous = 0.0
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "SoundStudio-local-analysis/1"}), timeout=90) as response:
        check(response.geturl().startswith("https://"), "The model download redirected to a non-HTTPS location.")
        with destination.open("xb") as writer:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                count += len(block)
                check(count <= expected_size, "Model download exceeded its pinned size.")
                writer.write(block)
                sha256.update(block)
                upstream.update(block)
                fraction = count / expected_size
                if fraction - previous >= 0.005:
                    report(fraction)
                    previous = fraction
    check(count == expected_size and upstream.hexdigest() == expected_hash,
          "Model download integrity check failed. No model was installed.")
    return {"size": count, "sha256": sha256.hexdigest()}


def acquire(profile: str, models: Path) -> dict:
    check(profile in PROFILES, "Choose an optional model profile; the core profile needs only its pinned Python dependencies.")
    if profile == native.PROFILE:
        return native.acquire(models, download_file, progress)
    check_versions(PROFILES[profile]["packages"])
    spec = PROFILES[profile]
    destination = child_file(models, profile)
    if (destination / "manifest.json").is_file():
        try:
            _, manifest = read_manifest(models, profile)
            for name, metadata in manifest["files"].items():
                with child_file(destination, name).open("rb") as handle:
                    check(hashlib.file_digest(handle, "sha256").hexdigest() == metadata["sha256"],
                          "An installed model file failed its integrity check; reacquiring this profile.")
            return {"profile": profile, "ready": True, "model": spec["repo"], "revision": spec["revision"],
                    "license": spec["license"], "licenseUrl": spec["licenseUrl"]}
        except (WorkerError, ValueError, OSError):
            pass
    staging = models / f".acquire-{profile}-{uuid.uuid4().hex}"
    staging.mkdir()
    backup = models / f".previous-{profile}-{uuid.uuid4().hex}"
    progress(0, f"Acquiring {profile}; explicit download authorized")
    try:
        files = {}
        if profile == "notes":
            revision = spec["revision"]
            sources = [
                ("nmp.tflite", "basic_pitch/saved_models/icassp_2022/nmp.tflite", 204448, "85a41befdd036e9b365a052b7c704c6810288b95"),
                ("LICENSE", "LICENSE", 11384, "dc22a7345838b69ab77a02ff021584383b52d0e8"),
            ]
            total = sum(item[2] for item in sources)
            downloaded = 0
            for name, remote, size, blob in sources:
                files[name] = download_file(
                    f"https://raw.githubusercontent.com/spotify/basic-pitch/{revision}/{remote}",
                    child_file(staging, name), size, blob, "git",
                    lambda fraction, downloaded=downloaded, size=size: progress(
                        0.02 + 0.94 * (downloaded + fraction * size) / total, "Downloading pinned Basic Pitch model"),
                )
                downloaded += size
        else:
            from huggingface_hub import HfApi
            from urllib.parse import quote

            info = HfApi().model_info(spec["repo"], revision=spec["revision"], files_metadata=True)
            check(info.sha == spec["revision"], "The model registry did not return the pinned revision.")
            selected = []
            for item in info.siblings:
                name = item.rfilename
                allowed = (
                    name in spec["required"] or name in ("README.md", "LICENSE", "LICENSE.txt")
                    or (profile == "captions" and (name.endswith(".safetensors") or name in (
                        "generation_config.json", "merges.txt", "vocab.json", "added_tokens.json",
                        "special_tokens_map.json", "chat_template.json", "chat_template.jinja")))
                )
                if allowed:
                    check(type(item.size) is int and item.size > 0, "Model registry omitted a required file size.")
                    selected.append(item)
            check(all(name in [item.rfilename for item in selected] for name in spec["required"]),
                  "Pinned model files are missing from the registry.")
            total = sum(item.size for item in selected)
            downloaded = 0
            for item in selected:
                lfs_hash = getattr(item.lfs, "sha256", None) if item.lfs else None
                expected_hash = lfs_hash or item.blob_id
                check(isinstance(expected_hash, str) and len(expected_hash) in (40, 64),
                      "The model registry omitted a content hash.")
                files[item.rfilename] = download_file(
                    f"https://huggingface.co/{spec['repo']}/resolve/{spec['revision']}/{quote(item.rfilename)}?download=true",
                    child_file(staging, item.rfilename), item.size, expected_hash, "sha256" if lfs_hash else "git",
                    lambda fraction, downloaded=downloaded, size=item.size, name=item.rfilename: progress(
                        0.02 + 0.94 * (downloaded + fraction * size) / total, f"Downloading {profile}: {name}"),
                )
                downloaded += item.size
        manifest = {
            "profile": profile, "model": spec["repo"], "revision": spec["revision"],
            "license": spec["license"], "licenseUrl": spec["licenseUrl"], "files": files,
        }
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        if destination.exists():
            destination.rename(backup)
        try:
            staging.rename(destination)
        except BaseException:
            if backup.exists():
                backup.rename(destination)
            raise
        if backup.exists():
            shutil.rmtree(backup)
        progress(1, f"{profile} downloaded and content hashes verified")
        return {"profile": profile, "ready": True, "model": spec["repo"], "revision": spec["revision"],
                "license": spec["license"], "licenseUrl": spec["licenseUrl"]}
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def safe_error(error: Exception) -> str:
    import urllib.error
    if isinstance(error, (WorkerError, native.NativeCaptionError)):
        return str(error)[:2000]
    if isinstance(error, json.JSONDecodeError):
        return "Send exactly one valid JSON request, then close stdin."
    if isinstance(error, urllib.error.URLError):
        return "The model download failed. Check the Internet connection and trusted TLS certificates, then retry explicit installation."
    if isinstance(error, ImportError):
        module = getattr(error, "name", None)
        if isinstance(module, str) and 0 < len(module) <= 160 and all(c.isalnum() or c in "._" for c in module):
            if module == "pkg_resources":
                return "Missing Python module 'pkg_resources'. Reinstall the profile with setuptools==75.8.2; newer setuptools releases removed this legacy dependency."
            return f"Python module '{module}' could not be loaded. Reinstall the pinned profile dependencies and check the Windows x64 runtime."
        return "A Python dependency could not be imported. Reinstall the pinned profile dependencies and check the Windows x64 runtime."
    cause = error.__cause__ or error.__context__
    if isinstance(cause, ImportError):
        return safe_error(cause)
    if isinstance(error, MemoryError):
        return "Insufficient memory. Select a shorter excerpt or disable the large caption model."
    if isinstance(error, OSError):
        return "A local file, decoder, model, or download could not be opened. Check disk space, permissions, model installation, and supported audio format."
    return f"{type(error).__name__}: analysis failed. Reinstall the selected profile or try a shorter supported audio excerpt. No partial result was published."


def dispatch(request: dict) -> dict:
    check(isinstance(request, dict), "The request must be a JSON object.")
    command = request.get("command")
    fields = {
        "import": ("command", "source", "output"),
        "analyze": ("command", "source", "output", "models", "options"),
        "analyze-base": ("command", "source", "output", "models", "options"),
        "native-describe": ("command", "source", "output", "models", "options"),
        "native-prepare": ("command", "source", "output", "models", "options"),
        "diagnose": ("command", "models"),
        "acquire": ("command", "profile", "models"),
    }
    check(isinstance(command, str) and command in fields, "Unknown worker command.")
    exact_keys(request, fields[command], "worker request")
    if command == "acquire":
        models = local_path(request["models"], directory=True, create=True)
        return acquire(request["profile"], models)
    with offline():
        if command == "diagnose":
            return diagnose(local_path(request["models"], directory=True, create=True))
        source = local_path(request["source"])
        output = local_path(request["output"], directory=True, create=True)
        if command == "native-describe":
            options = validate_options(request["options"])
            check(options["captions"] and options["captionModel"] == native.PROFILE, "Native descriptions were not selected.")
            return native.describe(source, output, local_path(request["models"], directory=True), options, Path(__file__), progress)
        check_core()
        if command == "import":
            return import_audio(source, output)
        if command == "native-prepare":
            return native.prepare(source, output, validate_options(request["options"]), read_excerpt)
        return analyze(source, output, local_path(request["models"], directory=True, create=True),
                       request["options"], defer_native=command == "analyze-base")


def main() -> int:
    global _protocol
    # Reserve stdout exclusively for our JSON, including when native libraries print.
    sys.stdout.flush()
    _protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    sys.stdout = sys.stderr
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    os.environ.setdefault("OMP_NUM_THREADS", str(max(1, min(8, os.cpu_count() or 1))))
    os.environ.setdefault("NUMBA_NUM_THREADS", str(max(1, min(8, os.cpu_count() or 1))))
    try:
        raw = sys.stdin.buffer.read(65537)
        check(len(raw) <= 65536, "The worker request exceeds 64 KiB.")
        def reject_nonfinite(value):
            raise WorkerError("JSON request numbers must be finite.")
        request = json.loads(raw.decode("utf-8-sig"), parse_constant=reject_nonfinite)
        value = dispatch(request)
        emit({"type": "result", "value": value})
        return 0
    except Exception as error:
        print(safe_error(error), file=sys.stderr, flush=True)
        return 1
    finally:
        _protocol.close()


if __name__ == "__main__":
    raise SystemExit(main())
