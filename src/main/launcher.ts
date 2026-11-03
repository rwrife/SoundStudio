import { app, dialog, shell, type BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizeEndpoint } from '../shared/generation'
import { comfyLaunchArguments, type FolderSource, type LauncherPhase, type LauncherStatus } from '../shared/launcher'
import { candidateFolders, detectComfyInstall, findComfyInstall, type ComfyInstall } from './comfyInstall'
import { ComfyClient } from './comfyui'

interface StoredLauncher { version: 1; folder: string | null; startOnLaunch: boolean }

const startupLimitMs = 5 * 60 * 1000
const probeMs = 1500
const stopWaitMs = 10_000

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function reachable(endpoint: string) {
  try { await new ComfyClient(endpoint).version(); return true } catch { return false }
}

/**
 * Starts and stops the user's own ComfyUI on request. The folder is chosen only through a native dialog,
 * only recognized installs are run, ComfyUI listens on loopback only, and only the process started here is ever stopped.
 */
export class ComfyLauncher {
  private readonly file = join(app.getPath('userData'), 'comfyui-launcher.json')
  private readonly logPath = join(app.getPath('userData'), 'logs', 'comfyui.log')
  private stored: StoredLauncher = { version: 1, folder: null, startOnLaunch: false }
  private loaded = false
  private detected: ComfyInstall | null | undefined
  private child: ChildProcess | null = null
  private phase: LauncherPhase = 'stopped'
  private endpoint: string | null = null
  private message = ''
  private stopRequested = false

  constructor(private readonly publish: (status: LauncherStatus) => void, private readonly busy: () => boolean) {}

