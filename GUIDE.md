# Sound Studio guide

## Current scope

Sound Studio is an Electron, React and TypeScript application shell for future local AI sound and music generation. It follows Character Studio's workflow-first layout, with a blue rather than green palette.

Implemented: Effects, Music and Decomposer navigation, contextual workflow steps, editable draft controls, local draft persistence, sample briefs and breakdowns, accessible placeholder dialogs and an empty audio canvas.

Not implemented: inference, music decomposition, lyric transcription, backend connections, hardware detection, model downloads, audio import, audio synthesis, playback, waveform analysis, editing, export, projects, searchable libraries or an MCP server. Disabled controls are intentional. Navigating to a later step never marks work complete.

## Install and run

Use Node.js 22.12+ and npm from the repository root:

```powershell
npm install
npm run dev
```

`npm run dev` starts the Electron application with renderer hot reload. `npm run build` type-checks and builds into `out`; `npm start` opens that build. `.\Start-SoundStudio.ps1` checks for dependencies and an existing build before launching it.

`npm run dev:web` serves only the renderer at `http://127.0.0.1:5173`. It is useful for visual work, but is not the desktop application. Browser preview storage is separate from the desktop profile. No remote fonts, analytics or cloud AI services are required.

## Workspaces

### Effects

Write a take name and sound description. Select a sound category, draft duration, optional seed and seamless-loop intention. Sample briefs cover ambience, interface sounds and science-fiction effects.

### Music

Write a musical brief, choose a genre and mood, and draft duration, tempo and instrumental-only intentions. Sample briefs cover cinematic, lo-fi and ambient music.

### Decomposer

Write an analysis name and breakdown goal, choose an analysis focus (`Full breakdown`, `Stems & arrangement`, `Tempo & harmony`, `Lyrics & vocals` or `Variation brief`), set character/mood, excerpt window and reference tempo, and toggle stem separation and lyric transcription intentions. Sample breakdowns cover synthwave stem and groove study, harmonic movement analysis and vocal/lyric transcription planning.

Options are draft intentions, not promises of model support. There is deliberately no executable generation or analysis contract yet. Numeric fields may retain incomplete or out-of-range edits; future inference adapters must validate their actual model-specific constraints before execution.

### The workflow

1. **Describe:** edit your brief or analysis plan, or load a sample.
2. **Generate / Decompose:** inspect the brief or planned analysis pipeline (stem separation, timing/harmony and lyric transcription stages); generation and decomposition remain disabled.
3. **Review & refine:** a placeholder for listening, inspecting stems/lyrics and comparing real takes.
4. **Export:** a placeholder for audio/breakdown output configuration; no file is created. From Decomposer's Export step, **Send brief to Music workspace** transfers your structured variation brief, mood, duration, tempo and vocal intention into the Music workspace's Describe step without generating audio.

Selecting a sample replaces the current prompt and category, returns to Describe and leaves other draft controls unchanged. It never generates or analyzes audio. Effects, Music and Decomposer keep their drafts and selected steps independently.

The header tabs support Left/Right arrows, Home and End. Dialogs contain focus while open, close with Escape and restore focus to the launcher. Settings and content scroll independently on desktop; the shell has a single-column fallback for narrow browser previews. The Electron window minimum is 960 by 700 pixels.

## Model Settings, connections and library

**Model Settings** opens separately from the workflow and shows Effects, Music or Decomposer model placeholders. None of the workspaces has a configured model. Hardware readiness is explicitly **Not checked**.

**Backend connections** explains that no inference or analysis backend is available. It does not test endpoints, start services or install anything.

**Sound library** is an honest empty state. A prompt or analysis draft is not an audio asset. The take and breakdown counts stay at zero until real asset support exists.

## Draft storage and privacy

The renderer saves a versioned state object in local storage under `sound-studio.workspace.v1`, scoped to the current Electron profile or browser origin. All three drafts, the selected tab and each selected workflow step are saved as they change. Legacy v1 states saved before the Decomposer workspace existed are upgraded in memory with default Decomposer draft values when loaded. This is convenience storage, not a portable project format or backup.

Drafts are unencrypted. Do not enter credentials or sensitive material. The shell makes no inference requests and has no telemetry, uploads or remote provider settings.

If storage cannot be read or the saved format is unrecognized, an error banner appears and the existing stored copy is preserved. New edits remain in memory and are not written over that copy. If writes fail, the application explicitly reports that edits are not saved. Keep the window open and copy important text before troubleshooting.

For recovery, first copy any needed text. In a browser preview, clear this site's storage using the browser's developer tools and reload. For Electron, open developer tools with Ctrl+Shift+I on Windows, inspect the Application > Local Storage entry for the loaded file origin, back up or remove only `sound-studio.workspace.v1`, and reload. Do not delete the whole application profile to recover a draft.

## Architecture

