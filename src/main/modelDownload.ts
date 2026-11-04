import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { link, lstat, mkdir, realpath, rename, rm, statfs } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { formatBytes, idleDownload, listLabels, modelUrl, totalBytes, type DownloadStatus, type ModelDownload } from '../shared/modelDownloads'

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

const maxRedirects = 8
const stallMs = 2 * 60 * 1000
const spareBytes = 64 * 1024 * 1024
const progressMs = 250

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Only HTTPS from Hugging Face and its CDN, without embedded credentials. */
export function allowedDownloadUrl(raw: string): URL {
  const url = new URL(raw)
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password
    || !(host === 'huggingface.co' || host.endsWith('.huggingface.co') || host === 'hf.co' || host.endsWith('.hf.co'))) {
    throw new Error(`Refusing to download from ${url.protocol}//${url.host}. Models are only downloaded from Hugging Face.`)
  }
  return url
}

async function downloadResponse(raw: string, signal: AbortSignal, fetcher: Fetcher): Promise<Response> {
  let url = allowedDownloadUrl(raw)
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetcher(url.href, { redirect: 'manual', signal, headers: { 'user-agent': 'SoundStudio' } })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      if (!location) throw new Error('Hugging Face redirected without a location.')
      url = allowedDownloadUrl(new URL(location, url).href)
      continue
    }
    if (response.status === 401 || response.status === 403) throw new Error('Hugging Face refused the download. The model may require accepting its license on huggingface.co.')
    if (!response.ok || !response.body) throw new Error(`Hugging Face answered ${response.status} ${response.statusText}.`.trim())
    return response
  }
  throw new Error('Too many redirects while downloading.')
}

/** Resolves symlinks so a link inside the models folder cannot send a download elsewhere. */
async function inside(root: string, folder: string) {
  const [realRoot, realFolder] = await Promise.all([realpath(root), realpath(folder)])
  const path = relative(realRoot, realFolder)
  if (path.startsWith('..') || isAbsolute(path)) throw new Error('The model folder resolves outside ComfyUI/models.')
}

export const targetPath = (modelsDir: string, item: ModelDownload) => join(modelsDir, item.folder, item.file)

/** True when the target already holds a file of the expected size. A different file is never overwritten. */
export async function alreadyPresent(modelsDir: string, item: ModelDownload): Promise<boolean> {
  const target = targetPath(modelsDir, item)
  const info = await lstat(target).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error))
  if (!info) return false
  if (info.isFile() && info.size === item.bytes) return true
  throw new Error(`${target} already exists but is not the expected ${item.label} file. Sound Studio will not overwrite it; move it aside and try again.`)
}

/**
 * Streams one pinned file into ComfyUI/models, hashing as it goes. The file only appears under its final name once
 * its size and SHA-256 match, so ComfyUI never sees a partial or tampered model.
 */
