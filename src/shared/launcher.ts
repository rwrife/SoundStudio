/** State of the ComfyUI process that Sound Studio can start on the user's behalf. */

export type ComfyLayout = 'portable' | 'venv'
export type LauncherPhase = 'stopped' | 'starting' | 'running' | 'exited'
export type FolderSource = 'browse' | 'detected' | 'none'

export interface LauncherStatus {
  /** The ComfyUI folder the user chose, or null. */
  folder: string | null
  layout: ComfyLayout | null
  /** Why the chosen folder cannot be started, if it cannot. */
  installError: string
  /** A ComfyUI install found in a common location, offered when no folder is chosen. */
  detected: string | null
  startOnLaunch: boolean
  /** Only describes a process Sound Studio started. A ComfyUI started elsewhere is always 'stopped' here. */
  phase: LauncherPhase
  endpoint: string | null
  pid: number | null
  message: string
  hasLog: boolean
}

export const layoutLabels: Record<ComfyLayout, string> = {
  portable: 'Portable build (python_embeded)',
  venv: 'Python virtual environment'
}

/** Arguments for ComfyUI's own main.py. ComfyUI only ever listens on the loopback address of the endpoint. */
export function comfyLaunchArguments(layout: ComfyLayout, mainScript: string, endpoint: string): string[] {
  const url = new URL(endpoint)
  const host = url.hostname === '[::1]' ? '::1' : '127.0.0.1'
  return [...(layout === 'portable' ? ['-s'] : []), mainScript, '--listen', host, '--port', url.port || '80', '--disable-auto-launch']
}

export function isFolderSource(value: unknown): value is FolderSource {
  return value === 'browse' || value === 'detected' || value === 'none'
}
