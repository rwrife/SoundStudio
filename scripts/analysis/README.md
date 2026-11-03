# Local Decomposer worker

This worker performs real local audio import, musical analysis, and explicitly selected model inference. It is not the Effects/Music audio generator. Model output is **an estimate**, not verified musical truth.

## Runtime and dependencies

The desktop main process owns installation, cancellation, managed directories, and publication. Use its managed **CPython 3.11.12 Windows x64** environment, including x64 emulation on Windows ARM64. Native ARM64 Python wheels are not assumed. No system Python, FFmpeg executable, GPU, CUDA toolkit, or external server is required.

Install `requirements-core.txt` for import and signal analysis. Optional profiles have separate requirements files: `stems`, `lyrics-tiny`, `lyrics-base`, `notes`, and `captions`. These pin direct and important native dependencies, but **are not complete transitive/hash lockfiles**. The two Torch profiles use the official CPU wheel index and the same `torch==2.6.0+cpu`. Basic Pitch 0.4.0's Python 3.11 package metadata requires TensorFlow 2.15.0 even though inference uses the compact TFLite model; its installation is substantially larger than its model.

Lyrics and notes also pin `setuptools==75.8.2`: CTranslate2 4.5.0 and pretty-midi 0.2.10 import the legacy `pkg_resources` module removed from newer setuptools. Diagnosis names a missing dependency where available, without exposing local paths.

Windows packages may need Microsoft's Visual C++ x64 runtime. Emulated CPU instruction support is a real compatibility requirement: successful package installation alone does not establish that a native library can run. Diagnosis imports native libraries and loads small/medium installed models. It must not be interpreted as measured inference speed or model accuracy.

## One-request protocol

Start `<managed-python> -u scripts\analysis\worker.py`. Write **one** JSON document to stdin and close stdin. UTF-8 input is capped at 64 KiB. Standard output contains newline-delimited JSON only:

```json
{"type":"progress","progress":0.25,"stage":"Estimating tempo"}
{"type":"result","value":{}}
```

`value` depends on the command. Library/native diagnostic output goes to stderr. Failure writes an actionable error to stderr, returns a nonzero exit code, and emits **no result**. The main process must publish only after receiving a valid result **and a successful process exit**. Cancellation must terminate the worker process and remove unpublished job/install staging directories.

### Commands

- `{"command":"import","source":"<absolute managed copy>","output":"<absolute managed directory>"}` writes `reference.wav` and returns exactly `audioMetadataSchema` from `src\shared\decomposer.ts`.
- `{"command":"analyze","source":"<absolute reference.wav>","output":"<absolute job directory>","models":"<absolute managed model root>","options":{...}}` returns exactly `resultSchema`. Options match `optionsSchema`, with a nonempty excerpt of at most 600 seconds. All JSON timestamps are **absolute source seconds**.
- `{"command":"diagnose","models":"<absolute managed model root>"}` returns `{python, profiles:[{id,ready,detail}]}` for all six profiles. Missing/incomplete profiles remain unavailable; nothing is acquired.
- `{"command":"acquire","profile":"<optional profile id>","models":"<absolute managed model root>"}` is the **only model network-download command**. Dependencies must already be installed by the desktop installer. Returns `{profile,ready,model,revision,license,licenseUrl}`. `ready` here means verified acquisition completed; use `diagnose` to check loadability and hardware.

The worker never returns source paths. It writes only the selected `vocals.wav`, `drums.wav`, `bass.wav`, `other.wav`, and/or `notes.mid` to the job output directory. Stem audio and MIDI are **excerpt-relative**, with the source offset recorded in provenance. No unselected stem is saved. Models internally predict all four stems when any stem is requested.

## Decoder and failure boundaries

Import accepts `.wav`, `.flac`, `.mp3`, `.ogg`, or `.m4a` only, with exactly one audio stream, 1–2 channels, 8–192 kHz, finite decoded samples, and at most 1,800 decoded seconds. Multichannel audio is rejected rather than silently downmixed. Duration is checked both from metadata and by counting decoded samples. Empty, invalid, nonfinite, and unsupported files fail.

PyAV's bundled FFmpeg libraries decode an already-open local file using a forced demuxer. No system executable is launched. The FFmpeg protocol allow-list is empty, custom external I/O is rejected, and MOV external data references are disabled. Filesystem symlinks/junctions, UNC shares, URLs, and alternate data streams are rejected. Imported samples are converted to PCM16 mono/stereo at 44,100 Hz (or 48,000 Hz for 48 kHz multiples); samples outside the PCM range are clipped. At most 1,600 waveform peak bins are measured from the normalized file.

Analysis accepts only normalized PCM16 `reference.wav`, reads only the selected excerpt, and checks every selected model manifest/dependency before DSP. Stage failure fails the whole job; the worker removes its staging files and rolls back any output moves. A hard process kill can leave hidden staging files, so the main process remains responsible for cleanup and transactional job publication.

Import, diagnosis, and inference set Hugging Face/Transformers offline flags and deny Python socket connection/DNS/datagram APIs. Every model loader receives managed local files; Transformers uses `local_files_only=True`, `trust_remote_code=False`, and safetensors. No Hugging Face cache fallback is used. **This is defense in depth, not an OS network sandbox**: native libraries are constrained through their local-only interfaces, not an operating-system firewall.

## What each stage actually does

