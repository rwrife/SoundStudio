# Sound Studio guide

## Current scope

Sound Studio is an Electron, React and TypeScript desktop app for AI sound effects and music. It follows Character Studio's workflow-first layout, with a blue rather than green palette. Generation is delegated to a [ComfyUI](https://github.com/comfyanonymous/ComfyUI) server that you run on the same device.

**Implemented:**
- Effects and Music workspaces with independent drafts.
- A loopback-only ComfyUI connection with version, device and model-file checks.
- Starting and stopping your own ComfyUI install, optionally when Sound Studio opens.
- Model profiles with readiness checks, hardware-fit guidance and per-model input limits.
- Generation jobs with live progress, honest failure and cancellation states, and a one-hour limit.
- Validation of returned audio before it becomes a take.
- Playback with waveforms drawn from the decoded file.
- A local take library with delete.
- Export of the original file with a provenance record.
- Opt-in cloud partner models with an encrypted API key.
- Imported custom ComfyUI workflows.

**Not implemented:**
- Model downloads, installing or updating ComfyUI, and starting the ComfyUI Desktop app.
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
2. Start ComfyUI, either from Sound Studio (below) or yourself. It listens on `http://127.0.0.1:8188` by default.
3. In Sound Studio choose **Backend not connected**, check the address and choose **Connect**. The dialog shows the ComfyUI version, devices with VRAM, and the number of checkpoints found. Sound Studio reconnects on the next launch until you choose **Disconnect**.
4. Open **Model Settings**, pick a model for each workspace and follow its setup steps until it shows **READY**. After adding model files, restart ComfyUI (or refresh its model list) and choose **Recheck**.

Only `127.0.0.1`, `localhost` and `[::1]` are accepted. Sound Studio does not talk to remote ComfyUI servers. Even so, any other program on this device can reach an open ComfyUI port, so keep ComfyUI bound to loopback.

### Let Sound Studio start ComfyUI

The **Start ComfyUI for me** section of the Backend connections dialog runs an existing install. It recognizes two layouts:

- **Portable build:** the `ComfyUI_windows_portable` folder, with `python_embeded\python.exe` and `ComfyUI\main.py`. You can choose either that folder or its `ComfyUI` subfolder. Windows only.
- **Source checkout:** a folder with `main.py` and a `venv` or `.venv` virtual environment.

1. Choose **Browse...** and pick the folder, or choose **Use this folder** when Sound Studio finds one in a usual place such as `%LOCALAPPDATA%\ComfyUI` or your Desktop.
2. Check the address, then choose **Start ComfyUI**. Sound Studio runs that install's own Python with `main.py --listen 127.0.0.1 --port <port> --disable-auto-launch`, waits up to five minutes for it to answer, and then connects. The first start can be slow while ComfyUI loads custom nodes.
3. **Stop ComfyUI** ends that process. It is refused while a generation is running. Sound Studio also stops it when you quit.
4. Tick **Start ComfyUI when Sound Studio opens** to start it automatically next time. If ComfyUI is already running at the address, Sound Studio connects to it instead of starting a second copy.

Sound Studio only stops a ComfyUI it started itself. Console output goes to `logs\comfyui.log` in the app profile; choose **Show log** to find it. The folder and start-on-launch choice are stored in `comfyui-launcher.json` in the profile. The ComfyUI Desktop app (which listens on port 8000) cannot be started from here: start it yourself and connect to its address.

## Models

Each workspace has its own model choice. Model Settings lists models in three groups and shows readiness, length limits, lyrics and key support, hardware fit, license and source.

### On this device

These open-weight models run through ComfyUI's built-in nodes. Download them from the linked source and accept any license terms there.

