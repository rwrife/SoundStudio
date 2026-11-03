import path from 'node:path'
import type { ComfyLayout } from '../shared/launcher'

export interface ComfyInstall {
  layout: ComfyLayout
  /** The folder the user chose, normalized. For a portable build this is the folder containing python_embeded. */
  folder: string
  python: string
  mainScript: string
  workingDirectory: string
}

type Exists = (file: string) => boolean

/**
 * Recognizes a ComfyUI install that ships its own Python: the Windows portable build, or a source checkout
 * with a venv or .venv folder. Anything else is rejected so Sound Studio never runs an arbitrary program.
 */
export function detectComfyInstall(folder: string, exists: Exists, platform: NodeJS.Platform = process.platform): ComfyInstall {
  const paths = platform === 'win32' ? path.win32 : path.posix
  if (!folder || !paths.isAbsolute(folder)) throw new Error('Choose the folder where ComfyUI is installed.')
  const root = paths.normalize(folder).replace(/[\\/]+$/, '') || paths.sep
  const venvPython = (base: string, venv: string) => platform === 'win32' ? paths.join(base, venv, 'Scripts', 'python.exe') : paths.join(base, venv, 'bin', 'python')

  const portable = (base: string): ComfyInstall | null => {
    const python = paths.join(base, 'python_embeded', 'python.exe')
    const mainScript = paths.join(base, 'ComfyUI', 'main.py')
    return platform === 'win32' && exists(python) && exists(mainScript) ? { layout: 'portable', folder: base, python, mainScript, workingDirectory: base } : null
  }

  const direct = portable(root)
  if (direct) return direct
  const mainScript = paths.join(root, 'main.py')
  if (exists(mainScript)) {
    const parent = paths.dirname(root)
    const inPortable = paths.basename(root) === 'ComfyUI' ? portable(parent) : null
    if (inPortable) return inPortable
    for (const venv of ['venv', '.venv']) {
      const python = venvPython(root, venv)
      if (exists(python)) return { layout: 'venv', folder: root, python, mainScript, workingDirectory: root }
    }
    throw new Error('Found ComfyUI, but not its Python environment. Sound Studio can start a portable build (python_embeded) or a ComfyUI folder with a venv or .venv inside it. Start this ComfyUI yourself, then connect.')
  }
  throw new Error('This folder does not contain ComfyUI (main.py was not found). Choose the ComfyUI folder or the ComfyUI_windows_portable folder. For the ComfyUI Desktop app, open it yourself and connect to its address, usually http://127.0.0.1:8000.')
}

/** Common install locations, checked only to suggest a folder. Nothing is started until the user asks. */
export function candidateFolders(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string[] {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const bases = platform === 'win32'
    ? [env.LOCALAPPDATA, home, home && paths.join(home, 'Desktop'), home && paths.join(home, 'Documents'), env.SystemDrive ? `${env.SystemDrive}\\` : 'C:\\']
    : [home]
  const names = platform === 'win32' ? ['ComfyUI', 'ComfyUI_windows_portable'] : ['ComfyUI']
  return [...new Set(bases.filter((base): base is string => !!base).flatMap(base => names.map(name => paths.join(base, name))))]
}

export function findComfyInstall(candidates: string[], exists: Exists, platform: NodeJS.Platform = process.platform): ComfyInstall | null {
  for (const candidate of candidates) {
    try { return detectComfyInstall(candidate, exists, platform) } catch { /* Try the next location. */ }
  }
  return null
}
