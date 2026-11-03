import { constants, createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { z } from 'zod'
import {
  assetSchema, audioMetadataSchema, idSchema, jobSchema, optionsSchema, resultSchema, reviewSchema,
  reviewedBrief, type AnalysisJob, type Asset, type ExportKind, type LibrarySnapshot, type Review, type Stem
} from '../shared/decomposer'
import { LocalRuntime } from './runtime'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const assetRecordSchema = z.object({
  version: z.literal(1), asset: assetSchema,
  originalFile: z.string().regex(/^original\.(wav|flac|mp3|ogg|m4a)$/), referenceHash: hashSchema
}).strict()
type AssetRecord = z.infer<typeof assetRecordSchema>
const artifactsSchema = z.partialRecord(z.enum(['vocals.wav', 'drums.wav', 'bass.wav', 'other.wav', 'notes.mid']), hashSchema)
const jobRecordSchema = z.object({ version: z.literal(1), job: jobSchema, artifacts: artifactsSchema }).strict()
type JobRecord = z.infer<typeof jobRecordSchema>
const maximumSourceBytes = 512 * 1024 * 1024

export async function fileHash(path: string) {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Expected a regular local file, not a link.')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
async function readJson(path: string): Promise<unknown> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('Invalid saved record size or file type')
  return JSON.parse(await readFile(path, 'utf8'))
}
async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx' })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}
export function validateReview(value: Review, job: AnalysisJob): Review {
  const review = reviewSchema.parse(value)
  for (const lines of [review.chords, review.sections, review.descriptions, review.lyrics]) {
    let previous = -1
    for (const line of lines) {
      if (line.start < job.options.start - 0.01 || line.end > job.options.end + 0.01 || line.start < previous) {
        throw new Error('Review timestamps must be ordered and remain within the analysed source excerpt.')
      }
      previous = line.start
    }
  }
  return review
}
export async function validateWav(path: string) {
  const file = await open(path, 'r')
  try {
    const stat = await file.stat()
    const header = Buffer.alloc(Math.min(stat.size, 65536))
    await file.read(header, 0, header.length, 0)
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE' || header.readUInt32LE(4) + 8 !== stat.size) throw new Error('Invalid WAV container')
    let format = false
    let data = false
    for (let cursor = 12; cursor + 8 <= header.length;) {
      const kind = header.toString('ascii', cursor, cursor + 4)
      const size = header.readUInt32LE(cursor + 4)
      if (cursor + 8 + size > stat.size) throw new Error('Truncated WAV data')
      if (kind === 'fmt ') {
        if (size < 16 || cursor + 24 > header.length) throw new Error('Invalid WAV format')
        const encoding = header.readUInt16LE(cursor + 8)
        const channels = header.readUInt16LE(cursor + 10)
        const rate = header.readUInt32LE(cursor + 12)
        if (![1, 3].includes(encoding) || channels < 1 || channels > 2 || rate < 8000 || rate > 192000) throw new Error('Unsupported WAV format')
        format = true
      }
      if (kind === 'data') { data = size > 0; break }
      cursor += 8 + size + size % 2
    }
    if (!format || !data) throw new Error('Missing WAV format or audio frames')
  } finally { await file.close() }
}
function timestamp(seconds: number, format: 'lrc' | 'srt') {
  const milliseconds = Math.round(seconds * 1000)
  if (format === 'lrc') {
    const centiseconds = Math.round(seconds * 100)
    return `${String(Math.floor(centiseconds / 6000)).padStart(2, '0')}:${(centiseconds % 6000 / 100).toFixed(2).padStart(5, '0')}`
  }
  return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`
}
export function lyricExport(review: Review, format: 'lrc' | 'srt') {
  return review.lyrics.map((line, index) => format === 'lrc'
    ? `[${timestamp(line.start, 'lrc')}]${line.text.replace(/[\r\n]/g, ' ')}`
    : `${index + 1}\n${timestamp(line.start, 'srt')} --> ${timestamp(line.end, 'srt')}\n${line.text.split(/\r?\n/).filter(line => line.trim()).join('\n')}\n`).join('\n')
}

export class AnalysisStore {
  readonly assets = new Map<string, AssetRecord>()
  readonly jobs = new Map<string, JobRecord>()
  private errors: string[] = []
  private active?: { id: string; abort: AbortController }
  private importing = false
  private closing = false
  private writes = new Set<string>()
  constructor(readonly root: string, readonly runtime: LocalRuntime) {}
  private assetDir(id: string) { return join(this.root, 'assets', idSchema.parse(id)) }
  private jobDir(id: string) { return join(this.root, 'analyses', idSchema.parse(id)) }
  private async saveJob(record: JobRecord) { await atomicJson(join(this.jobDir(record.job.id), 'job.json'), record) }
  async initialize() {
    for (const [directory, schema] of [
      ['assets', assetRecordSchema],
      ['analyses', jobRecordSchema]
    ] as const) {
      const root = join(this.root, directory)
      await mkdir(root, { recursive: true })
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !idSchema.safeParse(entry.name).success) continue
        try {
          const value = schema.parse(await readJson(join(root, entry.name, directory === 'assets' ? 'asset.json' : 'job.json')))
          const storedId = 'asset' in value ? value.asset.id : value.job.id
          if (storedId !== entry.name) throw new Error('Record ID does not match its directory')
          if ('asset' in value) this.assets.set(value.asset.id, value)
          else this.jobs.set(value.job.id, value)
        } catch (error) {
          this.errors.push(`${directory}/${entry.name}: ${error instanceof Error ? error.message : String(error)}. Stored files were preserved.`)
        }
      }
    }
    for (const record of this.jobs.values()) {
      if (record.job.state === 'running' || record.job.state === 'queued') {
        record.job.state = 'failed'
        record.job.error = 'Interrupted by application shutdown. Partial outputs were not published; start a new analysis.'
        record.job.stage = 'Interrupted'
        await this.saveJob(record)
      }
    }
  }
  snapshot(): LibrarySnapshot {
    return structuredClone({ assets: [...this.assets.values()].map(item => item.asset), jobs: [...this.jobs.values()].map(item => item.job), errors: this.errors })
  }
  async importFile(source: string): Promise<Asset> {
    if (this.importing) throw new Error('An audio import is already in progress.')
    if (this.runtime.snapshot().busy) throw new Error('Wait for runtime installation to finish before importing.')
    const extension = extname(source).toLowerCase()
    if (!['.wav', '.flac', '.mp3', '.ogg', '.m4a'].includes(extension)) throw new Error('Unsupported file. Choose WAV, FLAC, MP3, OGG or M4A audio.')
    const stat = await lstat(source)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 12 || stat.size > maximumSourceBytes) throw new Error('Choose a regular audio file between 12 bytes and 512 MB; links are not supported.')
    this.importing = true
    const id = randomUUID()
    const directory = this.assetDir(id)
    try {
      await mkdir(directory)
      const originalFile = `original${extension}`
      const original = join(directory, originalFile)
      await copyFile(source, original, constants.COPYFILE_EXCL)
      const hash = await fileHash(original)
      const metadata = audioMetadataSchema.parse(await this.runtime.worker({ command: 'import', source: original, output: directory }))
      await validateWav(join(directory, 'reference.wav'))
      const asset = assetSchema.parse({ ...metadata, id, name: basename(source), hash, createdAt: new Date().toISOString() })
      const record = assetRecordSchema.parse({ version: 1, asset, originalFile, referenceHash: await fileHash(join(directory, 'reference.wav')) })
      await atomicJson(join(directory, 'asset.json'), record)
      this.assets.set(id, record)
      return asset
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    } finally { this.importing = false }
  }
  async start(input: unknown): Promise<AnalysisJob> {
    if (this.runtime.snapshot().busy) throw new Error('Wait for installation to finish before starting analysis.')
    const request = z.object({ assetId: idSchema, title: z.string().max(120), options: optionsSchema }).strict().parse(input)
    const asset = this.assets.get(request.assetId)
    if (!asset) throw new Error('The imported source is not in this library.')
    if (request.options.end > asset.asset.duration + 0.001) throw new Error('The selected excerpt ends after the source audio.')
    if ([...this.jobs.values()].filter(item => ['queued', 'running'].includes(item.job.state)).length >= 10) throw new Error('The local queue is full (10 jobs).')
    const id = randomUUID()
    const job: AnalysisJob = { ...request, id, state: 'queued', progress: 0, stage: 'Queued', error: null, createdAt: new Date().toISOString(), raw: null, reviewed: null, revision: 0 }
    const record: JobRecord = { version: 1, job, artifacts: {} }
    await mkdir(this.jobDir(id))
    await this.saveJob(record)
    this.jobs.set(id, record)
    setTimeout(() => { void this.pump() }, 0)
    return structuredClone(job)
  }
  async cancel(id: string) {
    const record = this.jobs.get(idSchema.parse(id))
    if (!record) throw new Error('Analysis not found.')
    if (!['queued', 'running'].includes(record.job.state)) throw new Error('This analysis is no longer cancellable.')
    if (this.active?.id === id) this.active.abort.abort()
    record.job.state = 'cancelled'
    record.job.stage = 'Cancelled; partial outputs are not published'
    await this.saveJob(record)
  }
  shutdown() { this.closing = true; this.active?.abort.abort(); this.runtime.cancel() }
  isWorking() { return this.importing || Boolean(this.active) || [...this.jobs.values()].some(item => item.job.state === 'queued') }
  private async pump() {
    if (this.active || this.closing) return
    const record = [...this.jobs.values()].find(item => item.job.state === 'queued')
    if (!record) return
    const { job } = record
    const abort = new AbortController()
    this.active = { id: job.id, abort }
    try {
      job.state = 'running'
      job.stage = 'Checking source integrity and local models'
      await this.saveJob(record)
      const source = await this.mediaFile(job.assetId, 'reference')
      const asset = this.assets.get(job.assetId)!
      if (await fileHash(join(this.assetDir(job.assetId), asset.originalFile)) !== asset.asset.hash) throw new Error('The stored original source is missing or has changed. Import it again; existing results were preserved.')
      const raw = resultSchema.parse(await this.runtime.worker({ command: 'analyze', source, output: this.jobDir(job.id), options: job.options }, (fraction, stage) => {
        if (job.state === 'running') { job.progress = fraction; job.stage = stage }
      }, abort.signal))
      if (abort.signal.aborted) throw new Error('Cancelled')
      validateReview(reviewSchema.strip().parse(raw), job)
      for (const timestamps of [raw.beats, raw.energy.map(frame => frame.time)]) {
        if (timestamps.some((time, index) => time < job.options.start - 0.01 || time > job.options.end + 0.01 || (index > 0 && time < timestamps[index - 1]))) throw new Error('Worker returned out-of-range or unordered evidence timestamps.')
      }
      if (raw.midi !== job.options.notes || raw.stems.length !== job.options.stems.length || raw.stems.some(stem => !job.options.stems.includes(stem))) throw new Error('Worker output does not match the requested stages.')
      for (const stem of raw.stems) {
        const path = join(this.jobDir(job.id), `${stem}.wav`)
        await validateWav(path)
        record.artifacts[`${stem}.wav`] = await fileHash(path)
      }
      if (raw.midi) {
        const path = join(this.jobDir(job.id), 'notes.mid')
        const bytes = await readFile(path)
        if (bytes.length < 22 || bytes.toString('ascii', 0, 4) !== 'MThd' || !bytes.includes(Buffer.from('MTrk'))) throw new Error('Invalid MIDI output')
        record.artifacts['notes.mid'] = await fileHash(path)
      }
      if (abort.signal.aborted) throw new Error('Cancelled')
      await writeFile(join(this.jobDir(job.id), 'raw.json'), JSON.stringify(raw), { flag: 'wx' })
      if (abort.signal.aborted) throw new Error('Cancelled')
      job.raw = raw
      job.reviewed = reviewSchema.strip().parse(raw)
      job.state = 'completed'
      job.progress = 1
      job.stage = 'Completed; estimates need review'
      await this.saveJob(record)
    } catch (error) {
      job.raw = null
      job.reviewed = null
      record.artifacts = {}
      job.state = abort.signal.aborted && !this.closing ? 'cancelled' : 'failed'
      job.error = (error instanceof Error ? error.message : String(error)).slice(-4000)
      job.stage = job.state === 'cancelled' ? 'Cancelled' : 'Failed; no output published'
      try { await this.saveJob(record) } catch (saveError) {
        this.errors.push(`Could not persist job ${job.id}: ${String(saveError)}. Keep the application open and check available disk space.`)
      }
    } finally {
      this.active = undefined
      void this.pump()
    }
  }
  async saveReview(input: unknown): Promise<AnalysisJob> {
    const request = z.object({ id: idSchema, revision: z.number().int().nonnegative(), reviewed: reviewSchema }).strict().parse(input)
    const record = this.jobs.get(request.id)
    if (!record || record.job.state !== 'completed') throw new Error('A completed analysis is required.')
    if (this.writes.has(request.id) || request.revision !== record.job.revision) throw new Error('This analysis changed elsewhere. Reload it before saving your edits.')
    this.writes.add(request.id)
    try {
      const updated = structuredClone(record)
      updated.job.reviewed = validateReview(request.reviewed, updated.job)
      updated.job.revision++
      await this.saveJob(updated)
      this.jobs.set(request.id, updated)
      return structuredClone(updated.job)
    } finally { this.writes.delete(request.id) }
  }
  async mediaFile(id: string, track: 'reference' | Stem): Promise<string> {
    idSchema.parse(id)
    let path: string
    let expected: string | undefined
    if (track === 'reference') {
      const record = this.assets.get(id)
      if (!record) throw new Error('Source not found')
      path = join(this.assetDir(id), 'reference.wav')
      expected = record.referenceHash
    } else {
      const record = this.jobs.get(id)
      if (!record || record.job.state !== 'completed' || !record.job.raw?.stems.includes(track)) throw new Error('Completed stem not found')
      path = join(this.jobDir(id), `${track}.wav`)
      expected = record.artifacts[`${track}.wav`]
    }
    if (!expected || await fileHash(path) !== expected) throw new Error('Audio is missing or has been replaced. Reimport or analyse again; existing results are preserved.')
    return path
  }
  async exportTo(id: string, kind: ExportKind, parent: string): Promise<string> {
    const record = this.jobs.get(idSchema.parse(id))
    if (!record || record.job.state !== 'completed' || !record.job.raw || !record.job.reviewed) throw new Error('Complete an analysis before exporting.')
    const asset = this.assets.get(record.job.assetId)
    if (!asset) throw new Error('The source provenance record is missing.')
    const { job } = structuredClone(record)
    const review = job.reviewed!
    if (['lrc', 'srt'].includes(kind) && !review.lyrics.length) throw new Error('There are no reviewed lyric lines to export.')
    if (kind === 'midi' && !job.raw!.midi) throw new Error('No MIDI was produced.')
    if (kind === 'stems' && !job.raw!.stems.length) throw new Error('No stems were produced.')
    const directory = join(parent, `SoundStudio-${id.slice(0, 8)}-${randomUUID().slice(0, 8)}`)
    await mkdir(directory, { recursive: false })
    try {
      const provenance = { schemaVersion: 1, source: asset.asset, analysis: job, exportedAt: new Date().toISOString(), timestampOrigin: 'original source seconds', artifactHashes: record.artifacts }
      // Every export includes provenance and both raw machine results and reviewed corrections.
      await writeFile(join(directory, 'analysis.json'), JSON.stringify(provenance, null, 2), { flag: 'wx' })
      if (kind === 'all' || kind === 'markdown') await writeFile(join(directory, 'brief.md'), `# Musical reference brief\n\n${reviewedBrief(job)}\n\nSource SHA-256: ${asset.asset.hash}\n\n${job.raw!.warnings.join('\n\n')}\n`, { flag: 'wx' })
      for (const format of ['lrc', 'srt'] as const) {
        if ((kind === 'all' && review.lyrics.length) || kind === format) await writeFile(join(directory, `lyrics.${format}`), lyricExport(review, format), { flag: 'wx' })
      }
      for (const [name, hash] of Object.entries(record.artifacts)) {
        if (kind !== 'all' && !(kind === 'midi' && name === 'notes.mid') && !(kind === 'stems' && name.endsWith('.wav'))) continue
        const source = join(this.jobDir(id), name)
        if (await fileHash(source) !== hash) throw new Error(`Output ${name} is missing or changed; export stopped.`)
        await copyFile(source, join(directory, name), constants.COPYFILE_EXCL)
      }
      return basename(directory)
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }
}
