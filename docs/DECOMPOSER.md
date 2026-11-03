# Decomposer guide

## Scope

Effects and Music generate through the user's ComfyUI; see the [main guide](../GUIDE.md). Decomposer independently works on an existing recording: local import, waveform/playback, excerpt analysis, review, library reopening and exports. It does not create music or prove that a variation is legally reusable.

The managed analysis runtime initially targets **Windows x64**, including x64 emulation on Windows ARM64. Other operating systems can run the application shell but managed analysis setup is not implemented for them. The renderer-only browser preview cannot access desktop audio APIs.

## Install and run

Use Node.js 22.12+ and npm in PowerShell:

```powershell
npm install
npm run dev
```

`npm run build` type-checks and builds into `out`; `npm start` opens that build. `.\Start-SoundStudio.ps1` opens an existing build. `npm run dev:web` serves only the renderer at `http://127.0.0.1:5173`.

No Python or model is required just to edit drafts. For Decomposer, open **Model Settings > Decomposer**, install **Audio + timing / harmony**, then explicitly install any optional model profiles you need. The application does not modify global Python, PATH, or other worktrees.

## Decomposer workflow

1. **Import & plan:** choose a local WAV, FLAC, MP3, OGG or M4A. Extension is only a first filter; the actual decoder must accept the file. The original is copied intact into the app profile and SHA-256 hashed. A separate decoded WAV supports playback and waveform display. Limits are 512 MB, 30 minutes, one or two channels, and 8-192 kHz input. Unsupported, corrupt and external-reference files are rejected.
2. **Analyse:** select an excerpt of up to 10 minutes and the desired stages. Timing/energy/harmony DSP is always included. Optional stages require installed profiles. Analysis never silently installs a model. Jobs run serially with queued, running, failed, cancelled and completed states; selecting a workflow step is not execution.
3. **Review & refine:** audition the reference, seek, and use mute/solo for available stems. Edit tempo/key, timed sections, chord estimates, audio descriptions and lyric lines. Save reviewed corrections before exporting or changing the selected analysis. Raw machine results are retained separately. Timestamps are seconds from the original source.
4. **Export:** choose a directory. Each export creates a new uniquely named folder without overwriting existing files. Export only real available stem WAVs, MIDI, LRC/SRT lyrics, structured JSON or Markdown. Every export includes JSON provenance and both raw and reviewed results.

The analysis goal and sample cards are **text-only intent**. They are not fed back as acoustic evidence. Imported material must be material you are entitled to process.

### What the stages mean

| Stage | Output and limitations |
|---|---|
| Librosa timing / energy | Beat locations, tempo and RMS measurements from decoded audio. Tempo may be half/double time; silence or weak rhythm may yield no estimate. |
| Chroma harmony | Key and major/minor chord estimates, not authoritative notation. Complex voicings, detuning and dense mixes are difficult. |
| Section estimates | Conservative acoustic-change segments, not verified verse/chorus labels. |
| HTDemucs | Selected vocals/drums/bass/other WAVs from a four-source model. Selecting fewer output stems does not make the underlying inference cheaper. Bleed and artifacts are expected. |
| Whisper tiny/base | Local CPU-int8 transcription of the selected vocals stem when available, otherwise the explicitly labeled original mix. Input hash/model provenance is retained; a stem/decode error never silently falls back. Singing may be mistranscribed or hallucinated. Optional word timing is an estimate, **not correctness verification**. |
| Basic Pitch | Optional note/MIDI extraction. This is not a chord/key/beat estimator. Dense polyphonic mixes are difficult. |
| Qwen2-Audio-7B-Instruct | Audio-backed descriptions over windows no longer than 30 seconds, retained as timed results. A model can hallucinate instruments, harmony or structure; compare against the audio. |

No calibrated confidence score is presented. Source time ranges, model/revision, options, stage elapsed time and warnings are preserved so reviewers can assess evidence.

Stem previews follow the reference clock and are not a sample-accurate DAW mixer. Exported stems retain their model sample alignment. Source/lyric timestamps are absolute; stem WAVs and MIDI begin at excerpt zero, with the original offset recorded in JSON.

## Runtime and model acquisition

The core installer downloads checksum-pinned **uv 0.6.17**, uses its managed **CPython 3.11.12 x64**, and installs pinned direct dependencies in an app-owned virtual environment. Optional profiles have separate requirements. See [`scripts/analysis`](../scripts/analysis) for exact dependency/model pins and license references.

Downloads are explicit and use upstream package/model services. Audio and prompts are never uploaded. After acquisition, the worker uses local model paths, offline Hugging Face settings, and a process-level network denial guard. No cloud fallback is implemented. The worker communicates with Electron over stdin/stdout, not a listening server.