| Model | Workspaces | File | Notes |
|---|---|---|---|
| Stable Audio Open 1.0 | Effects, Music | `models/checkpoints/stable-audio-open-1.0.safetensors` and `models/text_encoders/t5-base.safetensors` | 1-47 s. Stability AI Community License. About 6 GB VRAM suggested. |
| ACE-Step 1.5 Turbo | Music | `models/checkpoints/ace_step_1.5_turbo_aio.safetensors` | 10-600 s, lyrics, tempo and key. MIT. About 12 GB VRAM suggested. |
| ACE-Step v1 3.5B | Music | `models/checkpoints/ace_step_v1_3.5b.safetensors` | 5-240 s, lyrics. Apache-2.0. About 10 GB VRAM suggested. |

Sound Studio picks a matching checkpoint automatically, or you can choose a specific file. Hardware fit compares the suggested VRAM with what ComfyUI reports. It is guidance, not a measurement of real performance.

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
3. End the graph with exactly one **Save Audio** node, then choose **Workflow > Export (API)**.
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

### Steps

1. **Describe:** edit your brief or load a sample brief. Sample briefs are text only; loading one never generates audio.
2. **Generate:** check the brief and the model summary, then generate. The panel lists anything that must be fixed first. While a job runs it shows queued or generating progress and a **Cancel** button.
3. **Review & refine:** play the selected take, seek, and choose other takes under **Recent takes**.
4. **Export:** save the selected take.

Navigating to a step never marks work complete. Each workspace runs one job at a time. Jobs live in the running app; if you close it, ComfyUI may still finish the job, but the result is not collected as a take.

## Takes, export and provenance

A take is saved only after ComfyUI reports success and the returned file passes validation: a readable WAV or FLAC with audio data, under 1 GB. The waveform is drawn from the decoded audio, and a take that appears silent is flagged.

Takes are stored in the app profile under `takes/`. Each has an audio file and a JSON record of the request, model, seed, workflow and audio details. On Windows the profile is `%APPDATA%\Sound Studio`. The library lists takes from both workspaces. Records it cannot read are counted and left untouched. Deleting asks for confirmation and removes the take's files.

**Export** copies the original audio file unchanged and writes `<name>.provenance.json` beside it. That file records the prompt, model and provider, parameters, seed, the exact ComfyUI workflow and the creation time.

## Storage and privacy

- **Drafts:** local storage under `sound-studio.workspace.v1`, schema version 2. Version 1 drafts migrate automatically.
- **Connection and model choices:** `sound-studio.backend.v1`.
- **ComfyUI folder and start-on-launch:** `comfyui-launcher.json` in the profile, with the ComfyUI console log in `logs\comfyui.log`.
- **Cloud key:** encrypted in the profile, as described above.
- **Takes:** the profile's `takes` folder.

Drafts and choices are unencrypted convenience storage, not a portable project format or backup. Do not put credentials in prompts.

With cloud partner models off, nothing leaves this device except requests to your loopback ComfyUI. There is no telemetry.

If saved data cannot be read or has an unknown format, an error banner appears and the stored copy is preserved. New edits stay in memory and do not overwrite it. If writes fail, the app says edits are not saved. To recover, first copy any needed text. Then open developer tools with Ctrl+Shift+I, inspect Application > Local Storage, back up or remove only the affected key, and reload.

## Architecture

| Location | Responsibility |
|---|---|
| `src/main` | Lifecycle and window security. Also: the ComfyUI client (`comfyui.ts`), job monitor (`generation.ts`), take store (`takes.ts`), encrypted cloud access (`cloud.ts`), the ComfyUI launcher (`launcher.ts`, `comfyInstall.ts`) and validated IPC handlers (`ipc.ts`). |
| `src/preload` | A narrow, typed bridge (`window.soundStudio`). It has no generic IPC, filesystem or shell access. |
| `src/renderer` | React workspaces, Model Settings, the take player, backend state, dialogs and draft storage. |
| `src/shared` | Draft schema and migration, model profiles, readiness, request validation, workflow builders and audio inspection. |
| `tests` | Unit tests for drafts, generation contracts and audio parsing. |
| `scripts` | The Electron smoke test, a mock ComfyUI test fixture and screenshot capture. |

Electron uses context isolation, sandboxing and disabled Node integration. Window-open requests, navigation, webviews and permission requests are denied. The content security policy limits the renderer to app resources and blob audio.

