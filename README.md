# Sound Studio

## Imagine the sound. Set the mood.

**A local-first home for AI sound effects and music, built for the worlds you create.**

Sketch the crackle of a campfire, the perfect interface chime, the soundtrack to somewhere new, or a breakdown of a song you want to study. Sound Studio gives you three creative workspaces in one blue-toned desktop application, inspired by [Character Studio](https://github.com/rwrife/CharacterStudio). Generation runs on **your own [ComfyUI](https://github.com/comfyanonymous/ComfyUI)** on this device.

**Early preview.** Sound Studio drives a ComfyUI that you install. It can start ComfyUI and, after confirmation, download and verify default generation models. **Decomposer** independently analyses existing recordings using a managed local CPU runtime: import, listen, separate stems, estimate timing/harmony and transcribe lyrics. Runtime and optional model downloads are explicit.

[Get started](#getting-started) | [Features](#features-at-a-glance) | [Models](#models) | [Future directions](#future-directions) | [Full guide](GUIDE.md)

![Sound Studio's Effects workspace with a blue workflow stepper, prompt panel and empty audio canvas](docs/screenshots/effects-workspace.png)

*The actual Effects workspace before connecting to ComfyUI.*

## Features at a glance

| Shape the small details | Set the bigger scene |
|---|---|
| **Effects workspace.** Describe ambience, foley, interface sounds and more, with category, duration, seed and loop intent. | **Music workspace.** Set genre, mood, duration, tempo, key and lyrics when your model can sing. |
| **Generate on your machine.** Sound Studio can start your ComfyUI for you, send it a validated workflow, follow its progress and cancel at any time. | **Hear every take.** Play takes, see waveforms drawn from the real audio, and compare recent takes. |
| **Export with provenance.** Copy the original file and a `.provenance.json` that records the prompt, model, settings and workflow. | **Ideas that stay with you.** Drafts, takes and model choices stay on this device and survive restarts. |
| **Study a recording.** Decomposer previews real audio and stems, estimates beats/key/chords, transcribes lyrics and extracts MIDI. Edit findings without replacing raw results, reopen analyses and export with provenance. | **Keep your creative decisions.** Send a reviewed brief to Music with explicit append/replace confirmation. Samples and unanalysed goals remain text-only intent. |

![Sound Studio's Model Settings drawer showing the current model, its readiness and a collapsed Advanced section](docs/screenshots/model-settings.png)

*Model Settings shows your computer, the current task's Local/Remote model and what needs setup. Advanced stays collapsed until you need other choices; Use recommended setup restores only the selected task. Choices save automatically.*

## Models

| Workspace | Runs on this device | Cloud partner (opt-in) | Your workflow |
|---|---|---|---|
| Effects | Stable Audio Open 1.0 | Mirelo SFX 2.0, ByteDance Seed Audio 1.0 | Any ComfyUI audio workflow |
| Music | ACE-Step 1.5 Turbo, ACE-Step v1 3.5B, Stable Audio Open 1.0 | None | MusicGen, DiffRhythm 2 and other custom nodes |
| Decomposer | Librosa DSP, HTDemucs, Whisper tiny/base, Basic Pitch, Qwen2.5-Omni Q4 | None | Managed CPU runtime |
- **On this device:** open-weight models run by ComfyUI's built-in nodes. Sound Studio downloads the ones you need from Hugging Face after you confirm, and checks each file's SHA-256 before using it. Stable Audio Open and T5-base for Effects are about 5.4 GB; ACE-Step 1.5 Turbo for Music is about 9.3 GB.
- **Cloud partner models:** run by a third-party service through ComfyUI partner nodes. They need your explicit opt-in and a Comfy.org API key, encrypted on this device. Charges apply, and an estimate is shown before you generate.
- **Your workflow:** export any working ComfyUI audio workflow in API format, add placeholders such as `{{prompt}}` and `{{seconds}}`, and import it.

![Sound Studio's Music workspace with genre, mood, tempo and key controls](docs/screenshots/music-workspace.png)

*The actual Music workspace, with ACE-Step 1.5 selected and no ComfyUI connected.*

![Sound Studio's Decomposer playing real separated stems with an editable breakdown](docs/screenshots/decomposer-stems.png)

*Actual HTDemucs outputs from **Let's Go Fishin' by Karissa Hobbs**, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), via [librosa's licensed example collection](https://librosa.org/data/audio/Karissa_Hobbs_-_Lets_Go_Fishin.txt). No audio or weights are committed. Estimates and sung lyrics need human review.*

Optional **Qwen2.5-Omni Q4** descriptions add timed, qualitative observations about audible sources, performance, energy and changes. This explicitly installed local profile needs existing Windows C++ build tools and 10 GiB available RAM; descriptions remain editable estimates. The separate full-precision Qwen2-Audio profile remains unverified. Neither profile downloads implicitly or falls back to cloud inference. See the [Decomposer guide](docs/DECOMPOSER.md) for setup, limitations and real-output evidence.

## Basic requirements

- Node.js **22.12 or newer** and npm.
- A desktop environment supported by Electron. Development and testing happen on Windows; other platforms are not yet verified.
- To generate, a recent [ComfyUI](https://github.com/comfyanonymous/ComfyUI) running on this device, plus at least one model. Local models need a capable GPU; ACE-Step 1.5 suggests about 12 GB of VRAM.
- Shared planning target with Character Studio: **32 GB system RAM**, with **64 GB and CUDA preferred**. This is not a model-fit guarantee. Stable Audio Open suggests about 6 GB GPU memory and can cover short instrumental music too; ACE-Step's higher-memory default retains lyrics and full-song controls. Model Settings shows measured memory separately from these estimates.
- To analyse, Windows x64 (including x64 emulation on Windows ARM64), disk space for the managed Python runtime and selected models. Decomposer does not require ComfyUI or system FFmpeg.

## Getting started

From the repository root in PowerShell:

```powershell
npm install
npm run dev
```

Sound Studio looks for ComfyUI when it opens. If it is not running, choose **Setup needs attention** in the header (or **ComfyUI is not running** in the side panel) to open **Backend connections**. If ComfyUI is installed in a usual place such as `%LOCALAPPDATA%\ComfyUI`, choose **Start local ComfyUI**: Sound Studio starts it on this device, connects, and offers to download any missing default models. Confirm, and you can generate once the download finishes. Otherwise choose your ComfyUI folder (a portable build or a source checkout with a virtual environment), or start ComfyUI yourself and enter its address. Then follow the **Readiness checks** until each one is ready.

![Sound Studio's Backend connections dialog with a Start local ComfyUI button and a list of readiness checks](docs/screenshots/backend-connections.png)

*Backend connections on a first run, before ComfyUI is started. The folder path is masked.*

On some PCs ComfyUI's own audio saving cannot load FFmpeg. Starting ComfyUI from Sound Studio installs a small WAV output node into its `custom_nodes` folder so takes save anyway. See the [guide](GUIDE.md#audio-output-node).

For a production build:

```powershell
npm run build
npm start
```

On Windows, `.\Start-SoundStudio.ps1` also opens an existing build. A browser-only UI preview, which cannot generate, is available with `npm run dev:web`.

The [desktop release workflow](.github/workflows/release.yml) prepares draft releases for Windows x64 and ARM64, macOS Apple Silicon and Linux x64. Packages are unsigned and do not bundle ComfyUI, models or analysis runtimes; see the [packaging and release guide](GUIDE.md#desktop-packages-and-releases).

See the [guide](GUIDE.md) for model setup, cloud access, custom workflows, storage and troubleshooting. Contributor and coding-agent conventions are in [AGENTS.md](AGENTS.md).

For existing recordings, open **Decomposer > Model Settings**, install **Audio + timing / harmony**, then import a recording you are entitled to process. Select optional models explicitly. Review and export actual available outputs; missing models fail with an actionable error.

## Future directions

These are goals, **not shipped capabilities**:

- Installing ComfyUI itself for first-time users.
- Variations, inpainting and loop refinement for existing takes.
- Broader hardware validation and a smaller, verified audio-description profile.
- General-purpose audio editing, a searchable asset library and project files for game and media projects.

The foundation is intentionally small: describe the idea, generate it on your own hardware and keep the record of how it was made.