Model Settings reports import/file readiness, the managed Python version and physical RAM. It does not claim measured GPU capacity or guaranteed inference success. CPU is the supported execution profile. Installation errors remain visible; cancellation stops the installation process tree and partial downloads are not treated as ready models.

| Profile | Approximate acquisition / hardware considerations |
|---|---|
| Core | Roughly 250 MB plus caches; no model weights |
| HTDemucs | CPU dependencies plus roughly 80 MB weights; CPU separation can be slow |
| Whisper tiny / base | Roughly 75 / 145 MB weights plus CTranslate2/PyAV dependencies |
| Basic Pitch | Runtime dependencies and a small note-transcription model |
| Qwen2-Audio 7B | 16.8 GB weight files, plus dependencies/caches; CPU float32 inference needs substantially more RAM than the download size. Plan for about 40 GB **available** RAM. Installation is not implicit and analysis has a memory preflight. |

The Qwen profile is implemented but real caption inference has **not been validated on the development machine**: it has 32 GiB physical RAM and insufficient free memory. Do not interpret profile presence or a successful missing-model test as proof that caption inference ran.

## Library, source integrity and recovery

Decomposer's **Analysis library** reopens imported sources and completed/failed jobs across restarts. It is not a general searchable asset manager. Originals, normalized playback WAVs, manifests, raw results, corrections and outputs live under the Electron user-data directory in `decomposer`. Runtime and models live separately in `decomposer-runtime`.

The renderer receives UUID asset/job IDs, not source filesystem paths. Media URLs resolve only registered reference/stem files. Reads and exports verify stored hashes. Removing the external original after import is safe because the library keeps its copy; deleting or replacing internal library files produces an actionable error. Reimport or rerun rather than rewriting the original record.

Application shutdown cancels running work. On restart, queued/running records become interrupted failures, not successful analyses. Partial artifacts are retained but are not served or exported. Corrupt/unsupported manifests are reported and preserved. Back up these directories before manual recovery; do not delete the whole application profile to fix one record.

## Drafts and Music handoff

