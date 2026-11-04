import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AnalysisStore, lyricExport, validateWav } from '../src/main/analysis-store'
import { command, LocalRuntime } from '../src/main/runtime'
import { defaultOptions, optionsSchema, resultSchema, reviewedBrief, type AnalysisJob, type AnalysisResult } from '../src/shared/decomposer'

function wav() {
  const data = Buffer.alloc(44 + 44100 * 2)
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(44100, 24); data.writeUInt32LE(88200, 28); data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(data.length - 44, 40)
  return data
}
const result: AnalysisResult = {
  tempo: null, key: 'Unknown', chords: [], sections: [], descriptions: [], lyrics: [],
  beats: [], energy: [], stems: [], midi: false,
  warnings: ['Deterministic storage test only, not ML evidence.'], provenance: []
}
class ContractRuntime extends LocalRuntime {
  fail = false
  wait = false
  override async worker(input: Record<string, unknown>, _progress?: (fraction: number, stage: string) => void, signal?: AbortSignal): Promise<unknown> {
    if (input.command === 'import') {
      await writeFile(join(String(input.output), 'reference.wav'), wav())
      return { duration: 1, sampleRate: 44100, channels: 1, peaks: [0] }
    }
    if (this.fail) throw new Error('Deliberate worker crash')
    if (this.wait) await new Promise<void>((_resolve, reject) => {
      if (signal?.aborted) reject(new Error('Cancelled'))
      else signal?.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })
    })
    return structuredClone(result)
  }
}
async function eventually(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('Timed out waiting for job transition')
}
test('strict analysis options reject paths, non-finite/out-of-bounds excerpts and unknown fields', () => {
  for (const patch of [{ end: 0 }, { start: -1 }, { end: 601 }, { end: NaN }, { stems: ['../../file'] }, { source: 'C:\\private.wav' }, { end: .5, captions: true, captionModel: 'captions-native' }, { captionModel: 'automatic' }]) {
    assert.equal(optionsSchema.safeParse({ ...defaultOptions, ...patch }).success, false)
  }
})
test('native captions route through separate sequential processes and cannot publish a failed second phase', async () => {
  class PhasedRuntime extends LocalRuntime {
    calls: Record<string, unknown>[] = []
    failCaptions = false
    override async invokeWorker(input: Record<string, unknown>, progress: (fraction: number, stage: string) => void): Promise<unknown> {
      this.calls.push(input)
      progress(1, String(input.command))
      if (input.command === 'native-describe') {
        if (this.failCaptions) throw new Error('Incomplete native response (length)')
        return { descriptions: [{ start: 0, end: 1, text: 'Contract routing fixture, not model evidence.' }], warnings: [], provenance: [] }
      }
      return structuredClone(result)
    }
  }
  const runtime = new PhasedRuntime('unused', 'unused')
  const input = { command: 'analyze', source: 'unchanged reference', output: 'same job', options: { ...defaultOptions, end: 1, captions: true, captionModel: 'captions-native' } }
  const progress: number[] = []
  const output = resultSchema.parse(await runtime.worker(input, fraction => progress.push(fraction)))
  assert.deepEqual(runtime.calls.map(call => call.command), ['analyze-base', 'native-describe'])
  assert.ok(runtime.calls.every(call => call.options === input.options && call.source === input.source && call.output === input.output))
  assert.deepEqual(progress, [.45, 1])
  assert.equal(output.descriptions.length, 1)
  runtime.calls = []; runtime.failCaptions = true
  await assert.rejects(runtime.worker(input), /Incomplete native/)
  assert.deepEqual(runtime.calls.map(call => call.command), ['analyze-base', 'native-describe'])
  runtime.calls = []
  await runtime.worker({ ...input, options: { ...input.options, captionModel: 'captions' } })
  assert.deepEqual(runtime.calls.map(call => call.command), ['analyze'])
})
test('a replaced source between analysis phases is not published as the original recording', async () => {
  const root = await mkdtemp(join(tmpdir(), 'decomposer-source-change-'))
  class ChangingRuntime extends ContractRuntime {
    override async worker(input: Record<string, unknown>): Promise<unknown> {
      const value = await super.worker(input)
      if (input.command === 'analyze') {
        const replaced = wav(); replaced.writeInt16LE(100, 44)
        await writeFile(String(input.source), replaced)
      }
      return value
    }
  }
  const store = new AnalysisStore(join(root, 'data'), new ChangingRuntime(root, root))
  try {
    await store.initialize()
    const source = join(root, 'source.wav'); await writeFile(source, wav())
    const asset = await store.importFile(source)
    await store.start({ assetId: asset.id, title: 'Integrity', options: { ...defaultOptions, end: 1 } })
    await eventually(() => store.snapshot().jobs[0].state === 'failed')
    assert.equal(store.snapshot().jobs[0].raw, null)
    assert.match(store.snapshot().jobs[0].error ?? '', /replaced|changed/)
  } finally { store.shutdown(); await rm(root, { recursive: true, force: true }) }
})
test('reviewed handoff retains long edited evidence without substituting raw findings', () => {
  const edited = 'Reviewed observation. '.repeat(400)
  const job: AnalysisJob = {
    id: randomUUID(), assetId: randomUUID(), title: 'Reviewed source', state: 'completed',
    progress: 1, stage: 'Completed', error: null, createdAt: new Date().toISOString(),
    options: { ...defaultOptions, end: 1 }, raw: result,
    reviewed: { tempo: 123, key: 'User key', chords: [], sections: [], lyrics: [], descriptions: [{ start: 0, end: 1, text: edited }] }, revision: 1
  }
  const brief = reviewedBrief(job)
  assert.ok(brief.includes(edited))
  assert.ok(brief.length > 4000)
  assert.match(brief, /User key/)
  assert.match(brief, /not verified musical truth/)
  assert.throws(() => reviewedBrief({ ...job, state: 'failed' }), /No completed analysis/)
})
test('timestamp exports round across minute boundaries and keep valid cue separators', () => {
  const review = { tempo: null, key: '', chords: [], sections: [], descriptions: [], lyrics: [{ start: 59.999, end: 61, text: 'First\n\n\n\nSecond' }] }
  assert.match(lyricExport(review, 'lrc'), /^\[01:00.00\]/)
  assert.equal(lyricExport(review, 'srt'), '1\n00:00:59,999 --> 00:01:01,000\nFirst\nSecond\n')
})
test('durable store preserves sources, raw results, corrections and non-overwriting exports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'decomposer-store-'))
  const runtime = new ContractRuntime(join(root, 'runtime'), root)
  const store = new AnalysisStore(join(root, 'data'), runtime)
  try {
    await store.initialize()
    const source = join(root, 'song.wav')
    await writeFile(source, wav())
    const asset = await store.importFile(source)
    assert.equal(asset.duration, 1)
    assert.equal(asset.name, 'song.wav')
    assert.doesNotMatch(JSON.stringify(asset), /original\.wav|C:\\/)
    const job = await store.start({ assetId: asset.id, title: 'Source study', options: { ...defaultOptions, end: 1 } })
    await eventually(() => store.snapshot().jobs[0].state === 'completed')
    const completed = store.snapshot().jobs[0]
    assert.equal(completed.raw?.descriptions.length, 0)
    const reviewed = { ...completed.reviewed!, tempo: 120, lyrics: [{ start: 0.1, end: 0.9, text: 'User correction' }] }
    await store.saveReview({ id: job.id, revision: 0, reviewed })
    await assert.rejects(store.saveReview({ id: job.id, revision: 0, reviewed }), /changed elsewhere/)
    await assert.rejects(store.saveReview({ id: job.id, revision: 1, reviewed: { ...reviewed, lyrics: [{ start: 0, end: 2, text: 'bad' }] } }), /timestamps/)
    assert.equal(store.snapshot().jobs[0].raw?.lyrics.length, 0)
    assert.match(reviewedBrief(store.snapshot().jobs[0]), /User correction/)
    assert.match(lyricExport(reviewed, 'lrc'), /\[00:00.10\]User correction/)
    assert.match(lyricExport(reviewed, 'srt'), /00:00:00,100 --> 00:00:00,900/)
    const first = await store.exportTo(job.id, 'all', root)
    const second = await store.exportTo(job.id, 'all', root)
    assert.notEqual(first, second)
    const exported = JSON.parse(await readFile(join(root, first, 'analysis.json'), 'utf8'))
    assert.equal(exported.source.hash, asset.hash)
    assert.equal(exported.analysis.reviewed.tempo, 120)
    assert.equal(exported.analysis.raw.tempo, null)
    const reopened = new AnalysisStore(join(root, 'data'), runtime)
    await reopened.initialize()
    assert.equal(reopened.snapshot().jobs[0].reviewed?.tempo, 120)
    await writeFile(join(root, 'data', 'assets', asset.id, 'reference.wav'), 'replaced')
    await assert.rejects(reopened.mediaFile(asset.id, 'reference'), /replaced/)
    await assert.rejects(reopened.mediaFile('../../private', 'reference'))
    await assert.rejects(reopened.importFile(join(root, 'song.txt')), /Unsupported/)
    await assert.rejects(reopened.exportTo(job.id, 'midi', root), /No MIDI/)
  } finally { store.shutdown(); await rm(root, { recursive: true, force: true }) }
})
test('queue cancellation, worker crashes and restart recovery never publish success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'decomposer-jobs-'))
  const runtime = new ContractRuntime(join(root, 'runtime'), root)
  const store = new AnalysisStore(join(root, 'data'), runtime)
  try {
    await store.initialize()
    const source = join(root, 'song.wav'); await writeFile(source, wav())
    const asset = await store.importFile(source)
    const input = { assetId: asset.id, title: 'Tests', options: { ...defaultOptions, end: 1 } }
    runtime.wait = true
    const first = await store.start(input)
    await eventually(() => store.snapshot().jobs[0].state === 'running')
    const second = await store.start(input)
    assert.equal(store.snapshot().jobs[1].state, 'queued')
    await store.cancel(second.id)
    await store.cancel(first.id)
    await eventually(() => !store.isWorking())
    assert.ok(store.snapshot().jobs.every(job => job.state === 'cancelled' && job.raw === null))
    runtime.wait = false; runtime.fail = true
    const failed = await store.start(input)
    await eventually(() => store.snapshot().jobs.find(job => job.id === failed.id)?.state === 'failed')
    assert.match(store.snapshot().jobs[2].error ?? '', /worker crash/)
    const interrupted = { ...store.snapshot().jobs[2], state: 'running', error: null }
    await writeFile(join(root, 'data', 'analyses', failed.id, 'job.json'), JSON.stringify({ version: 2, job: interrupted, artifacts: {} }))
    const corruptId = randomUUID()
    await mkdir(join(root, 'data', 'assets', corruptId))
    await writeFile(join(root, 'data', 'assets', corruptId, 'asset.json'), '{"version":99}')
    const reopened = new AnalysisStore(join(root, 'data'), runtime)
    await reopened.initialize()
    assert.match(reopened.snapshot().jobs.find(job => job.id === failed.id)?.error ?? '', /Interrupted/)
    assert.equal(reopened.snapshot().errors.length, 1)
    assert.equal(await readFile(join(root, 'data', 'assets', corruptId, 'asset.json'), 'utf8'), '{"version":99}')
  } finally { store.shutdown(); await rm(root, { recursive: true, force: true }) }
})
test('worker subprocess errors and aborts propagate, invalid WAV is rejected', async () => {
  await assert.rejects(command(process.execPath, ['-e', 'console.error("crashed");process.exit(2)'], undefined, () => {}), /crashed/)
  const abort = new AbortController()
  const run = command(process.execPath, ['-e', 'setInterval(()=>{},1000)'], undefined, () => {}, abort.signal)
  setTimeout(() => abort.abort(), 50)
  await assert.rejects(run, /Cancelled/)
  const root = await mkdtemp(join(tmpdir(), 'decomposer-wav-'))
  try {
    const path = join(root, 'bad.wav'); await writeFile(path, 'not a WAV')
    await assert.rejects(validateWav(path))
    assert.equal((await readdir(root)).length, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('legacy saved analyses retain their original caption selection and raw evidence without rewriting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'decomposer-migration-'))
  const runtime = new ContractRuntime(join(root, 'runtime'), root)
  const store = new AnalysisStore(join(root, 'data'), runtime)
  try {
    await store.initialize()
    const source = join(root, 'song.wav'); await writeFile(source, wav())
    const asset = await store.importFile(source)
    const job = await store.start({ assetId: asset.id, title: 'Legacy', options: { ...defaultOptions, end: 1 } })
    await eventually(() => store.snapshot().jobs[0].state === 'completed')
    const path = join(root, 'data', 'analyses', job.id, 'job.json')
    const record = JSON.parse(await readFile(path, 'utf8'))
    record.version = 1
    record.job.options.captions = true
    delete record.job.options.captionModel
    const legacy = JSON.stringify(record)
    await writeFile(path, legacy)
    const reopened = new AnalysisStore(join(root, 'data'), runtime)
    await reopened.initialize()
    assert.equal(reopened.snapshot().jobs[0].options.captionModel, 'captions')
    assert.equal(reopened.snapshot().jobs[0].options.captions, true)
    assert.deepEqual(reopened.snapshot().jobs[0].raw, record.job.raw)
    assert.equal(await readFile(path, 'utf8'), legacy)
    record.version = 99
    const unsupported = JSON.stringify(record)
    await writeFile(path, unsupported)
    const invalid = new AnalysisStore(join(root, 'data'), runtime)
    await invalid.initialize()
    assert.equal(invalid.snapshot().jobs.length, 0)
    assert.equal(invalid.snapshot().errors.length, 1)
    assert.equal(await readFile(path, 'utf8'), unsupported)
  } finally { store.shutdown(); await rm(root, { recursive: true, force: true }) }
})
