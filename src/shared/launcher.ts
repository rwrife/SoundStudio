/** State of the ComfyUI process that Sound Studio can start on the user's behalf. */

export type ComfyLayout = 'portable' | 'venv'
export type LauncherPhase = 'stopped' | 'starting' | 'running' | 'exited'
/** Whether Sound Studio's WAV output node is in the install's custom_nodes folder. ComfyUI loads it at startup. */
export type OutputNodeState = 'installed' | 'outdated' | 'missing'

export interface LauncherStatus {
  /** The folder the user chose, or else an install found in a usual location. */
  folder: string | null
  layout: ComfyLayout | null
  /** Why the folder cannot be started, if it cannot. */
  installError: string
  /** Null when there is no recognized install to check. */
  outputNode: OutputNodeState | null
  /** Only describes a process Sound Studio started. A ComfyUI started elsewhere is always 'stopped' here. */
  phase: LauncherPhase
  endpoint: string | null
  message: string
  hasLog: boolean
}

/** Arguments for ComfyUI's own main.py. ComfyUI only ever listens on the loopback address of the endpoint. */
export function comfyLaunchArguments(layout: ComfyLayout, mainScript: string, endpoint: string): string[] {
  const url = new URL(endpoint)
  const host = url.hostname === '[::1]' ? '::1' : '127.0.0.1'
  return [...(layout === 'portable' ? ['-s'] : []), mainScript, '--listen', host, '--port', url.port || '80', '--disable-auto-launch']
}