Effects/Music drafts and Decomposer goals remain independent. They persist under `sound-studio.workspace.v3`. Version 1 and both parallel version 2 formats migrate deliberately, preserving generation lyrics/key, goals and analysis selections. Legacy overloaded loop/instrumental intentions become explicit stem/lyric options. Original v1/v2 keys remain untouched; see the [storage guide](../GUIDE.md#storage-and-privacy).

Unsupported/corrupt saved drafts are never overwritten. An error banner explains that subsequent edits are in memory only. If storage is full, keep the window open and copy important text.

**Send saved reviewed brief to Music** uses saved reviewed analysis when available. Without completed analysis it is labeled **unanalysed intent**, never an analysed reference. The transfer dialog lets you append (preserving Music settings), explicitly replace, or cancel. There is no silent replacement or 4,000-character truncation. Music supports a 200,000-character draft; an oversized transfer is rejected with instructions to export the full analysis instead.

The 200,000-character Music draft is for preserving evidence, not bypassing generation limits. Generation remains disabled until the prompt fits the selected model's limits and its backend is ready. Shorten it deliberately for generation; the full analysis remains saved. Handoff never starts generation. Sample briefs do not produce audio.

## Architecture and desktop boundaries

| Location | Responsibility |
|---|---|
| `src/main` | Lifecycle, trusted-frame IPC, safe dialogs, opaque asset registry, range media streaming, atomic durable records, job queue, runtime acquisition and non-overwriting exports |
| `src/preload` | Fixed typed methods only; no arbitrary filesystem, shell, URL or process APIs |
| `src/renderer` | Workflow UI, audio review, correction editing, model setup and draft persistence |
| `src/shared` | Strict analysis/runtime/result schemas and versioned draft migration |
| `scripts/analysis` | Local decoder, DSP and optional ML adapters; model acquisition only in the explicit acquisition command |
| `tests` | Draft/schema, store, exports, cancellation, process error and recovery contracts |

Context isolation, renderer sandboxing, web security and disabled Node integration remain enabled. New windows, webviews, renderer navigation and permission requests are denied. CSP allows only app resources, the registered audio scheme, and development loopback connections. Main-process APIs validate all inputs and reject untrusted frames; the native file chooser is the only import path.

## Development and validation

```powershell
npm test
npm run typecheck
npm run test:desktop
```

Desktop smoke uses the real Electron app and isolated temporary profiles. Without a local runtime it covers the missing-runtime boundary and shell workflows. To include real decoding/DSP/playback/review/export:

```powershell
npm run setup:analysis -- --root .runtime --profile core
npm run test:desktop
```

This explicitly acquires an isolated test runtime inside the ignored `.runtime` directory. `SOUND_STUDIO_TEST_RUNTIME` may point to a different dedicated test runtime. The smoke profile copies its virtual environment into a temporary directory, never the user's library or model weights. Synthetic audio in this smoke is valid for DSP/contracts only; it is **not evidence of successful stem, lyric or caption inference**.

Optional profiles can be installed into the same dedicated test runtime by changing `--profile` to `stems`, `lyrics-tiny`, `lyrics-base`, `notes` or `captions`. Do not install the large caption profile on an under-resourced machine.

```powershell
npm run screenshots
```

Captures are actual app windows. `decomposer-workspace.png` uses a clearly named deterministic chord fixture for DSP review, not a generated song or model benchmark. The README's `decomposer-stems.png` shows real HTDemucs outputs.

### Real-model checks and attribution

The lawful validation recording is **Let's Go Fishin' by Karissa Hobbs**, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), from the [Free Music Archive](https://freemusicarchive.org/music/Karissa_Hobbs/Age_of_Flowers/09_Lets_Go_Fishin) through [librosa's example collection and license notice](https://librosa.org/data/audio/Karissa_Hobbs_-_Lets_Go_Fishin.txt). Its source SHA-256 is `27b3667c396c1831511aa3c415fcf582b6e8be560cafb844c5b67b76b72c1cb3`. Neither the recording nor generated artifacts/model weights are committed.

To reproduce with your own lawful recording and explicitly installed profiles:

```powershell
node --import tsx scripts\model-smoke.ts --runtime .runtime --source "C:\Audio\reference.ogg" --start 20 --end 40 --stems --lyrics --words --notes
node scripts\stem-playback-smoke.mjs .runtime\model-evidence
.\.runtime\venv\Scripts\python.exe -m unittest discover -s scripts\analysis -p test_worker.py
```

The model check inspects published artifacts, timestamps and nonempty transcripts; it does not certify separation quality, lyric accuracy or correct notation. `--lyrics-base` selects the base rather than tiny transcription model. The stem desktop check opens real outputs and exercises synchronized playback, seeking, mute and solo.

On the 20-40 second validation excerpt, CPU runs produced four 20-second stems and a parsed MIDI containing 241 notes within excerpt bounds. The vocal-stem transcription route produced 33 Whisper-tiny words (21.44-39.70 seconds); the separately exercised full-mix route produced 36 (21.40-39.74 seconds), without boundary adjustments. WAVs, MIDI, JSON, Markdown, LRC and SRT were inspected, and the actual Electron app played the stems. A separate Whisper-base full-mix run also executed, but produced 145 zero-duration word entries with explicit warnings; this is evidence of imperfect singing alignment, **not an accuracy success**. Caption inference remains unverified for the resource reason above.

On the development network, `files.pythonhosted.org` failed TLS handshakes. Dependencies for validation were resolved from a public PyPI mirror, with **every resolved artifact hash checked against official PyPI/PyTorch metadata before installation**, then installed with required hashes. Certificate validation remained enabled. The app's production defaults remain official upstream hosts; no silent mirror or insecure fallback was added.

## Troubleshooting

| Symptom | Action |
|---|---|
| Import reports missing runtime | Install Core in Decomposer Model Settings. The web preview has no desktop API. |
| Dependency download fails | Check HTTPS access to PyPI/files.pythonhosted.org and available disk space. Keep certificate validation enabled; do not use insecure TLS switches. |
| Selected stage says model is missing | Explicitly install that profile. A failed stage fails the job rather than returning fake output. |
| Caption memory preflight fails | Use a machine with enough available RAM, or disable captions and continue with other stages. No cloud fallback exists. |
| Decoder rejects a file | Use a supported, valid local audio file. Renaming a file extension is not conversion. |
| Stem/audio playback fails | Reopen the analysis, inspect integrity errors, then reimport/rerun if internal files are missing. |
| Corrections cannot save | Check timestamp ordering/bounds and whether another editor updated the revision. Keep a copy of unsaved text. |
| Export fails | Choose a writable directory with enough disk space. Existing exports are not overwritten. |
| Generate is disabled after handoff | Follow the generation model's readiness and prompt-length messages. Keep the saved full analysis and deliberately shorten the Music prompt. |
| Electron binary is missing | Run `npm install` and review any blocked required package lifecycle scripts under your organization's policy. |

The workflow-first design follows [Character Studio](https://github.com/rwrife/CharacterStudio): text-only tabs, one contextual settings panel, a connected chevron stepper and a large review surface. Keyboard navigation, modal focus containment, focus restoration, reduced motion and a 960-by-700 desktop minimum remain part of the design.
