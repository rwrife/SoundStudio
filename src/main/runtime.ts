import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { totalmem } from 'node:os'
import { z } from 'zod'
import { profileSchema, type Profile, type RuntimeStatus } from '../shared/decomposer'

const uvVersion = '0.6.17'
const uvHash = '32882cf98f646cafca003e7a7c471b7ff4ba977b681c9fa3b12cf908ba64af82'
const profiles: RuntimeStatus['profiles'] = [
  { id: 'core', label: 'Audio + timing / harmony', ready: false, detail: 'Not installed', download: '~250 MB runtime and DSP packages', license: 'CPython PSF; uv MIT/Apache-2.0; PyAV BSD/FFmpeg LGPL; librosa ISC' },
  { id: 'stems', label: 'HTDemucs four-stem separation', ready: false, detail: 'Not installed', download: '~1 GB CPU dependencies + ~80 MB weights', license: 'Demucs / weights MIT; PyTorch BSD' },
  { id: 'lyrics-tiny', label: 'Whisper tiny (fast, less accurate)', ready: false, detail: 'Not installed', download: '~200 MB dependencies + ~75 MB weights', license: 'Whisper / faster-whisper / CTranslate2 MIT' },
  { id: 'lyrics-base', label: 'Whisper base (multilingual)', ready: false, detail: 'Not installed', download: '~200 MB dependencies + ~145 MB weights', license: 'Whisper / faster-whisper / CTranslate2 MIT' },
  { id: 'notes', label: 'Basic Pitch note / MIDI estimates', ready: false, detail: 'Not installed', download: '~400 MB dependencies; small bundled model', license: 'Basic Pitch Apache-2.0' },
  { id: 'captions', label: 'Qwen2-Audio 7B detailed descriptions', ready: false, detail: 'Not installed', download: '~17 GB weights + CPU dependencies; recommend 40 GB free RAM', license: 'Qwen2-Audio Apache-2.0; may hallucinate' }
]

export function stopProcess(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    killer.on('error', error => console.error('Unable to stop worker tree:', error))
  } else child.kill('SIGKILL')
}

export function command(executable: string, args: string[], input: unknown, onLine: (line: string) => void, signal?: AbortSignal, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Cancelled')); return }
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env })
    let buffer = ''
    let errors = ''
    let failure: Error | undefined
    const cancel = () => { failure = new Error('Cancelled'); stopProcess(child) }
    signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => { failure = new Error('Worker exceeded the 60-minute time limit. Try a shorter excerpt.'); stopProcess(child) }, 60 * 60 * 1000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (data: string) => {
      buffer += data
      if (buffer.length > 16 * 1024 * 1024) { failure = new Error('Worker output exceeded the limit'); stopProcess(child); return }
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim()
        buffer = buffer.slice(end + 1)
        if (line) {
          try { onLine(line) } catch (error) { failure = error instanceof Error ? error : new Error(String(error)); stopProcess(child) }
        }
      }
    })
    child.stderr.on('data', (data: string) => { errors = (errors + data).slice(-6000) })
    child.on('error', error => { failure = error })
    child.stdin.on('error', error => { if (!failure) failure = error })
    child.once('close', code => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error(`Worker exited (${code}). ${errors || 'No diagnostic output. Check runtime setup.'}`))
      else resolve()
    })
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input))
  })
}

const diagnosticSchema = z.object({
  python: z.string(),
  profiles: z.array(z.object({ id: profileSchema, ready: z.boolean(), detail: z.string() }))
})