Every IPC call is validated again in the main process: loopback endpoints, generation requests, custom workflows and take IDs. The main process builds the ComfyUI graph, sends it, follows progress over WebSocket and history polling, and downloads and validates the output. The renderer never receives the API key or arbitrary file paths.

The launcher accepts a ComfyUI folder only from the main-process folder picker or its own detection, never from the renderer. It runs only a recognized layout's own Python, without a shell, with fixed arguments that bind ComfyUI to loopback. It never stops a process it did not start.

## Development and validation

```powershell
npm test
npm run typecheck
npm run build
npm run test:desktop
```

`npm test` covers drafts and migration, model profiles, ComfyUI install detection and launch arguments, the loopback endpoint policy, request validation, workflow builders, custom workflow placeholders, readiness and cloud gating, history interpretation and WAV/FLAC parsing.

`npm run test:desktop` builds and launches the real Electron app with an isolated temporary profile. It runs against `scripts/mock-comfyui.mjs`, a test fixture that speaks the ComfyUI HTTP and WebSocket API and returns a synthesized test tone. The smoke test covers:

- Connection policy.
- Starting, stopping and start-on-launch for a fake ComfyUI install (`scripts/fake-comfyui-install.mjs`), which needs Python and is skipped without it.
- Local, failed and cancelled jobs.
- Cloud opt-in and API-key handling.
- ACE-Step and custom workflow graphs.
- Playback, export with provenance and library delete.
- Relaunch persistence, corrupt storage and the minimum window size.

**The smoke test proves Sound Studio's job handling, not model output quality.** Check real generation against your own ComfyUI. The smoke test needs a graphical desktop session but no GPU or models.

Capture the actual app for documentation:

```powershell
npm run screenshots
```

This runs the same checks and writes `effects-workspace.png`, `model-settings.png` and `music-workspace.png` to `docs/screenshots`. They are captured before connecting to the mock, so they never show test-fixture audio. Inspect captures before committing.

## Troubleshooting

| Symptom | Action |
|---|---|
| "ComfyUI is not reachable" | Start ComfyUI, check the port in its console and choose **Recheck**. |
| "main.py was not found" or "not its Python environment" | Choose the portable build's root folder, or a source checkout with a `venv` or `.venv`. For the ComfyUI Desktop app, start it yourself and connect. |
| ComfyUI stops or never answers after **Start ComfyUI** | Choose **Show log** and read the end of `comfyui.log`. Common causes are a busy port, a missing Python package or a failing custom node. |
| "Only ComfyUI running on this device..." | Remote servers are not supported. Run ComfyUI locally on loopback. |
| A model shows **NEEDS SETUP** | Follow the listed issues. Missing nodes need a newer ComfyUI or custom nodes. Missing files need to go in the named `models` folder; then restart ComfyUI and choose **Recheck**. |
| Cloud models stay disabled | Store a Comfy.org API key first, then tick **Allow cloud partner models**. If encryption is unavailable, the key cannot be stored. |
| ComfyUI rejects the workflow | The message lists failing nodes and inputs. Check model files and custom nodes in ComfyUI itself. |
| A job fails with an out-of-memory error | Choose a shorter duration or a smaller model, or close other GPU applications. |
| An imported workflow is rejected | Use **Export (API)**, not the regular save. Include `{{prompt}}` or `{{tags}}` and exactly one Save Audio node. |
| A take is flagged as silent | The file is kept. Check the model and prompt in ComfyUI. |
| The launcher reports a missing build | Run `npm run build`, then launch again. |
| Desktop smoke cannot launch a window | Run it in an interactive graphical session. |

## Design reference

The layout takes its direction from [rwrife/CharacterStudio](https://github.com/rwrife/CharacterStudio), inspected at commit `c4497c1c7f148786c102d7fb5e6998f2c62b4ff7`: header workspace tabs, contextual left settings, a connected chevron stepper and a large central working surface. Documentation follows its concise README, detailed guide and agent guidance split.
