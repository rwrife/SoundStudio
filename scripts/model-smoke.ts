import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { AnalysisStore } from '../src/main/analysis-store'
import { LocalRuntime } from '../src/main/runtime'
import { defaultOptions, type Stem } from '../src/shared/decomposer'

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
const stems: Stem[] = process.argv.includes('--stems') ? ['vocals', 'drums', 'bass', 'other'] : []
const runtime = new LocalRuntime(runtimeRoot, resolve('scripts\\analysis'))
const store = new AnalysisStore(output, runtime)
await store.initialize()
const asset = await store.importFile(source)
const job = await store.start({
  assetId: asset.id, title: 'Real recording validation',
  options: { ...defaultOptions, start, end, stems, lyrics: process.argv.includes('--lyrics-base') ? 'base' : process.argv.includes('--lyrics') ? 'tiny' : 'none', wordTimestamps: process.argv.includes('--words'), notes: process.argv.includes('--notes') }
})
let lastStage = ''
while (true) {
  const current = store.snapshot().jobs.find(item => item.id === job.id)!
  if (current.stage !== lastStage) { console.log(current.stage); lastStage = current.stage }
  if (current.state === 'failed' || current.state === 'cancelled') throw new Error(current.error ?? current.state)
  if (current.state === 'completed') {
    assert.ok(current.raw)
    assert.ok(current.raw.energy.length)
    assert.equal(current.raw.stems.length, stems.length)
    if (process.argv.includes('--lyrics') || process.argv.includes('--lyrics-base')) assert.ok(current.raw.lyrics.length, 'Expected nonempty transcription on this vocal excerpt; this does not assert accuracy')
    if (process.argv.includes('--notes')) assert.equal(current.raw.midi, true)
    const exports = join(output, 'exports')
    await mkdir(exports, { recursive: true })
    const exported = await store.exportTo(job.id, 'all', exports)
    for (const stem of stems) {
      const bytes = await readFile(join(exports, exported, `${stem}.wav`))
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
      assert.ok(bytes.length > 10000)
    }
    console.log(JSON.stringify({
      sourceHash: asset.hash, sourceDuration: asset.duration, excerpt: { start, end }, jobId: job.id,
      stems: current.raw.stems, midi: current.raw.midi, lyricLines: current.raw.lyrics.length,
      firstLyric: current.raw.lyrics[0], tempo: current.raw.tempo, key: current.raw.key,
      provenance: current.raw.provenance, warnings: current.raw.warnings, exportFolder: exported
    }, null, 2))
    break
  }
  await new Promise(resolve => setTimeout(resolve, 1000))
}
store.shutdown()