export async function downloadModel(item: ModelDownload, modelsDir: string, options: { signal: AbortSignal; onBytes: (count: number) => void; fetcher?: Fetcher }) {
  const folder = join(modelsDir, item.folder)
  await mkdir(folder, { recursive: true })
  await inside(modelsDir, folder)
  const target = targetPath(modelsDir, item)
  if (await alreadyPresent(modelsDir, item)) return 'present' as const
  const space = await statfs(folder)
  if (space.bavail * space.bsize < item.bytes + spareBytes) {
    throw new Error(`Not enough free space for ${item.label}: ${formatBytes(item.bytes)} needed, ${formatBytes(space.bavail * space.bsize)} free.`)
  }

  const stall = new AbortController()
  const signal = AbortSignal.any([options.signal, stall.signal])
  let timer = setTimeout(() => stall.abort(new Error('The download stalled for two minutes.')), stallMs)
  const partial = join(folder, `.${item.file}.${randomUUID()}.part`)
  try {
    const response = await downloadResponse(modelUrl(item), signal, options.fetcher ?? fetch)
    const hash = createHash('sha256')
    let count = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        count += chunk.length
        if (count > item.bytes) { done(new Error(`${item.label} is larger than expected.`)); return }
        hash.update(chunk)
        clearTimeout(timer)
        timer = setTimeout(() => stall.abort(new Error('The download stalled for two minutes.')), stallMs)
        options.onBytes(chunk.length)
        done(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream), meter, createWriteStream(partial, { flags: 'wx' }), { signal })
    if (count !== item.bytes) throw new Error(`${item.label} ended early (${formatBytes(count)} of ${formatBytes(item.bytes)}).`)
    if (hash.digest('hex') !== item.sha256) throw new Error(`${item.label} did not match its published SHA-256, so it was discarded.`)
    try {
      await link(partial, target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') throw new Error(`${target} appeared during the download. Sound Studio did not overwrite it.`)
      // Some file systems (FAT, exFAT) have no hard links.
      if (await lstat(target).then(() => true, () => false)) throw new Error(`${target} appeared during the download. Sound Studio did not overwrite it.`)
      await rename(partial, target)
    }
    return 'downloaded' as const
  } catch (error) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Download cancelled.')
    throw error
  } finally {
    clearTimeout(timer)
    await rm(partial, { force: true }).catch(() => undefined)
  }
}

/** One batch of downloads at a time, started only after the main process has the user's confirmation. */
export class ModelDownloader {
  private status: DownloadStatus = idleDownload
  private controller: AbortController | null = null
  private preparing = false

  constructor(
    private readonly publish: (status: DownloadStatus) => void,
    private readonly modelsDir: () => Promise<string>,
    private readonly confirm: (items: ModelDownload[], modelsDir: string) => Promise<boolean>,
    private readonly fetcher: Fetcher = fetch
  ) {}

  get(): DownloadStatus { return this.status }

  private set(status: DownloadStatus) {
    this.status = status
    this.publish(status)
  }

  async start(requested: ModelDownload[]): Promise<DownloadStatus> {
    if (this.controller || this.preparing) throw new Error('A download is already running.')
    this.preparing = true
    let items: ModelDownload[] = []
    let modelsDir = ''
    try {
      modelsDir = await this.modelsDir()
      for (const item of requested) if (!(await alreadyPresent(modelsDir, item))) items.push(item)
      if (!items.length) {
        this.set({ ...idleDownload, phase: 'completed', files: requested.map(item => item.label), message: 'These models are already downloaded. Refresh to load them.' })
        return this.status
      }
      if (!(await this.confirm(items, modelsDir))) return this.status
    } finally {
      this.preparing = false
    }

    const controller = new AbortController()
    this.controller = controller
    const total = totalBytes(items)
    let received = 0
    let current = items[0].label
    let last = 0
    const progress = (force = false) => {
      const now = Date.now()
      if (!force && now - last < progressMs) return
      last = now
      this.set({ phase: 'downloading', files: items.map(item => item.label), current, received, total, message: `Downloading ${current}...` })
    }
    progress(true)
    void (async () => {
      try {
        for (const item of items) {
          current = item.label
          progress(true)
          const result = await downloadModel(item, modelsDir, { signal: controller.signal, fetcher: this.fetcher, onBytes: count => { received += count; progress() } })
          if (result === 'present') received += item.bytes
        }
        this.set({ phase: 'completed', files: items.map(item => item.label), current: '', received: total, total, message: `Downloaded ${listLabels(items)}. Each file was checked against its published SHA-256.` })
      } catch (error) {
        const cancelled = controller.signal.aborted
        this.set({ phase: cancelled ? 'cancelled' : 'failed', files: items.map(item => item.label), current, received, total,
          message: cancelled ? 'Download cancelled. Nothing partial was kept.' : `Could not download ${current}. ${errorText(error)}` })
      } finally {
        if (this.controller === controller) this.controller = null
      }
    })()
    return this.status
  }

  cancel(): DownloadStatus {
    this.controller?.abort(new Error('Download cancelled.'))
    return this.status
  }

  dispose() { this.controller?.abort(new Error('Sound Studio is closing.')) }
}
