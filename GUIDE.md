# Sound Studio guide

## Current scope

Sound Studio is an Electron, React and TypeScript desktop app for AI sound effects and music. It follows Character Studio's workflow-first layout, with a blue rather than green palette. Generation is delegated to a [ComfyUI](https://github.com/comfyanonymous/ComfyUI) server that you run on the same device.

**Implemented:**
- Effects and Music workspaces with independent drafts.
- A Decomposer workspace for planning reference-track breakdowns and sending a text brief to Music. It is a planning placeholder: it has no model, readiness check or generation path.
- A loopback-only ComfyUI connection with version, device and model-file checks.
- Starting and stopping your own ComfyUI install with one click.
- Confirmed, SHA-256-verified downloads of the default local models into that install.
- Model profiles with readiness checks, hardware-fit guidance and per-model input limits.
- Generation jobs with live progress, honest failure and cancellation states, and a one-hour limit.
- Validation of returned audio before it becomes a take.
- Playback with waveforms drawn from the decoded file.
- A local take library with delete.
- Export of the original file with a provenance record.
- Opt-in cloud partner models with an encrypted API key.
- Imported custom ComfyUI workflows.

**Not implemented:**
- Installing or updating ComfyUI, starting the ComfyUI Desktop app, and downloading models other than the default local ones below.
- Music decomposition: reference audio import, stem separation, tempo and harmony analysis and lyric transcription.
- Audio import, editing, variations, loop refinement or loudness processing.
- Project files, search, packaging and an MCP server.

Sound Studio never fakes audio. If ComfyUI is unavailable, a model is missing or a job fails, you see that state rather than a placeholder take.

## Install and run

Use Node.js 22.12+ and npm from the repository root:

```powershell
npm install
npm run dev
```

`npm run dev` starts the Electron app with renderer hot reload. `npm run build` type-checks and builds into `out`, and `npm start` opens that build. `.\Start-SoundStudio.ps1` checks for dependencies and an existing build before launching it.

`npm run dev:web` serves only the renderer at `http://127.0.0.1:5173`. It is useful for visual work, but cannot reach ComfyUI, play takes or export. Browser preview storage is separate from the desktop profile.

## Set up ComfyUI