  private async load() {
    if (this.loaded) return
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'))
      if (value?.version !== 1 || (value.folder !== null && typeof value.folder !== 'string') || typeof value.startOnLaunch !== 'boolean') {
        throw new Error('Unsupported launcher settings file.')
      }
      this.stored = { version: 1, folder: value.folder, startOnLaunch: value.startOnLaunch }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Ignoring unreadable ComfyUI launcher settings.', error)
    }
    this.loaded = true
  }

  private async save() {
    await mkdir(app.getPath('userData'), { recursive: true })
    const temp = `${this.file}.tmp`
    await writeFile(temp, JSON.stringify(this.stored))
    await rename(temp, this.file)
  }

  private install(): { install: ComfyInstall | null; error: string } {
    if (!this.stored.folder) return { install: null, error: '' }
    try { return { install: detectComfyInstall(this.stored.folder, existsSync), error: '' } } catch (error) { return { install: null, error: errorText(error) } }
  }

  async status(): Promise<LauncherStatus> {
    await this.load()
    const { install, error } = this.install()
    if (!this.stored.folder && this.detected === undefined) {
      this.detected = findComfyInstall(candidateFolders(process.platform, process.env, homedir()), existsSync)
    }
    return {
      folder: install?.folder ?? this.stored.folder,
      layout: install?.layout ?? null,
      installError: error,
      detected: this.stored.folder ? null : this.detected?.folder ?? null,
      startOnLaunch: this.stored.startOnLaunch,
      phase: this.phase,
      endpoint: this.endpoint,
      pid: this.child?.pid ?? null,
      message: this.message,
      hasLog: existsSync(this.logPath)
    }
  }

  private async notify() {
    this.publish(await this.status())
  }

  async setFolder(source: FolderSource, window: BrowserWindow): Promise<LauncherStatus> {
    await this.load()
    if (this.child) throw new Error('Stop the ComfyUI that Sound Studio started before changing its folder.')
    let folder: string | null = null
    if (source === 'browse') {
      const result = await dialog.showOpenDialog(window, {
        title: 'Choose your ComfyUI folder', buttonLabel: 'Use this folder', properties: ['openDirectory'],
        defaultPath: this.stored.folder ?? this.detected?.folder ?? homedir()
      })
      if (result.canceled || !result.filePaths[0]) return this.status()
      folder = detectComfyInstall(result.filePaths[0], existsSync).folder
    } else if (source === 'detected') {
      if (!this.detected) throw new Error('No ComfyUI install was found in the usual locations. Choose its folder instead.')
      folder = detectComfyInstall(this.detected.folder, existsSync).folder
    }
    this.stored = { ...this.stored, folder, startOnLaunch: folder ? this.stored.startOnLaunch : false }
    if (!folder) this.detected = undefined
    this.message = ''
    await this.save()
    return this.status()
  }

  async setStartOnLaunch(enabled: boolean): Promise<LauncherStatus> {
    await this.load()
    if (enabled && !this.install().install) throw new Error('Choose a ComfyUI folder that Sound Studio can start first.')
    this.stored = { ...this.stored, startOnLaunch: enabled }
    await this.save()
    return this.status()
  }

  async start(rawEndpoint: unknown): Promise<LauncherStatus> {
    await this.load()
    const endpoint = normalizeEndpoint(rawEndpoint)
    if (this.phase === 'starting') throw new Error('ComfyUI is already starting.')
    if (this.child) {
      if (this.endpoint === endpoint) return this.status()
      throw new Error(`Sound Studio already started ComfyUI at ${this.endpoint}. Stop it first.`)
    }
    if (await reachable(endpoint)) {
      this.message = `ComfyUI is already running at ${endpoint}.`
      return this.status()
    }
    const { install, error } = this.install()
    if (!install) throw new Error(error || 'Choose your ComfyUI folder first.')

    mkdirSync(join(app.getPath('userData'), 'logs'), { recursive: true })
    const log = openSync(this.logPath, 'a')
    let child: ChildProcess
    try {
      writeSync(log, `\n=== Sound Studio started ComfyUI at ${new Date().toISOString()} (${install.folder}, ${endpoint}) ===\n`)
      // ComfyUI writes straight to the log file rather than to pipes owned by this app.
      child = spawn(install.python, comfyLaunchArguments(install.layout, install.mainScript, endpoint), {
        cwd: install.workingDirectory, windowsHide: true, shell: false, stdio: ['ignore', log, log],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      })
    } finally {
      closeSync(log)
    }
    this.child = child
    this.endpoint = endpoint
    this.phase = 'starting'
    this.stopRequested = false
    this.message = 'Starting ComfyUI. The first start can take a few minutes.'
    let failure = null as Error | null
    child.once('error', spawnError => { failure = spawnError })
    child.once('exit', code => {
      if (this.child !== child) return
      const wasRunning = this.phase === 'running'
      this.child = null
      this.phase = this.stopRequested ? 'stopped' : 'exited'
      this.message = this.stopRequested ? 'ComfyUI stopped.'
        : wasRunning ? `ComfyUI exited unexpectedly${code === null ? '' : ` (code ${code})`}. See the log for details.`
        : `ComfyUI stopped during startup${code === null ? '' : ` (code ${code})`}. See the log for details.`
      void this.notify()
    })
    await this.notify()

    const deadline = Date.now() + startupLimitMs
    while (Date.now() < deadline) {
      if (failure) {
        this.child = null
        this.phase = 'exited'
        this.message = `ComfyUI could not be started: ${errorText(failure)}`
        await this.notify()
        throw new Error(this.message)
      }
      if (this.child !== child) throw new Error(this.message)
      if (await reachable(endpoint)) {
        if (this.child !== child) throw new Error(this.message)
        this.phase = 'running'
        this.message = `ComfyUI is running at ${endpoint}.`
        await this.notify()
        return this.status()
      }
      await delay(probeMs)
    }
    this.message = 'ComfyUI did not answer within five minutes, so Sound Studio stopped it. See the log for details.'
    await this.stop(true)
    throw new Error(this.message)
  }

  async stop(force = false): Promise<LauncherStatus> {
    const child = this.child
    if (!child) throw new Error('Sound Studio did not start the running ComfyUI, so it will not stop it.')
    if (!force && this.busy()) throw new Error('Cancel the running generation before stopping ComfyUI.')
    const reason = force ? this.message : ''
    this.stopRequested = true
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
    child.kill()
    await Promise.race([exited, delay(stopWaitMs)])
    if (this.child === child) {
      this.child = null
      this.phase = 'stopped'
    }
    if (reason) this.message = reason
    await this.notify()
    return this.status()
  }

  async showLog() {
    if (!existsSync(this.logPath)) throw new Error('There is no ComfyUI log yet.')
    shell.showItemInFolder(this.logPath)
  }

  /** Called when the app quits. Only the process this app started is stopped. */
  dispose() {
    if (!this.child) return
    this.stopRequested = true
    this.child.kill()
    this.child = null
  }
}