export class LocalRuntime {
  private status: RuntimeStatus = {
    busy: false, message: 'Install the core runtime to import audio.', error: null, python: null,
    platform: `${process.platform} ${process.arch} (managed CPU x64)`,
    memoryGiB: Math.round(totalmem() / 1024 ** 3), profiles: structuredClone(profiles)
  }
  private installer?: AbortController
  private diagnosis?: Promise<RuntimeStatus>
  private lastDiagnosis = 0
  readonly models: string
  readonly python: string
  constructor(readonly root: string, readonly scripts: string) {
    this.models = join(root, 'models')
    this.python = join(root, 'venv', 'Scripts', 'python.exe')
  }
  async worker(input: Record<string, unknown>, progress: (fraction: number, stage: string) => void = () => {}, signal?: AbortSignal): Promise<unknown> {
    try { await access(this.python) } catch { throw new Error('Install the core audio runtime in Model Settings first.') }
    let result: unknown
    let received = false
    const request = input.command === 'import' ? input : { ...input, models: this.models }
    await command(this.python, ['-I', '-X', 'utf8', '-u', join(this.scripts, 'worker.py')], request, line => {
      const event = z.discriminatedUnion('type', [
        z.object({ type: z.literal('progress'), progress: z.number().min(0).max(1), stage: z.string().max(300) }),
        z.object({ type: z.literal('result'), value: z.unknown() })
      ]).parse(JSON.parse(line))
      if (event.type === 'result') {
        if (received) throw new Error('Worker sent duplicate results')
        received = true
        result = event.value
      } else progress(event.progress, event.stage)
    }, signal, { ...process.env, HF_HUB_OFFLINE: input.command === 'acquire' ? '0' : '1', TRANSFORMERS_OFFLINE: input.command === 'acquire' ? '0' : '1', HF_HUB_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' })
    if (!received) throw new Error('Worker exited without a result. Nothing was published.')
    return result
  }
  async diagnose(force = false): Promise<RuntimeStatus> {
    if (this.status.busy) return structuredClone(this.status)
    if (this.diagnosis) return this.diagnosis
    if (!force && Date.now() - this.lastDiagnosis < 30000) return structuredClone(this.status)
    this.diagnosis = (async () => {
      try {
        const diagnostic = diagnosticSchema.parse(await this.worker({ command: 'diagnose' }))
        this.status.python = diagnostic.python
        this.status.profiles = profiles.map(profile => ({ ...profile, ...diagnostic.profiles.find(item => item.id === profile.id) }))
        if (!this.status.error) this.status.message = this.status.profiles[0].ready ? 'Local readiness checked. Only installed, selected stages can run.' : 'Install or repair the core audio runtime before importing.'
      } catch (error) {
        this.status.python = null
        this.status.profiles = structuredClone(profiles)
        this.status.message = error instanceof Error ? error.message : String(error)
      }
      this.lastDiagnosis = Date.now()
      return structuredClone(this.status)
    })()
    try { return await this.diagnosis } finally { this.diagnosis = undefined }
  }
  snapshot() { return structuredClone(this.status) }
  cancel() { this.installer?.abort() }
  async install(profile: Profile) {
    if (this.status.busy) throw new Error('A runtime installation is already in progress.')
    if (process.platform !== 'win32') throw new Error('Managed setup currently supports Windows x64 and Windows ARM64 x64 emulation only.')
    if (profile !== 'core' && !this.status.profiles.find(item => item.id === 'core')?.ready) throw new Error('Install the core runtime first.')
    this.status.busy = true
    this.status.error = null
    this.status.message = `Preparing ${profile} installation...`
    this.installer = new AbortController()
    void this.performInstall(profile, this.installer.signal).catch(error => {
      this.status.error = (error instanceof Error ? error.message : String(error)).slice(-4000)
      this.status.message = 'Installation did not complete. Retry the same profile to resume acquisition.'
    }).finally(async () => {
      this.status.busy = false
      this.installer = undefined
      await this.diagnose(true)
    })
  }
  private async performInstall(profile: Profile, signal: AbortSignal) {
    await mkdir(this.root, { recursive: true })
    const uv = join(this.root, 'uv.exe')
    if (profile === 'core') {
      this.status.message = 'Downloading checksum-pinned uv 0.6.17 (17 MB)...'
      const response = await fetch(`https://github.com/astral-sh/uv/releases/download/${uvVersion}/uv-x86_64-pc-windows-msvc.zip`, { signal })
      if (!response.ok || !response.body) throw new Error(`Runtime download failed: HTTP ${response.status}`)
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of response.body) {
        bytes += chunk.length
        if (bytes > 20 * 1024 * 1024) throw new Error('Runtime archive exceeds the expected size')
        chunks.push(Buffer.from(chunk))
      }
      const archive = Buffer.concat(chunks)
      if (createHash('sha256').update(archive).digest('hex') !== uvHash) throw new Error('Runtime download checksum mismatch. Installation stopped.')
      const zip = join(this.root, 'uv.zip')
      await writeFile(zip, archive)
      await command('tar.exe', ['-xf', zip, '-C', this.root], undefined, () => {}, signal)
      await rm(zip)
      this.status.message = 'Installing isolated CPython 3.11.12 x64...'
      await command(uv, ['python', 'install', 'cpython-3.11.12-windows-x86_64-none', '--install-dir', join(this.root, 'python'), '--no-config'], undefined, () => {}, signal)
      const pythonRoots = await readdir(join(this.root, 'python'))
      const pythonRoot = pythonRoots.find(name => name === 'cpython-3.11.12-windows-x86_64-none')
      if (!pythonRoot) throw new Error('Managed CPython installation could not be located.')
      try { await access(this.python) } catch {
        await command(uv, ['venv', join(this.root, 'venv'), '--python', join(this.root, 'python', pythonRoot, 'python.exe'), '--no-config'], undefined, () => {}, signal)
      }
    }
    this.status.message = `Installing pinned ${profile} dependencies; this may take several minutes...`
    const requirements = join(this.scripts, `requirements-${profile}.txt`)
    await access(requirements)
    await command(uv, ['pip', 'install', '--python', this.python, '--requirement', requirements, '--no-config'], undefined, () => {}, signal)
    if (profile !== 'core') {
      this.status.message = `Acquiring ${profile} model files (explicit download)...`
      await this.worker({ command: 'acquire', profile }, (_fraction, stage) => { this.status.message = stage }, signal)
    }
    await writeFile(join(this.root, 'installed.json.tmp'), JSON.stringify({ python: '3.11.12', uv: uvVersion, lastProfile: profile, installedAt: new Date().toISOString() }))
    await rename(join(this.root, 'installed.json.tmp'), join(this.root, 'installed.json'))
    this.status.message = 'Installation finished. Checking local readiness...'
  }
}