1. Install a recent ComfyUI build: the portable or desktop release, or a source checkout. Older builds may lack the ACE-Step 1.5 or partner nodes; Model Settings names any missing nodes.
2. Open Sound Studio. It looks for ComfyUI at `http://127.0.0.1:8188` on every launch. If ComfyUI is not running, the header shows **Setup needs attention** and the Effects and Music panels show **ComfyUI is not running**.
3. Choose either one to open **Backend connections**, then choose **Start local ComfyUI** (see below), or start ComfyUI yourself, type its address and press Enter.
4. After **Start local ComfyUI**, Sound Studio offers to download any missing default models (see [Download the default models](#download-the-default-models)). Confirm, and generation becomes available when the download finishes.
5. Work down the **Readiness checks** until each shows a check mark. Each row that needs attention has a button that fixes it or opens the right place. If you add model files yourself, choose **Refresh**; restart ComfyUI if they still don't appear.

Only `127.0.0.1`, `localhost` and `[::1]` are accepted. Sound Studio does not talk to remote ComfyUI servers. Even so, any other program on this device can reach an open ComfyUI port, so keep ComfyUI bound to loopback.

### Readiness checks

| Check | What it reports |
|---|---|
| ComfyUI folder | The detected or chosen install and its layout. **Choose folder** when none was found. |
| ComfyUI server | The version and address, and whether Sound Studio started it. **Start** when it is not running. |
| Graphics processor | The devices and VRAM that ComfyUI reports. A warning when it reports only the processor. |
| Audio output node | Whether Sound Studio's WAV output node is installed and loaded (below). **Install** or **Restart ComfyUI** when needed. |
| Effects model, Music model | Whether the selected model is ready, with the checkpoint in use, or what is missing. **Download** when a default model file is missing, otherwise **Model Settings** opens that workspace's models. |

The header reads **Local backends ready** when nothing is blocked. Checks report only what ComfyUI and the folder actually show; they do not measure performance.

### Audio output node

ComfyUI's own **Save Audio** node encodes through PyAV and FFmpeg. On some PCs, such as those whose application control policy blocks FFmpeg's libraries, PyAV cannot load and every audio save fails. Sound Studio therefore installs a small node, **Save Audio WAV (Sound Studio)** (`SoundStudioSaveWAV`), that writes 16-bit PCM WAV with Python's standard library. When ComfyUI has it, Sound Studio uses it for every job, including imported workflows; otherwise it falls back to Save Audio.

- **Start local ComfyUI** installs or updates it in `custom_nodes\sound_studio_nodes\__init__.py` of the ComfyUI folder before starting. The **Install** action does the same for a ComfyUI that is already running, and restarts it if Sound Studio started it.
- The file begins with `# Managed by Sound Studio.`. Sound Studio never overwrites a file at that path without this marker, and it writes nothing else into the ComfyUI folder.
- ComfyUI loads custom nodes only when it starts. A ComfyUI you started yourself needs a restart to pick it up.

### Let Sound Studio start ComfyUI

Sound Studio looks for ComfyUI in usual places such as `%LOCALAPPDATA%\ComfyUI` or your Desktop and fills in the **ComfyUI folder** field. When it finds one, choose **Start local ComfyUI**, either in the Backend connections dialog or on the empty preview canvas. That single click starts ComfyUI and connects to it.

It recognizes two layouts:

- **Portable build:** the `ComfyUI_windows_portable` folder, with `python_embeded\python.exe` and `ComfyUI\main.py`. You can choose either that folder or its `ComfyUI` subfolder. Windows only.
- **Source checkout:** a folder with `main.py` and a `venv` or `.venv` virtual environment.

- If ComfyUI is somewhere else, choose the folder icon beside the field and pick it. Sound Studio remembers that choice.
- Sound Studio runs that install's own Python with `main.py --listen 127.0.0.1 --port <port> --disable-auto-launch` (the port comes from the address), waits up to five minutes for it to answer, and then connects. The first start can be slow while ComfyUI loads custom nodes. If ComfyUI is already running at the address, Sound Studio connects to it instead of starting a second copy.
- **Stop ComfyUI** ends that process. It is refused while a generation is running. Sound Studio also stops it when you quit. On the next launch, choose **Start local ComfyUI** again.
- **Disconnect** stops checking a ComfyUI you started yourself, including on later launches, until you start or connect again.
Sound Studio only stops a ComfyUI it started itself. Console output goes to `logs\comfyui.log` in the app profile; if it stops unexpectedly, choose **Show log** to find it. A folder you pick is stored in `comfyui-launcher.json` in the profile. The ComfyUI Desktop app (which listens on port 8000) cannot be started from here: start it yourself and connect to its address.

## Models

Effects and Music each have their own model choice; the Decomposer has none yet and shows **Analysis models / Not connected**, and Model Settings opened from it shows Effects. The defaults are Stable Audio Open 1.0 for Effects and ACE-Step 1.5 Turbo for Music. Stable Audio Open plus T5 also covers short instrumental music (1-47 seconds, no lyrics or key control), so you can reuse it in Music instead of installing another model if that meets your needs. ACE-Step retains lyrics, tempo, key and longer songs; its approximately 12 GB GPU-memory guidance is higher than Stable Audio Open's 6 GB.

Choose **Effects** or **Music** from the **Task** dropdown in Model Settings. This changes only which task's settings you are viewing, not the active workspace or its draft.

**Your computer** is shown without expanding Advanced: OS/architecture, CPU and total/available system RAM measured by the desktop app, separately from each GPU's name and total/free memory reported by ComfyUI. **Refresh** remeasures the host and refreshes an already connected backend; it never connects a disconnected backend or changes saved settings. Unknown or invalid memory stays unknown. CPU devices are not reported as GPUs, GPU memory is never added across devices, and unified/shared memory is not treated as dedicated VRAM. The renderer-only browser preview cannot measure host hardware and says so.

The shared planning target is **32 GB system RAM**, with **64 GB and CUDA preferred**, not a promise that every local model fits. GPU memory, model files, nodes and architecture still matter. The current model card shows **Recommended setup** or **Your saved choice**, Local/Remote execution, requirements, observed fit and readiness. Remote warnings, setup issues, download progress/cancellation and saving errors remain outside Advanced. Settings save automatically. **Use recommended setup** restores only the selected task's model and Automatic file choices; it leaves the other task, backend address, cloud consent/key and workspace drafts untouched. It does not download or generate anything.

Choosing another model, a specific file, a custom workflow or a cloud partner model is under **Advanced**, which starts collapsed every time you open Model Settings, including with saved custom choices. Every alternative shows concise requirements before selection: existing local GPU-memory estimates, no local inference GPU for cloud partners, or workflow-dependent requirements. Model details under Advanced retain length limits, lyrics/key support, license and source. This implements the [shared model-settings UX plan](docs/model-settings-ux-plan.md) without a shared package or backend.

### Download the default models

Sound Studio can download the local models below straight into the `models` folder of the ComfyUI install it starts. It offers this once, right after **Start local ComfyUI**, for the selected Effects and Music models. You can also choose **Download** in the readiness checks, in the Generate panel or in Model Settings.

- Nothing downloads without confirmation. A Windows dialog lists each file with its size, Hugging Face repository, license and URL, the folder it will be saved to, and notes that each file is checked against a published SHA-256 hash. Downloading means you accept those licenses.
- Files come only from `huggingface.co` at a pinned revision, over HTTPS. Redirects are followed only to Hugging Face hosts.
- Each file is written to a hidden `.part` file, checked for exact size and SHA-256, and only then saved under its final name. A failed, cancelled or mismatched download leaves nothing behind. An existing file is never overwritten; if a different file already has the name, the download stops and says so.
- Sound Studio checks free disk space first and stops a download that stalls for two minutes.
- Progress shows wherever the download button was. You can keep working or choose **Cancel**. When it finishes, Sound Studio refreshes the readiness checks.
- Downloads need a ComfyUI install that Sound Studio found or that you chose with the folder button. For a ComfyUI you started elsewhere, follow **How to set up *model* manually** under Advanced.

### On this device

These open-weight models run through ComfyUI's built-in nodes. Sound Studio can download each of them as described above. To download them yourself, use the linked source and accept any license terms there.

| Model | Workspaces | File | Notes |
|---|---|---|---|
| Stable Audio Open 1.0 | Effects, Music | `models/checkpoints/stable-audio-open-1.0.safetensors` from [Comfy-Org/stable-audio-open-1.0](https://huggingface.co/Comfy-Org/stable-audio-open-1.0) (4.5 GB) and `models/text_encoders/t5-base.safetensors` from [google-t5/t5-base](https://huggingface.co/google-t5/t5-base) (850 MB) | 1-47 s. Stability AI Community License (free below US$1M annual revenue); T5-base is Apache-2.0. About 6 GB VRAM suggested. |
| ACE-Step 1.5 Turbo | Music | `models/checkpoints/ace_step_1.5_turbo_aio.safetensors` from [Comfy-Org/ACE-Step-1.5](https://huggingface.co/Comfy-Org/ACE-Step-1.5) (9.3 GB) | 10-600 s, lyrics, tempo and key. Apache-2.0 as published by Comfy-Org. About 12 GB VRAM suggested. |
| ACE-Step v1 3.5B | Music | `models/checkpoints/ace_step_v1_3.5b.safetensors` from [Comfy-Org/ACE-Step_ComfyUI_repackaged](https://huggingface.co/Comfy-Org/ACE-Step_ComfyUI_repackaged) (7.2 GB) | 5-240 s, lyrics. Apache-2.0. About 10 GB VRAM suggested. |

Sound Studio picks a matching checkpoint automatically, or you can choose a specific file. The file list puts the files that match the model first. If a saved choice doesn't look like the selected model but a matching file is installed, the model shows **NEEDS SETUP** and offers **Use *matching file* instead** without opening Advanced, which switches back to Automatic in one click. The Generate panel only flags backend checks for the workspace you are in. Hardware fit compares suggested GPU memory with the most free memory on a single reported device, not the sum or total capacity alone. It is advisory, never a compatibility guarantee or a measurement of real performance, and does not block remote inference for lack of a local GPU.

### Cloud partner models (opt-in)

[Mirelo SFX 2.0](https://docs.comfy.org/built-in-nodes/MireloTextToSFX) and [ByteDance Seed Audio 1.0](https://docs.comfy.org/built-in-nodes/ByteDanceSeedAudio) are hosted models that ComfyUI reaches through its partner nodes. **Your prompt and settings leave this device** and go to Comfy.org and the provider, and the job is charged to your Comfy.org credits.

To use them:

1. Update ComfyUI to a build that includes the partner node.
2. Create an API key at [platform.comfy.org](https://platform.comfy.org) and add credits.
3. In Model Settings, store the key under **Cloud partner models**, then tick **Allow cloud partner models**.

Before you generate, the action note names the provider and estimates the cost from ComfyUI's listed price. Prices may change, and your Comfy.org account is the authority.

The key is encrypted with the operating system's secure storage (DPAPI on Windows) in `cloud-access.json` in the app profile. It is never written in plain text. If the OS cannot encrypt, the key is not stored. The key never reaches the renderer, and it is attached only to jobs that use partner nodes. **Remove key** deletes it and turns cloud models off.

Seed Audio has no length control, so the requested duration is written into the prompt and the result may be longer or shorter. Its maximum seed is 2,147,483,647.

### Your ComfyUI workflow

Use **Custom ComfyUI workflow** for models that ComfyUI runs through custom nodes, such as **MusicGen** or **DiffRhythm 2**, or for any audio graph you have built.

1. Install the custom nodes and models, and check that the workflow runs in ComfyUI.
2. Replace hard-coded inputs with placeholders. Use `{{prompt}}` or `{{tags}}`, plus any of `{{negative}}`, `{{lyrics}}`, `{{seconds}}`, `{{seed}}`, `{{bpm}}`, `{{key}}` and `{{title}}`.
3. End the graph with exactly one **Save Audio** node (or **Save Audio WAV (Sound Studio)**), then choose **Workflow > Export (API)**. When ComfyUI has the Sound Studio node, Sound Studio swaps it in for Save Audio.
4. In Model Settings choose **Import workflow JSON**.

When an input's whole value is a placeholder, such as `"{{seed}}"`, it is replaced with the typed value, so numbers stay numbers. Placeholders inside longer text are replaced as text. Sound Studio checks that ComfyUI has every node the workflow uses. It warns, and requires the cloud opt-in, if the workflow contains partner nodes. `{{bpm}}` and `{{key}}` are music-only.

A MusicGen-style example:

```json
{
  "1": { "class_type": "MusicgenGenerate", "inputs": { "prompt": "{{prompt}}", "duration": "{{seconds}}", "seed": "{{seed}}" } },
  "2": { "class_type": "SaveAudio", "inputs": { "audio": ["1", 0], "filename_prefix": "musicgen" } }
}
```

Node and input names depend on the custom node pack you install. Export your own working graph rather than copying this example.

## Workspaces and workflow

### Effects

Write a take name and description, then choose a category, duration, optional seed and seamless-loop intent. Seamless loop asks the model for a loopable sound and plays the take on repeat; seamlessness is not guaranteed.

### Music

Write a musical brief and choose genre, mood, duration and tempo. Choose a key when the model supports it. Clear **Instrumental only** to add lyrics with section tags such as `[verse]` and `[chorus]`. Models that cannot sing say so.

### Decomposer

Write an analysis name and breakdown goal, choose an analysis focus (`Full breakdown`, `Stems & arrangement`, `Tempo & harmony`, `Lyrics & vocals` or `Variation brief`), set character/mood, excerpt window and reference tempo, and toggle stem separation and lyric transcription intentions. Sample breakdowns cover synthwave stem and groove study, harmonic movement analysis and vocal/lyric transcription planning.

Options are draft intentions, not promises of model support. There is deliberately no executable analysis contract yet, and the Decomposer never reaches model selection, readiness checks, downloads or ComfyUI. Numeric fields may retain incomplete or out-of-range edits; future inference adapters must validate their actual model-specific constraints before execution.

### Steps

1. **Describe:** edit your brief or load a sample brief. Sample briefs are text only; loading one never generates audio.
2. **Generate:** check the brief and the model summary, then generate. The panel lists anything that must be fixed first. While a job runs it shows queued or generating progress and a **Cancel** button.
3. **Review & refine:** play the selected take, seek, and choose other takes under **Recent takes**.
4. **Export:** save the selected take.

Navigating to a step never marks work complete. Each workspace runs one job at a time. Jobs live in the running app; if you close it, ComfyUI may still finish the job, but the result is not collected as a take.

In the Decomposer the same four steps plan a breakdown instead: **Decompose** lists the planned analysis stages, **Review & refine** lists the review layers, and every audio action stays disabled with the reason "Not available yet". From its Export step, **Send brief to Music workspace** transfers a structured variation brief, mood, duration, tempo and vocal intention into Music's Describe step. No audio is generated or analyzed. Effects, Music and Decomposer keep their drafts and selected steps independently.

## Takes, export and provenance

A take is saved only after ComfyUI reports success and the returned file passes validation: a readable WAV or FLAC with audio data, under 1 GB. The waveform is drawn from the decoded audio, and a take that appears silent is flagged.

Takes are stored in the app profile under `takes/`. Each has an audio file and a JSON record of the request, model, seed, workflow and audio details. On Windows the profile is `%APPDATA%\Sound Studio`. The library lists takes from both workspaces. Records it cannot read are counted and left untouched. Deleting asks for confirmation and removes the take's files.

**Export** copies the original audio file unchanged and writes `<name>.provenance.json` beside it. That file records the prompt, model and provider, parameters, seed, the exact ComfyUI workflow and the creation time.

## Storage and privacy

- **Drafts:** local storage under `sound-studio.workspace.v1`, schema version 2. All three drafts, the selected tab and each selected step are saved. Version 1 drafts migrate automatically, and saved data without a Decomposer draft gets the default one.
- **Connection and model choices:** `sound-studio.backend.v1`.
- **Chosen ComfyUI folder:** `comfyui-launcher.json` in the profile, with the ComfyUI console log in `logs\comfyui.log`.
- **Cloud key:** encrypted in the profile, as described above.
- **Takes:** the profile's `takes` folder.

Drafts and choices are unencrypted convenience storage, not a portable project format or backup. Do not put credentials in prompts.

With cloud partner models off, nothing leaves this device except requests to your loopback ComfyUI. There is no telemetry.

If saved data cannot be read or has an unknown format, an error banner appears and the stored copy is preserved. New edits stay in memory and do not overwrite it. If writes fail, the app says edits are not saved. To recover, first copy any needed text. Then open developer tools with Ctrl+Shift+I, inspect Application > Local Storage, back up or remove only the affected key, and reload.

## Architecture

| Location | Responsibility |
|---|---|
| `src/main` | Lifecycle and window security. Also: the ComfyUI client (`comfyui.ts`), job monitor (`generation.ts`), take store (`takes.ts`), encrypted cloud access (`cloud.ts`), the ComfyUI launcher (`launcher.ts`, `comfyInstall.ts`), the WAV output node installer (`outputNode.ts`), the model downloader (`modelDownload.ts`) and validated IPC handlers (`ipc.ts`). |
| `src/preload` | A narrow, typed bridge (`window.soundStudio`). It has no generic IPC, filesystem or shell access. |
| `src/renderer` | React workspaces, Backend connections, Model Settings, the take player, backend state, dialogs and draft storage. |
| `src/shared` | Draft schema and migration, model profiles, readiness and backend checks, request validation, workflow builders and audio inspection. |
| `tests` | Unit tests for drafts, generation contracts and audio parsing. |
| `scripts` | The Electron smoke test, a mock ComfyUI test fixture and screenshot capture. |

Electron uses context isolation, sandboxing and disabled Node integration. Window-open requests, navigation, webviews and permission requests are denied. The content security policy limits the renderer to app resources and blob audio.

Every IPC call is validated again in the main process: loopback endpoints, generation requests, custom workflows and take IDs. The main process builds the ComfyUI graph, sends it, follows progress over WebSocket and history polling, and downloads and validates the output. The renderer never receives the API key or arbitrary file paths.

The launcher accepts a ComfyUI folder only from the main-process folder picker or its own detection, never from the renderer. It runs only a recognized layout's own Python, without a shell, with fixed arguments that bind ComfyUI to loopback. It never stops a process it did not start. The only file it writes into the ComfyUI folder is the marked output node, resolved inside that folder's `custom_nodes` and written atomically.

The model downloader accepts only catalog IDs from the renderer, never URLs or paths. The main process resolves the target inside the launcher's `models` folder, asks for confirmation in a native dialog, and fetches the pinned Hugging Face URL itself, as described in [Download the default models](#download-the-default-models).

## Development and validation

```powershell
npm test
npm run typecheck
npm run build
npm run test:desktop
```

`npm test` covers drafts and migration, model profiles, the model download catalog and downloader (host allowlist, redirects, size and SHA-256 checks, no overwrites, confirmation), ComfyUI install detection and launch arguments, output node installation, readiness checks, the loopback endpoint policy, request validation, workflow builders and output node selection, custom workflow placeholders, readiness and cloud gating, history interpretation and WAV/FLAC parsing.

Hardware and settings regression coverage includes invalid/missing memory, CPU-only and unified-memory reports, separate GPU budgets, free-versus-total thresholds, requirement labels and task-scoped recommendation resets. The desktop smoke also checks measured host details, browser-only hardware unavailability, collapsed saved-custom settings, cloud-consent preservation and file correction without expanding Advanced.

`npm run test:desktop` builds and launches the real Electron app with an isolated temporary profile. It runs against `scripts/mock-comfyui.mjs`, a test fixture that speaks the ComfyUI HTTP and WebSocket API and returns a synthesized test tone. The smoke test covers:

- Connection policy, the first-run check and the readiness checks.
- One-click start from the canvas and dialog, output node installation, stop, and stop-on-quit for a fake ComfyUI install (`scripts/fake-comfyui-install.mjs`), which needs Python and is skipped without it. With that install, it also checks that the download offer appears and that declining it writes nothing.
- Local, failed and cancelled jobs.
- Cloud opt-in and API-key handling.
- ACE-Step and custom workflow graphs.
- Decomposer planning, its disabled actions and the brief handoff to Music.
- Playback, export with provenance and library delete.
- Relaunch persistence, corrupt storage and the minimum window size.

**The smoke test proves Sound Studio's job handling, not model output quality.** Check real generation against your own ComfyUI. The smoke test needs a graphical desktop session but no GPU or models.

Capture the actual app for documentation:

```powershell
npm run screenshots
```

This runs the same checks and writes `effects-workspace.png`, `model-settings.png`, `music-workspace.png`, `decomposer-workspace.png` and `backend-connections.png` to `docs/screenshots`. They are captured before connecting to the mock, so they never show test-fixture audio. Inspect captures before committing; never use mockups as evidence of working generation or decomposition.

## Troubleshooting

| Symptom | Action |
|---|---|
| "ComfyUI is not reachable" | Start ComfyUI, check the port in its console and choose **Refresh** in Backend connections. |
| "main.py was not found" or "not its Python environment" | Choose the portable build's root folder, or a source checkout with a `venv` or `.venv`. For the ComfyUI Desktop app, start it yourself and connect. |
| ComfyUI stops or never answers after **Start local ComfyUI** | Choose **Show log** and read the end of `comfyui.log`. Common causes are a busy port, a missing Python package or a failing custom node. |
| Jobs fail in Save Audio or Preview Audio, mentioning PyAV, `av` or FFmpeg | ComfyUI's audio encoder cannot load on this PC. Install the Sound Studio output node from the **Audio output node** check, or choose **Start local ComfyUI**, which installs it, and restart ComfyUI. |
| "...was not created by Sound Studio" | A different file sits at `custom_nodes\sound_studio_nodes\__init__.py`. Move it away if you do not need it, then choose **Install** again. |
| "Only ComfyUI running on this device..." | Remote servers are not supported. Run ComfyUI locally on loopback. |
| A model shows **NEEDS SETUP** | Follow the listed issues. For a missing default model, choose **Download**. Missing nodes need a newer ComfyUI or custom nodes. Other missing files need to go in the named `models` folder; then choose **Refresh**, restarting ComfyUI if needed. |
| A model download fails | The message says why: no network, too little disk space, a stalled connection, or a size or SHA-256 mismatch. Nothing partial is kept, so choose **Download** again. If "a different file already exists", move that file away first. |
| "...does not look like the *model* checkpoint" | A file for a different model is selected. In Model Settings, choose **Use *matching file* instead** or pick **Automatic**. |
| Cloud models stay disabled | Store a Comfy.org API key first, then tick **Allow cloud partner models**. If encryption is unavailable, the key cannot be stored. |
| ComfyUI rejects the workflow | The message lists failing nodes and inputs. Check model files and custom nodes in ComfyUI itself. |
| A job fails with an out-of-memory error | Choose a shorter duration or a smaller model, or close other GPU applications. |
| An imported workflow is rejected | Use **Export (API)**, not the regular save. Include `{{prompt}}` or `{{tags}}` and exactly one Save Audio node. |
| A take is flagged as silent | The file is kept. Check the model and prompt in ComfyUI. |
| The launcher reports a missing build | Run `npm run build`, then launch again. |
| Desktop smoke cannot launch a window | Run it in an interactive graphical session. |

## Design reference

The layout takes its direction from [rwrife/CharacterStudio](https://github.com/rwrife/CharacterStudio), inspected at commit `c4497c1c7f148786c102d7fb5e6998f2c62b4ff7`: header workspace tabs, contextual left settings, a connected chevron stepper and a large central working surface. Documentation follows its concise README, detailed guide and agent guidance split.
