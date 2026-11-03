"""Explicitly acquired, offline, per-job Qwen2.5-Omni caption helper."""

import ctypes
import ctypes.wintypes as wt
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import time
import uuid
import zipfile


PROFILE = "captions-native"
MODEL = "ggml-org/Qwen2.5-Omni-7B-GGUF"
REVISION = "89b785438c8901d4635e42f50480ba5985a1bbf1"
SOURCE_COMMIT = "51fe42c5d14bfb9adf0612ff98a9ab79e0e7275c"
SOURCE_SIZE = 41290283
SOURCE_SHA256 = "4b7a6f19235646812e15776dcef24845a1299d7f73447b5ea5a572333fe0df97"
PATCH_SHA256 = "ce66e710c6df5c356caa93e918e91986a781e8c73da707204b2ffe6a33ea8ac3"
UPSTREAM_REVISION = "ae9e1690543ffd5c0221dc27f79834d0294cba00"
LICENSE_URL = f"https://huggingface.co/Qwen/Qwen2.5-Omni-7B/blob/{UPSTREAM_REVISION}/LICENSE"
MODEL_FILES = {
    "Qwen2.5-Omni-7B-Q4_K_M.gguf": (
        4683072384, "09883dff531dc56923a041c9c99c7c779e26ffde32caa83adeeb7502ec3b50fe"
    ),
    "mmproj-Qwen2.5-Omni-7B-Q8_0.gguf": (
        1548488480, "4a7bc5478a2ec8c5d186d63532eb22e75b79ba75ec3c0ce821676157318ef4ad"
    ),
}
BINARY_FILES = (
    "llama-mtmd-cli.exe", "ggml-base.dll", "ggml-cpu.dll", "ggml.dll",
    "llama-common.dll", "llama.dll", "mtmd.dll",
)
NOTICE_FILES = ("Qwen-LICENSE.txt", "GGUF-model-card.txt", "llama-LICENSE.txt", "source.patch")
PROFILE_SPEC = {
    "repo": MODEL, "revision": REVISION, "license": "Upstream 7B Apache-2.0; GGUF metadata says qwen-research",
    "licenseUrl": LICENSE_URL, "required": list(MODEL_FILES), "packages": {},
}
PROMPT = (
    "Listen to the provided recording. Write four short qualitative observations. "
    "Sound sources: identify audible voices or instruments and their roles, stating uncertainty. "
    "Performance: describe how the sounds are produced and their audible timbre. "
    "Pulse and energy: describe the pacing, feel and dynamics in ordinary words. "
    "Development: describe changes actually heard within this recording, or say it remains similar. "
    "Describe only what the audio supports; mark unclear aspects as uncertain."
)
GIB = 1024 ** 3
MAX_TOKENS = 256
CONTEXT = 2048
TIMEOUT = 300


class NativeCaptionError(Exception):
    """Actionable managed-runtime error without exposing private paths."""


def ensure(condition, message):
    if not condition:
        raise NativeCaptionError(message)


