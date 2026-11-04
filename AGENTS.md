# Agent guidance

## Project goal

Sound Studio is a local-first AI sound effects and music creation studio. Help game developers and creators describe, generate, review and export audio while keeping creative decisions and user assets under their control.

Sound Studio generates audio by driving the user's own [ComfyUI](https://github.com/comfyanonymous/ComfyUI) on loopback. It can start/stop that install and explicitly download default models. Profiles include local models, opt-in cloud partner nodes and imported workflows. Takes are validated, played, saved and exported with provenance.

Decomposer independently imports and analyses existing audio using a managed Windows x64 CPU runtime, with DSP, optional HTDemucs/Whisper/Basic Pitch, editable review, durable storage and exports. The Qwen2-Audio caption path is implemented but real inference remains resource-blocked/unverified; never claim it has been validated. Analysis never uploads audio or uses cloud fallback. General-purpose editing, project files and an MCP server remain future work.

## Repository layout

- `src/main`: Electron lifecycle, window security, the ComfyUI client, job monitor, take store, encrypted cloud key, ComfyUI launcher and validated IPC.
- `src/preload`: the isolated, narrow desktop bridge.
- `src/renderer`: React workspaces, Model Settings, the take player, backend state, shared styling, dialogs and local draft storage.
- `src/shared`: workflow types, defaults, saved-state validation, model profiles, readiness, request validation, ComfyUI graph builders and audio inspection.
- `tests`: TypeScript tests for shared contracts.
- `scripts`: real Electron smoke checks, test fixtures (a mock ComfyUI and a fake ComfyUI install) and documentation captures.
- `docs/screenshots`: actual app captures used in the README.

## Development

Run from the repository root in PowerShell:

```powershell
npm install
npm run dev
```

`npm run build` type-checks and builds the Electron application. `npm start` opens the build. `npm run dev:web` runs a renderer-only preview. See `GUIDE.md` for details and limitations.

Development and the smoke test need no models or GPU; the launcher smoke check uses Python to build a fake install and is skipped without it. Do not install an inference stack merely to work on the UI. Check real generation against your own ComfyUI.

## Implementation principles

- Keep processing local-first. Never silently send prompts or assets to a remote service. Remote inference, if introduced, must require explicit informed opt-in.
- Preserve Electron context isolation, sandboxing, the narrow preload bridge and validation at IPC and filesystem boundaries. Never expose arbitrary shell execution or renderer filesystem access. Only accept loopback ComfyUI endpoints.
- Start ComfyUI only from a folder chosen in the main-process picker or found by detection, only for a recognized layout, with its own Python, no shell and fixed loopback arguments. Never stop a process Sound Studio did not start.
- The only file Sound Studio writes into a ComfyUI folder is its marked WAV output node in `custom_nodes\sound_studio_nodes`. Never overwrite a file there that lacks the `# Managed by Sound Studio.` marker.
- Reuse shared types, defaults, validation, components and semantic CSS tokens. Keep the implementation simple and avoid parallel workflow or settings systems.
- Preserve independent Effects, Music and Decomposer drafts, including generation lyrics/key and analysis selections. Unified schema v3 migrates both older v2 shapes without overwriting legacy keys or malformed/unsupported data.
- Display actionable errors. Do not disguise failed or unavailable inference as completed audio, generate fake library entries, or substitute analytic fixtures for AI output.
- Keep original assets, raw machine results and reviewed corrections separate. Exports must use actual validated artifacts and retain source hashes, model/revision/options and timings. Music handoff requires append/replace approval and never silently truncates.
- Keep models, user audio, generated output, credentials, logs, build artifacts and local environments out of Git.
- Do not add another backend, provider, model installer, packaging system or agent-control server without a task that calls for it.

## Shared application design standard

- Use the same workflow-first shell for **Effects** and **Music**. Keep text-only workspace tabs in the application header; use Character Studio's `"Segoe UI Variable", "Segoe UI", sans-serif` font stack and 19px tab labels.
- Keep a horizontal, connected **chevron process stepper** above the main working surface. Show numbered markers, meaningful labels and readable state. Navigation is not execution or completion.
- Use one left settings panel for the selected step's inputs and primary action. Keep asset-library access compact; do not add a permanent right settings or model column.
- Dedicate the main surface to audio preview and review, with contextual transport and take trays. Keep empty states honest and disable generation until the backend and model are ready.
- Keep detailed configuration in an explicitly opened **Model Settings** panel. Opening it must not reset tabs, steps or draft values.
- Show a compact **Local + model** summary beside AI actions, including when no model is selected. Never claim backend readiness or measured hardware without a real check.
- Keep backend status in the header button and the **Backend connections** dialog: a one-click **Start local ComfyUI** and **Readiness checks** built by `src/shared/backendChecks.ts`. Each check reports only what was observed and offers the action that fixes it.
- Use **dark neutral-blue canvases, blue-gray panels, off-white text and pale-blue accents**. Use shared semantic CSS tokens, readable muted text and subtle borders. Preserve distinct warning/error treatment; never rely on color alone for status.
- Reuse spacing, stepper, controls and panel treatments across both workspaces. Keep navigation visible while desktop regions scroll, preserve the 960 by 700 minimum window layout, and retain the narrow-preview fallback.
- Give controls accessible names and selected/current states. Support keyboard tab navigation, modal focus containment, focus restoration and reduced motion. Hidden workspace content must not remain operable.
- Label provisional capabilities and example content accurately. Sample briefs are text only, not generated audio.

## AI architecture

Generation profiles carry input limits and readiness checks against ComfyUI. Cloud partners need explicit opt-in and an encrypted key. Analysis profiles use a separate managed runtime and explicit downloads. Keep service lifecycle, jobs and file access in main. Import accepts native-picker files only; renderer code receives opaque IDs, not arbitrary filesystem access.

Track queued, running, failed, cancelled and completed states honestly. A successful request is not a successful output: inspect actual audio before publishing a completed take. Do not claim seamless loops, quality guarantees or model interoperability without evidence.

If agent/MCP support is added, make it opt-in and operate the same visible controls and handlers as the user. Preserve disabled controls, modal boundaries and permission gates. No MCP server exists yet.

## Validation

For shared logic and application changes:

```powershell
npm test
npm run typecheck
```

For UI, persistence, lifecycle and bridge changes:

```powershell
npm run test:desktop
```

The desktop command runs generation and Decomposer smoke checks in isolated profiles. Mock ComfyUI and synthetic DSP fixtures prove contracts, not ML success. See `docs/DECOMPOSER.md` for explicit runtime setup and lawful real-model checks; never download huge models implicitly. Preserve generation regressions when changing the shared bridge, settings or schema.

## README maintenance

- Keep `README.md` concise and screenshot-led, focused on implemented user benefits rather than a changelog or test report.
- Clearly separate available behavior from **Future directions**. Do not invent delivery dates, model support or successful audio results.
- Keep basic requirements and getting-started commands accurate. Put detailed workflows, storage behavior, architecture and troubleshooting in `GUIDE.md`.
- Capture actual UI with `npm run screenshots`, inspect it, and keep selected screenshots under `docs/screenshots`. Do not include private paths, credentials, user assets or mock results.
- Update related documentation with behavior changes, and check links and screenshot paths before finishing.