| Location | Responsibility |
|---|---|
| `src/main` | Electron lifecycle, window security and permission boundaries |
| `src/preload` | A read-only platform bridge; no filesystem, shell or inference APIs |
| `src/renderer` | React shell, shared blue palette, dialogs and draft storage |
| `src/shared` | Typed draft schema, workflow steps and sample briefs |
| `tests` | Draft state and workflow contract tests |
| `scripts` | Real Electron smoke checks and screenshot capture |
| `docs/screenshots` | Repository-owned captures used in the README |

Electron uses context isolation, sandboxing and disabled Node integration. Window-open requests, renderer-initiated navigation, webviews and permission requests are denied. A content security policy limits renderer resources to the app and development loopback connections. There is no arbitrary IPC bridge.

The desktop window, macOS Dock and packaged application use the same waveform artwork as the header. `src/renderer/public/icon.svg` is the source; `build/icon.png` is its committed 1024-pixel raster counterpart. After changing the SVG, run `npm run icons` in a graphical desktop session, inspect the generated PNG and commit both assets. Electron Builder converts the PNG to platform-specific application icons when packaging.

Future AI features should put inference and file access behind narrowly scoped, validated main-process APIs, never in the renderer. Keep model downloads explicit, retain provenance, preserve user assets and report actual backend errors. Do not silently substitute synthetic audio or cloud inference for a failed local model.

## Desktop packages and releases

`npm run package -- --win --x64` builds a Windows x64 ZIP containing the application. Substitute `--win --arm64`, `--mac --arm64` or `--linux --x64` for Windows ARM64 ZIP, macOS Apple Silicon DMG or Linux x64 tarball. Use the corresponding host OS for packaging; Windows ARM64 can be cross-built on Windows x64. Output goes to the ignored `release` directory. ZIP and tarball downloads must be extracted before running the application.

The **Desktop release** GitHub Actions workflow runs when a `v*` tag is pushed, or manually with an existing tag. The tag must exactly match `v` plus the `package.json` version. It runs shared tests and desktop smoke checks, builds all four packages on matching-architecture runners, smoke-checks the packaged applications, and creates a **draft GitHub release** only after every build succeeds. Review the draft and publish it manually. Reusing an already-released tag fails rather than overwriting existing release assets. Relevant pull requests run the same builds and checks without creating a release.

Windows and Linux **x86** release targets mean **x86-64 / x64**, not 32-bit x86. Packages contain only the application shell, not models or an inference backend. Downloads are currently unsigned and macOS builds are not notarized; the workflow does not claim operating-system trust or compatibility beyond its checks.

## Development and validation

```powershell
npm test
npm run typecheck
npm run build
npm run test:desktop
```

`npm test` covers independent drafts, saved-state validation and sample brief contracts. `npm run test:desktop` builds and launches the real Electron application with an isolated temporary profile. It exercises tabs, sample briefs, settings, modal focus, disabled generation and export, persistence across relaunch, corrupt storage, sandbox exposure and minimum-window layout. It requires a graphical desktop session, but no Playwright browser download or inference backend.

To run the same checks against a packaged Windows x64 application, use `node scripts/desktop-smoke.mjs --executable "release\win-unpacked\Sound Studio.exe"` after packaging. The `--executable` option also accepts a macOS application binary or Linux executable.

Capture the actual app for documentation:

```powershell
npm run screenshots
```

This runs the same desktop checks and writes `docs/screenshots/effects-workspace.png`, `docs/screenshots/music-workspace.png` and `docs/screenshots/decomposer-workspace.png`. Inspect captures before committing; never use mockups as evidence of working audio generation or decomposition.

## Troubleshooting

| Symptom | Action |
|---|---|
| Generate, Play or Export is disabled | Expected in the shell. These capabilities are not connected. |
| No backend or selected model | Expected. There is nothing to configure or install yet. |
| The launcher reports a missing build | Run `npm run build`, then launch again. |
| Dependencies or the Electron binary are missing | Run `npm install`. If your npm policy blocks lifecycle scripts, review and permit only the required packages using your organization's approved policy. |
| The browser preview port is occupied | Stop only the known process using port 5173, or run `npm run dev:web -- --port 5174`. |
| A draft could not be saved | Keep the window open, copy the text and check available disk space and site/profile storage permissions. |
| Desktop smoke cannot launch a window | Run it in an interactive graphical session. Do not infer desktop success from the browser preview alone. |

## Design reference

The shell takes its layout direction from [rwrife/CharacterStudio](https://github.com/rwrife/CharacterStudio), inspected at commit `c4497c1c7f148786c102d7fb5e6998f2c62b4ff7`: header workspace tabs, contextual left settings, a connected chevron stepper and a large central working surface. Documentation follows its concise README / detailed guide / agent guidance split. Character-processing code, model integrations and assets are not included.