def digest(path: Path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def regular(path: Path):
    info = path.lstat()
    ensure(stat.S_ISREG(info.st_mode) and not getattr(info, "st_file_attributes", 0) & 0x400,
           "A managed caption file is not a regular file. Repair this profile.")
    return info


def platform_check():
    ensure(os.name == "nt" and ctypes.sizeof(ctypes.c_void_p) == 8,
           "Managed native captions require Windows x64, including supported ARM64 x64 emulation.")
    ensure(ctypes.windll.kernel32.IsProcessorFeaturePresent(40),
           "This caption build requires AVX2 support reported by Windows. No unsupported helper was started.")


def read_manifest(root: Path, verify_models=False):
    platform_check()
    ensure(root.is_dir() and (root / "bin").is_dir(),
           "Native caption model is not installed. Use Model Settings to install it explicitly.")
    for directory in (root, root / "bin"):
        info = directory.lstat()
        ensure(stat.S_ISDIR(info.st_mode) and not getattr(info, "st_file_attributes", 0) & 0x400,
               "The managed caption directory is missing or is a link. Repair this profile.")
    path = root / "manifest.json"
    ensure(regular(path).st_size <= 65536, "The native caption manifest is oversized. Repair this profile.")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    ensure(isinstance(manifest, dict) and manifest.get("version") == 1
           and manifest.get("profile") == PROFILE and manifest.get("model") == MODEL
           and manifest.get("revision") == REVISION, "Native caption model is missing or has an unsupported revision.")
    build = manifest.get("build", {})
    ensure(isinstance(build, dict) and build.get("sourceCommit") == SOURCE_COMMIT
           and build.get("sourceArchiveSha256") == SOURCE_SHA256 and build.get("patchSha256") == PATCH_SHA256
           and build.get("target") == "windows-x64-avx2",
           "The native helper was not built from the supported pinned source and patch. Reinstall this profile.")
    expected = set(MODEL_FILES) | set(NOTICE_FILES) | {f"bin/{name}" for name in BINARY_FILES}
    files = manifest.get("files", {})
    ensure(isinstance(files, dict) and set(files) == expected
           and {path.name for path in (root / "bin").iterdir()} == set(BINARY_FILES),
           "Native caption files are missing or unexpected. Reinstall this profile.")
    for name in expected:
        metadata = files[name]
        path = root.joinpath(*PurePosixPath(name).parts)
        info = regular(path)
        ensure(isinstance(metadata, dict) and set(metadata) == {"size", "sha256"}
               and type(metadata["size"]) is int and info.st_size == metadata["size"] > 0
               and isinstance(metadata["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", metadata["sha256"]),
               "A native caption file is missing or incomplete. Repair this profile.")
        if name in MODEL_FILES:
            ensure((metadata["size"], metadata["sha256"]) == MODEL_FILES[name],
                   "The native model manifest does not match the pinned weights.")
        if verify_models or name not in MODEL_FILES:
            ensure(digest(path) == metadata["sha256"], "A native caption file failed its checksum. Repair this profile.")
    ensure(files["source.patch"]["sha256"] == PATCH_SHA256, "The retained native source patch does not match.")
    return manifest


def windows(start, end, rate):
    ensure(type(rate) is int and rate in (44100, 48000), "Reimport the source as normalized audio.")
    first, last = math.ceil(Fraction(str(start)) * rate), math.floor(Fraction(str(end)) * rate)
    ensure(last - first >= rate, "Native captions require an excerpt of at least one second.")
    output = []
    for begin in range(first, last, 30 * rate):
        stop = min(begin + 30 * rate, last)
        if stop - begin < rate:
            begin = max(first, last - 30 * rate)
        output.append((begin, stop))
    return output


def prepare(source, output, options, read_excerpt):
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly

    with sf.SoundFile(source) as reader:
        rate = reader.samplerate
        ensure(options["end"] <= reader.frames / rate, "The caption excerpt exceeds the source.")
    prepared = []
    for index, (first, last) in enumerate(windows(options["start"], options["end"], rate)):
        selected = {**options, "start": first / rate, "end": last / rate}
        audio, actual_rate = read_excerpt(source, selected)
        ensure(actual_rate == rate and len(audio) == last - first, "The caption source changed during preparation.")
        divisor = math.gcd(rate, 16000)
        mono = resample_poly(audio.mean(axis=1), 16000 // divisor, rate // divisor)
        ensure(0 < len(mono) <= 480000 and np.isfinite(mono).all(), "Invalid native caption audio window.")
        name = f"native-input-{index:03}.wav"
        path = output / name
        with path.open("x+b") as handle:
            sf.write(handle, mono, 16000, format="WAV", subtype="PCM_16")
        prepared.append({
            "file": name, "sha256": digest(path), "samples": len(mono), "sampleRate": 16000,
            "sourceFirstSample": first, "sourceLastSample": last, "sourceSampleRate": rate,
            "start": first / rate, "end": last / rate,
        })
    return {"windows": prepared}


class MemoryStatus(ctypes.Structure):
    _fields_ = [
        ("length", wt.DWORD), ("load", wt.DWORD),
        ("total", ctypes.c_ulonglong), ("available", ctypes.c_ulonglong),
        ("page_total", ctypes.c_ulonglong), ("page_available", ctypes.c_ulonglong),
        ("virtual_total", ctypes.c_ulonglong), ("virtual_available", ctypes.c_ulonglong),
        ("extended_available", ctypes.c_ulonglong),
    ]


class ProcessMemory(ctypes.Structure):
    _fields_ = [
        ("size", wt.DWORD), ("faults", wt.DWORD),
        ("peak_working_set", ctypes.c_size_t), ("working_set", ctypes.c_size_t),
        ("peak_paged_pool", ctypes.c_size_t), ("paged_pool", ctypes.c_size_t),
        ("peak_nonpaged_pool", ctypes.c_size_t), ("nonpaged_pool", ctypes.c_size_t),
        ("pagefile", ctypes.c_size_t), ("peak_pagefile", ctypes.c_size_t),
        ("private_bytes", ctypes.c_size_t),
    ]


def memory_api():
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel.GlobalMemoryStatusEx.argtypes = [ctypes.POINTER(MemoryStatus)]
    kernel.GlobalMemoryStatusEx.restype = wt.BOOL
    kernel.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    kernel.OpenProcess.restype = wt.HANDLE
    kernel.CloseHandle.argtypes = [wt.HANDLE]
    psapi.GetProcessMemoryInfo.argtypes = [wt.HANDLE, ctypes.POINTER(ProcessMemory), wt.DWORD]
    psapi.GetProcessMemoryInfo.restype = wt.BOOL
    return kernel, psapi


def available_memory(kernel):
    memory = MemoryStatus()
    memory.length = ctypes.sizeof(memory)
    ensure(kernel.GlobalMemoryStatusEx(ctypes.byref(memory)), "Unable to check available memory; native inference was refused.")
    return memory.available


def completion(text, log, limit=MAX_TOKENS):
    markers = re.findall(r"mtmd_completion: reason=(\w+) tokens=(\d+) limit=(\d+)", log)
    ensure(len(markers) == 1, "The native helper did not report one explicit completion reason. No caption was published.")
    reason, tokens, reported_limit = markers[0]
    ensure(int(reported_limit) == limit and 0 < int(tokens) <= limit, "The native completion metadata is invalid.")
    ensure(reason == "eog", f"Native caption output is incomplete ({reason}); raw output was retained, not published.")
    ensure(bool(text.strip()) and len(text) <= 20000, "The native caption is empty or oversized.")
    headings = []
    for label in ("Sound Sources", "Performance", "Pulse and Energy", "Development"):
        pattern = rf"^\s*(?:\d+[.)]\s*)?(?:\*\*)?{label}(?:\*\*)?\s*:"
        matches = list(re.finditer(pattern, text, re.IGNORECASE | re.MULTILINE))
        ensure(len(matches) == 1,
               "The native caption did not complete all four requested qualitative observations. Raw output was retained.")
        headings.append(matches[0])
    for index, heading in enumerate(headings):
        stop = headings[index + 1].start() if index + 1 < len(headings) else len(text)
        ensure(stop > heading.end() and re.search(r"\w", text[heading.end():stop]),
               "A native caption observation is missing or empty. Raw output was retained.")
    prompts = re.findall(r"formatted_chat\.prompt: (.*?<\|im_start\|>assistant\r?\n)", log, re.DOTALL)
    ensure(len(prompts) == 1 and len(prompts[0]) < 2000 and PROMPT in prompts[0],
           "The native helper did not record the expected formatted audio prompt.")
    return {"reason": reason, "tokens": int(tokens), "limit": limit, "formattedPrompt": prompts[0]}


def audio_layout(log, samples):
    ensure(type(samples) is int and 0 < samples <= 480000, "Invalid native audio sample count.")
    frames = math.ceil(samples / 160)
    expected = [(min(200, frames - first) + 1) // 4 for first in range(0, frames, 200)]
    expected = [count for count in expected if count]
    prepared = [int(value) for value in re.findall(r"audio_tokens->n_tokens = (\d+)", log)]
    decoded = [int(value) for value in re.findall(r"decoding audio batch 1/1, n_tokens_batch = (\d+)", log)]
    ensure(prepared == decoded == expected, "Native audio frame/token alignment did not match the supported reference. No caption was published.")
    return {"validMelFrames": frames, "audioChunks": decoded, "encodedAudioTokens": sum(decoded)}


def offline_environment():
    environment = {key: value for key, value in os.environ.items() if not key.startswith("LLAMA_ARG_")}
    environment.update({
        "LLAMA_ARG_OFFLINE": "1", "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
        "HTTP_PROXY": "http://127.0.0.1:9", "HTTPS_PROXY": "http://127.0.0.1:9",
        "ALL_PROXY": "http://127.0.0.1:9", "NO_PROXY": "",
    })
    return environment


def infer_window(root, directory, index, audio, samples):
    kernel, psapi = memory_api()
    available = available_memory(kernel)
    ensure(available >= 10 * GIB, f"Native captions require 10 GiB available RAM at launch; detected {available / GIB:.2f} GiB. No helper was started.")
    arguments = [
        str(root / "bin" / "llama-mtmd-cli.exe"), "-m", str(root / next(iter(MODEL_FILES))),
        "--mmproj", str(root / "mmproj-Qwen2.5-Omni-7B-Q8_0.gguf"), "--audio", str(audio),
        "-p", PROMPT, "--offline", "--no-mmproj-offload", "-ngl", "0",
        "-c", str(CONTEXT), "-n", str(MAX_TOKENS), "-b", "64", "-ub", "64",
        "-t", "4", "-tb", "4", "--temp", "0", "--seed", "42",
        "--no-warmup", "--log-colors", "off", "--no-repack", "--verbosity", "5", "--jinja",
    ]
    stdout_path, stderr_path = directory / f"native-{index:03}.txt", directory / f"native-{index:03}.log"
    process, handle = None, None
    started = time.monotonic()
    evidence = {"startupAvailableBytes": available, "peakWorkingSetBytes": 0, "peakCommittedBytes": 0, "lowestAvailableBytes": available}
    try:
        with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
            process = subprocess.Popen(
                arguments, cwd=root / "bin", env=offline_environment(), stdin=subprocess.DEVNULL,
                stdout=stdout, stderr=stderr, creationflags=subprocess.CREATE_NO_WINDOW,
            )
            handle = kernel.OpenProcess(0x0400 | 0x0010, False, process.pid)
            ensure(handle, "Unable to monitor native helper memory; the owned helper was stopped.")
            while process.poll() is None:
                memory = ProcessMemory()
                memory.size = ctypes.sizeof(memory)
                if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(memory), memory.size):
                    if process.poll() is not None:
                        break
                    raise NativeCaptionError("Native helper memory monitoring failed.")
                available = available_memory(kernel)
                evidence["peakWorkingSetBytes"] = max(evidence["peakWorkingSetBytes"], memory.peak_working_set)
                evidence["peakCommittedBytes"] = max(evidence["peakCommittedBytes"], memory.peak_pagefile)
                evidence["lowestAvailableBytes"] = min(evidence["lowestAvailableBytes"], available)
                ensure(memory.peak_working_set <= 8 * GIB and memory.peak_pagefile <= 8 * GIB
                       and memory.private_bytes <= 8 * GIB and available >= 2 * GIB,
                       "Native caption memory limit reached. The owned helper was stopped; no truncated result was published.")
                ensure(time.monotonic() - started <= TIMEOUT, "Native caption exceeded its 300-second window limit.")
                ensure(stdout_path.stat().st_size <= 65536 and stderr_path.stat().st_size <= 8 * 1024 ** 2,
                       "Native caption diagnostic output exceeded its limit.")
                time.sleep(.25)
            ensure(process.wait() == 0, "Native caption helper failed. Check the installed runtime and retained job diagnostics.")
        ensure(stdout_path.stat().st_size <= 65536 and stderr_path.stat().st_size <= 8 * 1024 ** 2,
               "Native caption diagnostic output exceeded its limit.")
        text = stdout_path.read_bytes().decode("utf-8")
        log = stderr_path.read_bytes().decode("utf-8")
        evidence.update(completion(text, log))
        evidence.update(audio_layout(log, samples))
        return text, time.monotonic() - started, evidence
    finally:
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        if handle:
            kernel.CloseHandle(handle)


def describe(source, output, models, options, worker_script, progress):
    progress(0, "Verifying native model checksums and preparing source audio")
    root = models / PROFILE
    manifest = read_manifest(root, verify_models=True)
    directory = output / f".native-{uuid.uuid4().hex}"
    directory.mkdir()
    request = {
        "command": "native-prepare", "source": str(source), "output": str(directory),
        "models": str(models), "options": options,
    }
    # Decoder/DSP imports live only in this short child, not alongside the model.
    prepared = subprocess.run(
        [sys.executable, "-I", "-X", "utf8", "-u", str(worker_script)],
        input=json.dumps(request), capture_output=True, text=True, timeout=60, env=offline_environment(),
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    ensure(prepared.returncode == 0, "Native caption audio preparation failed. Check the excerpt and core runtime.")
    events = [json.loads(line) for line in prepared.stdout.splitlines() if line.strip()]
    values = [event["value"] for event in events if event.get("type") == "result"]
    ensure(len(values) == 1 and isinstance(values[0].get("windows"), list), "Invalid caption preparation result.")
    windows_prepared = values[0]["windows"]
    ensure(1 <= len(windows_prepared) <= 20, "Invalid native caption window count.")
    descriptions, provenance = [], []
    for index, window in enumerate(windows_prepared):
        ensure(window["file"] == f"native-input-{index:03}.wav", "Unexpected native caption audio filename.")
        audio = directory / window["file"]
        ensure(digest(audio) == window["sha256"], "Native caption audio changed before inference.")
        progress(index / len(windows_prepared), f"Describing audio window {index + 1}/{len(windows_prepared)} (qualitative estimates)")
        text, elapsed, evidence = infer_window(root, directory, index, audio, window["samples"])
        descriptions.append({"start": window["start"], "end": window["end"], "text": text})
        details = {
            "input": window, "runtime": {**manifest["build"], "files": {
                name: metadata["sha256"] for name, metadata in manifest["files"].items() if name.startswith("bin/")
            }},
            "weights": {name: pair[1] for name, pair in MODEL_FILES.items()},
            "license": {"upstreamRevision": UPSTREAM_REVISION, "upstreamTerms": "Apache-2.0", "ggufMetadata": "qwen-research"},
            "context": CONTEXT, "maximumResponseTokens": MAX_TOKENS, "noRepack": True,
            "offline": True, "completion": evidence,
        }
        serialized = json.dumps(details, ensure_ascii=True, separators=(",", ":"))
        ensure(len(serialized) <= 4000, "Native caption provenance exceeds the supported size; no evidence was truncated.")
        provenance.append({
            "stage": f"captions-native-window-{index + 1}", "model": MODEL, "revision": REVISION,
            "seconds": elapsed, "details": serialized,
        })
    progress(1, "Complete qualitative captions; estimates ready for review")
    return {
        "descriptions": descriptions, "provenance": provenance,
        "warnings": ["Qwen2.5-Omni Q4 captions are qualitative audio-backed estimates. Instrument roles, timbre, mood and changes may be misidentified; review the original audio. This is not the unverified full-precision Qwen2-Audio profile."],
    }


BUILD_OPTIONS = [
    "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_SYSTEM_NAME=Windows",
    "-DCMAKE_SYSTEM_PROCESSOR=AMD64", "-DGGML_NATIVE=OFF", "-DGGML_AVX=ON", "-DGGML_AVX2=ON",
    "-DLLAMA_OPENSSL=OFF", "-DLLAMA_BUILD_SERVER=OFF", "-DLLAMA_BUILD_EXAMPLES=OFF",
    "-DLLAMA_BUILD_TESTS=ON", "-DLLAMA_BUILD_TOOLS=ON", "-DLLAMA_SUBPROCESS=OFF",
    "-DMTMD_VIDEO=OFF", "-DGGML_CPU_KLEIDIAI=OFF", "-DFETCHCONTENT_FULLY_DISCONNECTED=ON",
]


def build_tools():
    platform_check()
    git = shutil.which("git")
    vswhere = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Microsoft Visual Studio/Installer/vswhere.exe"
    ensure(git and vswhere.is_file(),
           "Native captions need existing Git and Visual Studio C++ Build Tools with x64 tools and CMake/Ninja. No global tools were installed.")
    located = subprocess.run(
        [str(vswhere), "-latest", "-products", "*", "-property", "installationPath"],
        capture_output=True, text=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW,
    )
    ensure(located.returncode == 0 and located.stdout.strip(), "Visual Studio C++ Build Tools were not found.")
    base = Path(located.stdout.strip())
    tools = {
        "git": Path(git), "vcvars": base / "VC/Auxiliary/Build/vcvarsall.bat",
        "cmake": base / "Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe",
        "ninja": base / "Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja/ninja.exe",
    }
    host = "arm64" if os.environ.get("PROCESSOR_ARCHITEW6432", os.environ.get("PROCESSOR_ARCHITECTURE", "")).lower() == "arm64" else "x64"
    ensure(all(path.is_file() for path in tools.values())
           and any((base / "VC/Tools/MSVC").glob(f"*/bin/Host{host}/x64/cl.exe")),
           "Install the existing Visual Studio workload's x64 C++ compiler and CMake/Ninja before acquiring this profile. Sound Studio does not install global tools.")
    tools["host"] = host
    return tools


def extract_source(archive: Path, destination: Path):
    prefix = f"llama.cpp-{SOURCE_COMMIT}/"
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        ensure(len(entries) <= 10000 and sum(item.file_size for item in entries) <= GIB,
               "Native source archive exceeds its extraction limits.")
        names = set()
        for item in entries:
            ensure(item.orig_filename == item.filename and item.filename.startswith(prefix)
                   and "\\" not in item.filename and ":" not in item.filename,
                   "Unsafe native source archive path.")
            relative = item.filename[len(prefix):]
            ensure(not relative.startswith("/") and ".." not in PurePosixPath(relative).parts
                   and not stat.S_ISLNK(item.external_attr >> 16) and item.filename not in names,
                   "Unsafe or duplicate native source archive entry.")
            names.add(item.filename)
        destination.mkdir()
        for item in entries:
            relative = item.filename[len(prefix):]
            if not relative:
                continue
            target = destination.joinpath(*PurePosixPath(relative).parts)
            # Extended paths avoid changing Windows' global long-path setting.
            if os.name == "nt":
                target = Path("\\\\?\\" + str(target.absolute()))
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.open(item) as reader, target.open("xb") as writer:
                    shutil.copyfileobj(reader, writer)


def acquire(models: Path, download, progress):
    tools = build_tools()
    destination = models / PROFILE
    if destination.exists():
        try:
            read_manifest(destination, verify_models=True)
            return {"profile": PROFILE, "ready": True}
        except (NativeCaptionError, OSError, ValueError):
            progress(0, "Repairing the native profile after its integrity/readiness check failed")
    ensure(shutil.disk_usage(models).free >= 15 * GIB,
           "Native caption installation needs 15 GiB free disk space for verified downloads, build files and installed weights.")
    patch = Path(__file__).parent / "native/llama-b12064-omni.patch"
    ensure(digest(patch) == PATCH_SHA256, "The bundled native compatibility patch failed its checksum. Repair Sound Studio first.")
    cache = models / ".native-cache"
    cache.mkdir(exist_ok=True)
    ensure(not getattr(cache.lstat(), "st_file_attributes", 0) & 0x400 and not cache.is_symlink(),
           "The native download cache must not be a linked directory.")

    def cached(name, url, size, checksum):
        target = cache / name
        if target.exists():
            if regular(target).st_size == size and digest(target) == checksum:
                return target
            target.rename(cache / f"{name}.invalid-{uuid.uuid4().hex}")
            progress(0, f"Reacquiring {name}; the previous cached file failed its checksum")
        partial = cache / f".download-{uuid.uuid4().hex}"
        try:
            download(url, partial, size, checksum, "sha256", lambda fraction: progress(fraction, f"Downloading {name} (explicit acquisition)"))
            partial.rename(target)
        finally:
            partial.unlink(missing_ok=True)
        return target

    archive = cached("llama-source.zip", f"https://codeload.github.com/ggml-org/llama.cpp/zip/{SOURCE_COMMIT}", SOURCE_SIZE, SOURCE_SHA256)
    weights = {name: cached(name, f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}?download=true", size, checksum)
               for name, (size, checksum) in MODEL_FILES.items()}
    notices = {
        "Qwen-LICENSE.txt": cached("Qwen-LICENSE.txt",
            f"https://huggingface.co/Qwen/Qwen2.5-Omni-7B/resolve/{UPSTREAM_REVISION}/LICENSE",
            11343, "8d5eb5f806d01e8f5ea2c5a52f7d68ebc54b196b1cfbe1cd5dfa4b94e482a9c6"),
        "GGUF-model-card.txt": cached("GGUF-model-card.txt",
            f"https://huggingface.co/{MODEL}/resolve/{REVISION}/README.md",
            471, "e7411584ea811a7e153c11b531977f098e90e488503b904fccaa3dc52c7c7c33"),
    }
    staging = models / f".native-install-{uuid.uuid4().hex}"
    staging.mkdir()
    backup = models / f".native-previous-{uuid.uuid4().hex}"
    log_path = models / f"native-build-{uuid.uuid4().hex}.log"
    try:
        source, build, installed = staging / "source", staging / "build", staging / "profile"
        extract_source(archive, source)
        installed.mkdir()
        (installed / "bin").mkdir()
        environment = offline_environment()
        for name in list(environment):
            if name.startswith("GIT_") or name in ("CC", "CXX", "CL", "_CL_", "LINK", "CFLAGS", "CXXFLAGS", "CPPFLAGS", "LDFLAGS", "CMAKE_TOOLCHAIN_FILE", "CMAKE_PREFIX_PATH"):
                environment.pop(name)
        environment.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CEILING_DIRECTORIES": str(staging)})
        with log_path.open("xb") as log:
            for arguments in (["--check"], []):
                result = subprocess.run(
                    [str(tools["git"]), "apply", *arguments, str(patch.resolve())],
                    cwd=source, env=environment, stdout=log, stderr=log, timeout=30,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
                ensure(result.returncode == 0, "The pinned native source patch could not be applied. No helper was installed.")

            def quoted(value):
                value = str(value)
                ensure(not any(char in value for char in ('"', "%", "!", "\r", "\n")),
                       "The managed build path contains unsupported command characters. No build was started.")
                return f'"{value}"'

            configure = [str(tools["cmake"]), "-S", str(source), "-B", str(build), *BUILD_OPTIONS,
                         f"-DCMAKE_MAKE_PROGRAM={tools['ninja']}"]
            compile_command = [str(tools["cmake"]), "--build", str(build), "--target", "llama-mtmd-cli", "test-mtmd-impl", "-j4"]
            host_argument = "arm64_x64" if tools["host"] == "arm64" else "x64"
            command = (f"call {quoted(tools['vcvars'])} {host_argument} >nul && "
                       + " ".join(map(quoted, configure)) + " && " + " ".join(map(quoted, compile_command)))
            progress(.1, "Building the checksum-pinned native helper and compatibility tests with existing x64 tools")
            comspec = os.environ.get("ComSpec", r"C:\Windows\System32\cmd.exe")
            command_line = f'{quoted(comspec)} /d /v:off /s /c "{command}"'
            result = subprocess.run(
                command_line,
                env=environment, stdout=log, stderr=log, timeout=1800, creationflags=subprocess.CREATE_NO_WINDOW,
            )
            ensure(result.returncode == 0, f"Native C++ build failed. Verify the x64 compiler and CMake/Ninja workload; diagnostics are retained in {log_path.name}.")
            result = subprocess.run(
                [str(build / "bin/test-mtmd-impl.exe")], cwd=build / "bin", env=environment,
                stdout=log, stderr=log, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW,
            )
            ensure(result.returncode == 0, f"Native audio compatibility tests failed; no helper was installed. See {log_path.name}.")
        compiler_files = list((build / "CMakeFiles").glob("*/CMakeCXXCompiler.cmake"))
        ensure(len(compiler_files) == 1, "The native build did not record one compiler identity.")
        compiler = re.search(r'set\(CMAKE_CXX_COMPILER_VERSION "([^"]+)"\)', compiler_files[0].read_text())
        ensure(compiler, "The native build did not record its compiler version.")
        versions = {}
        for tool in ("cmake", "ninja"):
            version = subprocess.run([str(tools[tool]), "--version"], capture_output=True, text=True,
                                     timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
            ensure(version.returncode == 0 and version.stdout.strip(), "The native build tool version could not be recorded.")
            versions[tool] = version.stdout.splitlines()[0][:100]
        for name in BINARY_FILES:
            shutil.copyfile(build / "bin" / name, installed / "bin" / name)
        for name, path in {**weights, **notices}.items():
            shutil.copyfile(path, installed / name)
        shutil.copyfile(source / "LICENSE", installed / "llama-LICENSE.txt")
        shutil.copyfile(patch, installed / "source.patch")
        files = {}
        for name in [*MODEL_FILES, *NOTICE_FILES, *(f"bin/{name}" for name in BINARY_FILES)]:
            path = installed.joinpath(*PurePosixPath(name).parts)
            files[name] = {"size": path.stat().st_size, "sha256": digest(path)}
        manifest = {
            "version": 1, "profile": PROFILE, "model": MODEL, "revision": REVISION,
            "license": PROFILE_SPEC["license"], "licenseUrl": LICENSE_URL, "files": files,
            "build": {"sourceCommit": SOURCE_COMMIT, "sourceArchiveSha256": SOURCE_SHA256,
                      "patchSha256": PATCH_SHA256, "target": "windows-x64-avx2", "compiler": compiler[1],
                      "tools": versions, "options": BUILD_OPTIONS},
        }
        (installed / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        read_manifest(installed, verify_models=True)
        if destination.exists():
            destination.rename(backup)
        try:
            installed.rename(destination)
        except BaseException:
            if backup.exists():
                backup.rename(destination)
            raise
        if backup.exists():
            shutil.rmtree(backup)
        progress(1, "Pinned native helper built and tested; model files and license notices verified")
        return {"profile": PROFILE, "ready": True}
    finally:
        shutil.rmtree(Path("\\\\?\\" + str(staging.absolute())) if os.name == "nt" else staging)
