# Agent guidance

## Project goal

Sound Studio is a local-first AI sound effects and music creation studio. Help game developers and creators describe, generate, review and export audio while keeping creative decisions and user assets under their control.

The current product is an **application shell**, not a functioning audio generator. Effects and Music have editable, locally persisted drafts and placeholder workflows. Inference, models, audio playback, import, export, project files and an asset library are future capabilities. Do not present them as shipped.

## Repository layout

- `src/main`: Electron lifecycle, window security and desktop permission boundaries.
- `src/preload`: the isolated, narrow desktop bridge.
- `src/renderer`: React workspaces, shared styling, dialogs and local draft storage.
- `src/shared`: shared workflow types, defaults, sample briefs and saved-state validation.
- `tests`: TypeScript tests for shared contracts.
- `scripts`: real Electron smoke checks and documentation captures.
- `docs/screenshots`: actual app captures used in the README.

## Development

Run from the repository root in PowerShell:

```powershell
npm install
npm run dev
```

`npm run build` type-checks and builds the Electron application. `npm start` opens the build. `npm run dev:web` runs a renderer-only preview. See `GUIDE.md` for details and limitations.

There are no model, Python or GPU prerequisites for the shell. Do not install an inference stack merely to work on the UI.

## Implementation principles

- Keep processing local-first. Never silently send prompts or assets to a remote service. Remote inference, if introduced, must require explicit informed opt-in.
- Preserve Electron context isolation, sandboxing, the narrow preload bridge and validation at future IPC and filesystem boundaries. Never expose arbitrary shell execution or renderer filesystem access.
- Reuse shared types, defaults, validation, components and semantic CSS tokens. Keep the implementation simple and avoid parallel workflow or settings systems.
- Preserve independent Effects and Music drafts across navigation and settings. Version persisted schemas and migrate deliberately; do not silently overwrite malformed or unsupported saved data.
- Display actionable errors. Do not disguise failed or unavailable inference as completed audio, generate fake library entries, or substitute analytic fixtures for AI output.
- Keep original assets and completed outputs intact. Future exports must use actual validated audio and retain the prompt, model, parameters and source provenance.
- Keep models, user audio, generated output, credentials, logs, build artifacts and local environments out of Git.
- Do not add a backend, provider, model installer, packaging system or agent-control server without a task that calls for it. Current placeholders are intentional.

## Shared application design standard

- Use the same workflow-first shell for **Effects** and **Music**. Keep text-only workspace tabs in the application header; use Character Studio's `"Segoe UI Variable", "Segoe UI", sans-serif` font stack and 19px tab labels.
- Keep a horizontal, connected **chevron process stepper** above the main working surface. Show numbered markers, meaningful labels and readable state. Navigation is not execution or completion.
- Use one left settings panel for the selected step's inputs and primary action. Keep asset-library access compact; do not add a permanent right settings or model column.
- Dedicate the main surface to audio preview and review, with contextual transport and take trays. Keep empty states honest and generation/playback/export disabled until implemented.
- Keep detailed configuration in an explicitly opened **Model Settings** panel. Opening it must not reset tabs, steps or draft values.
- Show a compact **Local + model** summary beside AI actions, including when no model is selected. Never claim backend readiness or measured hardware without a real check.
- Use **dark neutral-blue canvases, blue-gray panels, off-white text and pale-blue accents**. Use shared semantic CSS tokens, readable muted text and subtle borders. Preserve distinct warning/error treatment; never rely on color alone for status.
- Reuse spacing, stepper, controls and panel treatments across both workspaces. Keep navigation visible while desktop regions scroll, preserve the 960 by 700 minimum window layout, and retain the narrow-preview fallback.
- Give controls accessible names and selected/current states. Support keyboard tab navigation, modal focus containment, focus restoration and reduced motion. Hidden workspace content must not remain operable.
- Label provisional capabilities and example content accurately. Sample briefs are text only, not generated audio.

## Future AI architecture

When generation is requested, introduce validated local model/profile selection, explicit download controls, hardware-fit guidance and model-specific input constraints. Keep service lifecycle, inference jobs and file access in the main process or an explicitly managed local backend.

Track queued, running, failed, cancelled and completed states honestly. A successful request is not a successful output: inspect actual audio before publishing a completed take. Do not claim seamless loops, quality guarantees or model interoperability without evidence.

If agent/MCP support is added, make it opt-in and operate the same visible controls and handlers as the user. Preserve disabled controls, modal boundaries and permission gates. No MCP server exists in this shell.

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

The desktop smoke uses the actual Electron app with an isolated temporary profile. It does not prove inference because inference does not exist. Keep tests aligned with real feature claims.

## README maintenance

- Keep `README.md` concise and screenshot-led, focused on implemented user benefits rather than a changelog or test report.
- Clearly separate available shell behavior from **Future directions**. Do not invent delivery dates, model support or successful audio results.
- Keep basic requirements and getting-started commands accurate. Put detailed workflows, storage behavior, architecture and troubleshooting in `GUIDE.md`.
- Capture actual UI with `npm run screenshots`, inspect it, and keep selected screenshots under `docs/screenshots`. Do not include private paths, credentials, user assets or mock results.
- Update related documentation with behavior changes, and check links and screenshot paths before finishing.