- **Core:** librosa beat/tempo tracking, RMS, chroma-derived Krumhansl-Schmuckler key correlation, conservative major/minor triad matching in two-second windows, and chroma/energy-change section boundaries separated by at least 12 seconds. Unclear/silent passages remain unknown. Sections are numbered, not invented verse/chorus labels. No lyrics or semantic descriptions are fabricated from DSP.
- **Stems:** maintained Demucs 4.1.0 / HTDemucs on CPU, deterministic zero-shift inference with overlapping 7.8-second segments. Selected outputs are real model estimates, PCM16 stereo at 44.1 kHz. Peaks above full scale are normalized with the gain recorded in warnings. Bleed/artifacts are possible.
- **Lyrics:** faster-whisper 1.1.1, multilingual tiny or base, CPU `int8`, beam size 5, previous-text conditioning and VAD disabled for singing. Optional word timing produces word-level entries in the existing timed-text field. NumPy timestamp scalars are converted without changing their numeric values. Boundary overruns of at most 40 ms (two timestamp ticks) are clipped with an explicit warning and original/normalized excerpt-relative timing evidence in provenance; larger, reversed, or nonfinite timings fail the job. At most 16 boundary corrections are accepted so their evidence fits the shared contract; additional corrections fail rather than losing evidence. Zero-duration entries are retained with an alignment warning. Sung lyrics may be missing, wrong, or hallucinated; timestamps do not prove words correct.
- **Notes:** actual Basic Pitch ICASSP 2022 TFLite predictions become a validated MIDI file. Default thresholds are recorded. MIDI timings are excerpt-relative and use a 120 BPM encoding tempo, **not an inferred musical tempo**. Finite NumPy timing scalars retain their values. Boundary corrections are limited to two analysis frames (23.22 ms), account for endpoint MIDI tick rounding, and preserve original/normalized events, pitch, and velocity in provenance with a warning. More than 12 corrections, significant overruns, nonfinite/reversed/zero-duration notes, or notes wholly outside the excerpt fail rather than being silently dropped. MIDI is parsed back to verify note counts and bounds. No notes are invented for an empty prediction.
- **Captions:** Qwen2-Audio-7B-Instruct gets actual waveform features for successive windows of at most 30 seconds; deterministic generated descriptions are returned with window timestamps. CPU float32 is intentionally conservative about numeric support. The worker requires **at least 40 GiB total and 35 GiB currently available RAM** before inference; a 32 GiB machine is insufficient. Approximately 40 GiB or more is recommended, and CPU execution can be extremely slow. Diagnosis checks local config, processor, safetensors headers, and RAM without loading the complete model. This does not certify full inference.

Each completed stage records model identity, immutable revision, wall-clock processing seconds, and actual options/algorithm settings. Outputs never claim generation quality, source ownership, or a semantic conclusion absent an actual model result.

## Model acquisition and licenses

Only explicit `acquire` downloads weights. Downloads use pinned commits, upstream LFS SHA-256 or Git blob hashes, exact byte sizes, and a managed staging directory. A manifest records revision, license metadata, file sizes, and SHA-256 hashes. Inference checks expected revision, filenames, and sizes; model loaders validate structures. It does not re-hash multi-gigabyte weights every run. Do not put models or managed runtime files in Git.

| Profile | Official model source | Pinned revision | License |
| --- | --- | --- | --- |
| Stems | [adefossez/HTDemucs](https://huggingface.co/adefossez/HTDemucs) | `cbc8a9b1a87023b7fd74e7b3412e6321c0eab003` | [Demucs MIT](https://github.com/adefossez/demucs/blob/v4.1.0/LICENSE) |
| Tiny lyrics | [Systran/faster-whisper-tiny](https://huggingface.co/Systran/faster-whisper-tiny) | `d90ca5fe260221311c53c58e660288d3deb8d356` | MIT |
| Base lyrics | [Systran/faster-whisper-base](https://huggingface.co/Systran/faster-whisper-base) | `ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66` | MIT |
| Notes | [Spotify Basic Pitch v0.4.0](https://github.com/spotify/basic-pitch/tree/9991303bba609a3b93089d13ec80d1d495083596) | `9991303bba609a3b93089d13ec80d1d495083596` | [Apache-2.0](https://github.com/spotify/basic-pitch/blob/9991303bba609a3b93089d13ec80d1d495083596/LICENSE) |
| Captions | [Qwen/Qwen2-Audio-7B-Instruct](https://huggingface.co/Qwen/Qwen2-Audio-7B-Instruct) | `0a095220c30b7b31434169c3086508ef3ea5bf0a` | Apache-2.0, declared in pinned model card |

Model/code licensing does not grant rights to the imported recordings. Import and export only audio you have permission to process. Demucs's model card delegates to the maintained project's repository; its safetensors are loaded directly rather than fetching old pickle checkpoints.

## Tests

From the repository root, using the managed Python with core requirements installed:

```powershell
& "<managed-python>" -m unittest discover -s scripts\analysis -p test_worker.py -v
```

Tests generate short analytic **test signals only**, exercise real PyAV decoding and librosa DSP, validate contract bounds, test offline network guards, and inject stage failures to verify rollback. Scratch files stay under the repository's ignored `.runtime` directory and are removed after each test. No test downloads models. Without core packages only standard-library boundary tests run, and decoder/DSP tests are explicitly skipped.

Optional model inference requires separate, lawful-audio validation after explicit installation; passing unit tests or diagnosis is not proof of those paths, model quality, or sung-lyric accuracy. Do not download the large caption model merely to run tests.
