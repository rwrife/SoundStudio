import { modelProfiles, outputNodeClass, type BackendStatus, type ModelChoice, type Readiness } from './generation'
import type { LauncherStatus } from './launcher'
import type { Workspace } from './workspace'

export type CheckStatus = 'ready' | 'warning' | 'blocked' | 'pending'
export type CheckAction = 'choose-folder' | 'start' | 'install-node' | 'restart' | 'models-effects' | 'models-music' | 'download-effects' | 'download-music'

export interface BackendCheck { id: string; name: string; status: CheckStatus; detail: string; action?: CheckAction }

export type ConnectionSummary =
  | { state: 'disconnected' | 'checking' }
  | { state: 'connected'; status: BackendStatus }
  | { state: 'error'; error: string }

export interface CheckInput {
  connection: ConnectionSummary
  launcher: LauncherStatus | null
  models: Record<Workspace, ModelChoice>
  readiness: Record<Workspace, Readiness>
  /** Bytes of catalog files each workspace's model still needs; zero or absent when nothing can be downloaded. */
  downloads?: Record<Workspace, number>
  /** True while a model download is running. */
  downloading?: boolean
}

const gigabytes = (bytes: number) => `${Math.round(bytes / 1024 ** 3 * 10) / 10} GB`

/** Readiness checks for the Backend connections screen. Each describes what was actually observed, never what is assumed. */
export function backendChecks({ connection, launcher, models, readiness, downloads, downloading }: CheckInput): BackendCheck[] {
  const status = connection.state === 'connected' ? connection.status : null
  const starting = launcher?.phase === 'starting'
  const managed = launcher?.phase === 'running'
  const waiting = connection.state === 'checking' || starting
  const checks: BackendCheck[] = []

  checks.push(launcher?.layout && launcher.folder
    ? { id: 'folder', name: 'ComfyUI folder', status: 'ready', detail: `${launcher.folder} (${launcher.layout === 'portable' ? 'portable build' : 'Python environment'})` }
    : launcher?.installError
      ? { id: 'folder', name: 'ComfyUI folder', status: 'blocked', detail: launcher.installError, action: 'choose-folder' }
      : status
        ? { id: 'folder', name: 'ComfyUI folder', status: 'warning', detail: 'ComfyUI is running, but its folder was not found. Choose it so Sound Studio can start ComfyUI and install its audio output node.', action: 'choose-folder' }
        : { id: 'folder', name: 'ComfyUI folder', status: 'blocked', detail: 'ComfyUI was not found in the usual places. Choose the folder that contains it.', action: 'choose-folder' })

  checks.push(status
    ? { id: 'server', name: 'ComfyUI server', status: 'ready', detail: `ComfyUI ${status.comfyuiVersion ?? '(unknown version)'} at ${status.endpoint}${managed ? ', started by Sound Studio' : ''}.` }
    : waiting
      ? { id: 'server', name: 'ComfyUI server', status: 'pending', detail: starting ? (launcher?.message || 'Starting ComfyUI...') : 'Checking ComfyUI...' }
      : { id: 'server', name: 'ComfyUI server', status: 'blocked', detail: connection.state === 'error' ? connection.error : 'ComfyUI is not running.', ...(launcher?.layout ? { action: 'start' as const } : {}) })

  if (!status) {
    checks.push({ id: 'device', name: 'Graphics processor', status: 'pending', detail: 'Reported once ComfyUI is running.' })
  } else {
    const gpus = status.devices.filter(device => device.type !== 'cpu')
    checks.push(gpus.length
      ? { id: 'device', name: 'Graphics processor', status: 'ready', detail: gpus.map(device => `${device.name}${device.vramTotal ? ` / ${gigabytes(device.vramTotal)}` : ''}`).join('; ') }
      : { id: 'device', name: 'Graphics processor', status: 'warning', detail: 'ComfyUI reports no GPU, so generation runs on the processor and is much slower.' })
  }

  const loaded = status?.availableNodes.includes(outputNodeClass) ?? false
  const onDisk = launcher?.outputNode
  checks.push(loaded
    ? { id: 'output', name: 'Audio output node', status: onDisk === 'outdated' ? 'warning' : 'ready', detail: onDisk === 'outdated' ? 'Loaded, but an update is available.' : 'Save Audio WAV (Sound Studio) is loaded. Takes save as WAV without FFmpeg.', ...(onDisk === 'outdated' ? { action: 'install-node' as const } : {}) }
    : onDisk === 'installed'
      ? { id: 'output', name: 'Audio output node', status: status ? 'warning' : 'ready', detail: status ? 'Installed, but this ComfyUI started before it was. Restart ComfyUI to load it.' : 'Installed. ComfyUI loads it when it starts.', ...(status && managed ? { action: 'restart' as const } : {}) }
      : onDisk === 'missing' || onDisk === 'outdated'
        ? { id: 'output', name: 'Audio output node', status: 'warning', detail: `${onDisk === 'missing' ? 'Not installed yet' : 'An update is available'}. Start local ComfyUI installs it automatically. ComfyUI's own Save Audio needs FFmpeg, which some PCs block.`, action: 'install-node' }
        : { id: 'output', name: 'Audio output node', status: status ? 'warning' : 'pending', detail: status ? 'Not loaded. ComfyUI\'s own Save Audio is used, which needs FFmpeg. Choose the ComfyUI folder to install the Sound Studio node.' : 'Checked once ComfyUI is found.' })

  for (const workspace of ['effects', 'music'] as const) {
    const label = workspace === 'effects' ? 'Effects model' : 'Music model'
    const profile = modelProfiles[models[workspace].profileId]
    const result = readiness[workspace]
    const action = workspace === 'effects' ? 'models-effects' as const : 'models-music' as const
    const download = downloads?.[workspace] ?? 0
    checks.push(!status
      ? { id: workspace, name: label, status: 'pending', detail: `${profile.label}. Checked once ComfyUI is running.` }
      : result.ready
        ? { id: workspace, name: label, status: 'ready', detail: `${profile.label}${result.checkpoint ? ` / ${result.checkpoint}` : ''}${result.remote ? '. Sends your prompt to a partner service.' : ''}` }
        : download && downloading
          ? { id: workspace, name: label, status: 'pending', detail: `${profile.label} is downloading.` }
          : download
            ? { id: workspace, name: label, status: 'blocked', detail: [`${profile.label} is not downloaded yet (${gigabytes(download)}).`, ...result.issues.filter(issue => !/^No .* found in ComfyUI\/models/.test(issue))].join(' '), action: workspace === 'effects' ? 'download-effects' : 'download-music' }
            : { id: workspace, name: label, status: 'blocked', detail: `${profile.label}: ${result.issues.join(' ')}`, action })
  }
  return checks
}

/** The short label for the header button, matching the checks above. */
export function backendSummary(checks: BackendCheck[], phase: LauncherStatus['phase'] | undefined): { label: string; tone: 'ready' | 'warning' | 'pending' } {
  if (phase === 'starting') return { label: 'Starting ComfyUI...', tone: 'pending' }
  if (checks.some(check => check.id === 'server' && check.status === 'pending')) return { label: 'Checking backends', tone: 'pending' }
  if (checks.some(check => check.status === 'blocked')) return { label: 'Setup needs attention', tone: 'warning' }
  return { label: 'Local backends ready', tone: 'ready' }
}
