import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AnalysisStore } from '../src/main/analysis-store'
import { LocalRuntime } from '../src/main/runtime'
import { defaultOptions, reviewedBrief, type Stem } from '../src/shared/decomposer'

function argument(name: string, fallback?: string) {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? fallback : process.argv[index + 1]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}
const runtimeRoot = resolve(argument('--runtime', '.runtime'))
const source = resolve(argument('--source'))
const output = resolve(argument('--output', '.runtime\\model-evidence'))
const start = Number(argument('--start', '20'))
const end = Number(argument('--end', '40'))
const cancelNative = process.argv.includes('--cancel-native')
if (cancelNative && !process.argv.includes('--captions-native')) throw new Error('--cancel-native requires --captions-native')
const stems: Stem[] = process.argv.includes('--stems') ? ['vocals', 'drums', 'bass', 'other'] : []
const runtime = new LocalRuntime(runtimeRoot, resolve('scripts\\analysis'))
const store = new AnalysisStore(output, runtime)
await store.initialize()
const asset = await store.importFile(source)
const job = await store.start({
  assetId: asset.id, title: 'Real recording validation',
  options: { ...defaultOptions, start, end, stems, lyrics: process.argv.includes('--lyrics-base') ? 'base' : process.argv.includes('--lyrics') ? 'tiny' : 'none', wordTimestamps: process.argv.includes('--words'), notes: process.argv.includes('--notes'), captions: process.argv.includes('--captions-native'), captionModel: process.argv.includes('--captions-native') ? 'captions-native' : 'captions' }
})
let lastStage = ''
while (true) {
  const current = store.snapshot().jobs.find(item => item.id === job.id)!
  if (current.stage !== lastStage) { console.log(current.stage); lastStage = current.stage }
  if (cancelNative && current.stage.startsWith('Describing audio window')) {
    const shell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const { stdout } = await promisify(execFile)(shell, ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'llama-mtmd-cli.exe' -and $_.CommandLine -like '*${job.id}*' } | Select-Object -ExpandProperty ProcessId`
    ], { windowsHide: true })
    const ids = stdout.trim().split(/\s+/).filter(Boolean).map(Number)
    if (ids.length) {
      assert.equal(ids.length, 1, 'Expected one native helper owned by this job')
      await store.cancel(job.id)
      const alive = () => {
        try { process.kill(ids[0], 0); return true } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
          throw error
        }
      }
      const deadline = Date.now() + 15000
      while ((store.isWorking() || alive()) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
      assert.equal(alive(), false, 'The owned native helper must terminate after cancellation')
      assert.equal(store.isWorking(), false)
      assert.equal(store.snapshot().jobs.find(item => item.id === job.id)?.state, 'cancelled')
      assert.equal(store.snapshot().jobs.find(item => item.id === job.id)?.raw, null)
      await assert.rejects(store.exportTo(job.id, 'all', output), /complete/i)
      console.log('Actual native helper cancellation passed: owned process exited, no raw result published and export refused.')
      break
    }
  }
  if (current.state === 'failed' || current.state === 'cancelled') throw new Error(current.error ?? current.state)
  if (current.state === 'completed') {
    assert.equal(cancelNative, false, 'The cancellation test must observe and stop the actual native helper')
    assert.ok(current.raw)
    assert.ok(current.raw.energy.length)
    assert.equal(current.raw.stems.length, stems.length)
    if (process.argv.includes('--lyrics') || process.argv.includes('--lyrics-base')) assert.ok(current.raw.lyrics.length, 'Expected nonempty transcription on this vocal excerpt; this does not assert accuracy')
    if (process.argv.includes('--notes')) assert.equal(current.raw.midi, true)
    if (process.argv.includes('--captions-native')) {
      assert.ok(current.raw.descriptions.length)
      for (const entry of current.raw.provenance.filter(item => item.stage.startsWith('captions-native-window-'))) {
        const evidence = JSON.parse(entry.details)
        assert.equal(evidence.completion.reason, 'eog')
        assert.equal(evidence.completion.limit, 256)
        assert.ok(evidence.completion.tokens <= 256)
        assert.ok(evidence.completion.peakWorkingSetBytes <= 8 * 1024 ** 3)
        assert.ok(evidence.completion.lowestAvailableBytes >= 2 * 1024 ** 3)
        assert.ok(evidence.input.start >= start && evidence.input.end <= end)
        assert.ok(evidence.input.samples <= 480000)
      }
      const reviewed = { ...current.reviewed!, descriptions: current.raw.descriptions.map(line => ({ ...line, text: `User-reviewed validation copy: ${line.text}` })) }
      await store.saveReview({ id: job.id, revision: current.revision, reviewed })
      assert.match(reviewedBrief(store.snapshot().jobs.find(item => item.id === job.id)!), /User-reviewed validation copy/)
      const reopened = new AnalysisStore(output, runtime)
      await reopened.initialize()
      assert.equal(reopened.snapshot().jobs.find(item => item.id === job.id)?.options.captionModel, 'captions-native')
      assert.deepEqual(reopened.snapshot().jobs.find(item => item.id === job.id)?.raw, current.raw)
    }
    const exports = join(output, 'exports')
    await mkdir(exports, { recursive: true })
    const exported = await store.exportTo(job.id, 'all', exports)
    if (process.argv.includes('--captions-native')) {
      const structured = JSON.parse(await readFile(join(exports, exported, 'analysis.json'), 'utf8'))
      assert.deepEqual(structured.analysis.raw.descriptions, current.raw.descriptions)
      assert.match(structured.analysis.reviewed.descriptions[0].text, /^User-reviewed validation copy:/)
      assert.equal(structured.source.hash, asset.hash)
    }
    for (const stem of stems) {
      const bytes = await readFile(join(exports, exported, `${stem}.wav`))
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
      assert.ok(bytes.length > 10000)
    }
    console.log(JSON.stringify({
      sourceHash: asset.hash, sourceDuration: asset.duration, excerpt: { start, end }, jobId: job.id,
      stems: current.raw.stems, midi: current.raw.midi, lyricLines: current.raw.lyrics.length,
      firstLyric: current.raw.lyrics[0], tempo: current.raw.tempo, key: current.raw.key,
      descriptions: current.raw.descriptions, provenance: current.raw.provenance, warnings: current.raw.warnings, exportFolder: exported
    }, null, 2))
    break
  }
  await new Promise(resolve => setTimeout(resolve, 1000))
}
store.shutdown()
