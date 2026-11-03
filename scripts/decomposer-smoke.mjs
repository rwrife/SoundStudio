import assert from 'node:assert/strict'
// Independent desktop coverage for the local Decomposer, alongside generation smoke.
import { access, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const userData = await mkdtemp(join(tmpdir(), 'sound-studio-smoke-'))
const fixtures = await mkdtemp(join(tmpdir(), 'sound-studio-audio-'))
const capture = process.argv.includes('--screenshots')
const screenshots = resolve('docs\\screenshots')
const runtime = resolve(process.env.SOUND_STUDIO_TEST_RUNTIME || '.runtime')
let coreAvailable = false
try { await access(join(runtime, 'venv', 'Scripts', 'python.exe')); coreAvailable = true } catch {}
const errors = []
const diagnostics = []
const { ELECTRON_RUN_AS_NODE: _unused, ...environment } = process.env
let app
let page

function fixtureWav() {
  const rate = 22050
  const frames = rate * 8
  const data = Buffer.alloc(44 + frames * 2)
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(frames * 2, 40)
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / rate
    const tone = (Math.sin(2 * Math.PI * 261.63 * time) + Math.sin(2 * Math.PI * 329.63 * time) + Math.sin(2 * Math.PI * 392 * time)) / 3
    const pulse = Math.exp(-((time % 0.5) * 35))
    data.writeInt16LE(Math.round(tone * (0.25 + 0.5 * pulse) * 20000), 44 + frame * 2)
  }
  return data
}
async function launch() {
  app = await electron.launch({ args: [resolve('out\\main\\index.js'), `--user-data-dir=${userData}`], env: environment, timeout: 60000 })
  page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()) })
  app.process().stderr.on('data', data => diagnostics.push(String(data)))
  await page.getByRole('tab', { name: 'Effects', exact: true }).waitFor()
  await page.waitForFunction(() => localStorage.getItem('sound-studio.backend.v1'))
  await page.evaluate(() => {
    const backend = JSON.parse(localStorage.getItem('sound-studio.backend.v1'))
    backend.connectOnLaunch = false
    localStorage.setItem('sound-studio.backend.v1', JSON.stringify(backend))
  })
  await page.reload()
  await page.getByRole('tab', { name: 'Effects', exact: true }).waitFor()
}
async function assertNoOverflow() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  for (const selector of ['.settings-panel:visible', '.workflow-main:visible']) {
    assert.equal(await page.locator(selector).evaluate(element => element.scrollWidth <= element.clientWidth), true, `${selector} overflow`)
  }
}
async function chooseFile(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, path)
}
async function snapshot() { return page.evaluate(() => window.soundStudio.decomposer.library()) }
async function waitLibrary(predicate, label) {
  const deadline = Date.now() + 240000
  let state
  while (Date.now() < deadline) {
    state = await snapshot()
    if (predicate(state)) return state
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  assert.fail(`${label}: ${JSON.stringify(state)}`)
}
async function waitJob(id, state) {
  await waitLibrary(library => library.jobs.find(item => item.id === id)?.state === state, `Expected ${state}`)
}
try {
  if (capture) await mkdir(screenshots, { recursive: true })
  await launch()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000))
  await assertNoOverflow()
  assert.equal(await page.locator('.workspace-tabs svg').count(), 0)
  assert.equal(await page.locator('.workspace-tab-divider').count(), 2)
  assert.equal(await page.getByRole('tab', { name: 'Effects', exact: true }).evaluate(element => getComputedStyle(element).fontSize), '19px')
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  assert.deepEqual(await page.evaluate(() => Object.keys(window.soundStudio.decomposer).sort()), ['cancel', 'cancelInstall', 'export', 'importAudio', 'install', 'library', 'review', 'runtime', 'start'])
  assert.equal(await page.getByRole('button', { name: 'Play audio', exact: true }).isDisabled(), true)
  await page.getByLabel('Take name').fill('Forest ambience')
  await page.getByLabel('Describe your sound').fill('Rain through a forest canopy')
  await page.getByLabel('Seamless loop').check()
  await page.getByRole('button', { name: 'Model Settings', exact: true }).click()
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('dialog'))), true)
  await page.getByRole('button', { name: 'Music', exact: true }).click()
  assert.equal(await page.getByRole('heading', { name: 'ACE-Step 1.5 Turbo' }).isVisible(), true)
  await page.getByRole('button', { name: 'Decomposer', exact: true }).click()
  await page.getByRole('heading', { name: 'Local music decomposition' }).waitFor()
  await page.getByRole('button', { name: 'Download & install', exact: true }).first().waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('button', { name: 'Model Settings', exact: true }).evaluate(element => element === document.activeElement), true)
  await page.getByRole('tab', { name: 'Effects', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: 'Music', exact: true }).getAttribute('aria-selected'), 'true')
  await page.getByRole('button', { name: /After-hours thinking/ }).click()
  await page.getByLabel('Tempo', { exact: false }).fill('85')
  await page.getByLabel('Key', { exact: true }).selectOption('F# minor')
  await page.getByLabel('Instrumental only').uncheck()
  await page.getByLabel(/^Lyrics/).fill('[chorus]\nKeep this user-written refrain')
  await page.getByLabel('Instrumental only').check()
  await page.getByRole('button', { name: 'Continue to generation' }).click()
  assert.equal(await page.getByRole('button', { name: 'Generate music', exact: true }).isDisabled(), true)
  await page.getByRole('tab', { name: 'Decomposer', exact: true }).click()
  await page.getByRole('button', { name: /Starlight verse & hook/ }).click()
  assert.match(await page.getByLabel('Describe your analysis goal').inputValue(), /lead vocal/)
  await page.getByRole('button', { name: /^4 Export/ }).click()
  await page.getByRole('button', { name: 'Send unanalysed intent to Music' }).click()
  assert.equal(await page.getByRole('dialog', { name: 'Send brief to Music', exact: true }).isVisible(), true)
  await page.getByRole('button', { name: 'Cancel transfer' }).click()
  await page.getByRole('tab', { name: 'Music', exact: true }).click()
  await page.getByRole('button', { name: /^1 Describe/ }).click()
  assert.match(await page.getByLabel('Describe your music').inputValue(), /lo-fi/)
  await page.getByRole('tab', { name: 'Decomposer', exact: true }).click()
  await page.getByRole('button', { name: 'Send unanalysed intent to Music' }).click()
  await page.getByRole('button', { name: 'Append to Music draft' }).click()
  assert.match(await page.getByLabel('Describe your music').inputValue(), /lo-fi[\s\S]+Unanalysed intent/)
  assert.equal(await page.getByLabel('Tempo', { exact: false }).inputValue(), '85')
  assert.equal(await page.getByLabel('Key', { exact: true }).inputValue(), 'F# minor')
  await page.getByLabel('Instrumental only').uncheck()
  assert.match(await page.getByLabel(/^Lyrics/).inputValue(), /Keep this user-written refrain/)
  await page.getByLabel('Instrumental only').check()
  await page.getByRole('tab', { name: 'Decomposer', exact: true }).click()
  const source = join(fixtures, 'deterministic-chord-\u00e9.wav')
  await writeFile(source, fixtureWav())
  await chooseFile(source)
  await page.getByRole('button', { name: 'Import local audio' }).click()
  await page.getByRole('alert').filter({ hasText: /core audio runtime/ }).waitFor()
  assert.equal((await snapshot()).assets.length, 0)
  await app.close(); app = undefined
  if (coreAvailable) {
    await mkdir(join(userData, 'decomposer-runtime', 'models'), { recursive: true })
    await cp(join(runtime, 'venv'), join(userData, 'decomposer-runtime', 'venv'), { recursive: true })
  }
  await launch()
  await page.getByRole('tab', { name: 'Decomposer', exact: true }).click()
  let completedId
  if (coreAvailable) {
    const corrupt = join(fixtures, 'corrupt.wav')
    await writeFile(corrupt, Buffer.alloc(200, 1))
    await chooseFile(corrupt)
    await page.getByRole('button', { name: 'Import local audio' }).click()
    await page.getByRole('alert').waitFor()
    assert.equal((await snapshot()).assets.length, 0, 'Corrupt audio must not become an asset')
    await chooseFile(source)
    await page.getByRole('button', { name: 'Import local audio' }).click()
    await page.waitForFunction(() => document.querySelector('[aria-label="Decoded reference waveform"]') || [...document.querySelectorAll('[role="alert"]')].some(element => element.textContent.includes('Worker exited')), null, { timeout: 120000 })
    const importErrors = await page.getByRole('alert').allTextContents()
    assert.equal(await page.getByRole('img', { name: 'Decoded reference waveform' }).count(), 1, `Import failed: ${importErrors.join('\n')}`)
    const library = await snapshot()
    assert.equal(library.assets.length, 1)
    const asset = library.assets[0]
    assert.equal(asset.duration, 8)
    assert.ok(asset.peaks.some(value => value > 0))
    const range = await page.evaluate(async id => {
      const response = await fetch(`soundstudio://media/${id}/reference`, { headers: { Range: 'bytes=0-43' } })
      return { status: response.status, size: (await response.arrayBuffer()).byteLength }
    }, asset.id)
    assert.deepEqual(range, { status: 206, size: 44 })
    assert.equal(await page.evaluate(async () => (await fetch('soundstudio://media/invalid/reference')).status), 404)
    assert.match(await page.evaluate(async id => {
      try { await window.soundStudio.decomposer.start({ assetId: id, title: 'Invalid IPC', options: { start: 0, end: 8, stems: [], lyrics: 'none', notes: false, captions: false, wordTimestamps: false }, path: 'C:\\private.wav' }); return 'unexpected success' }
      catch (error) { return String(error) }
    }, asset.id), /Unrecognized|unrecognized/)
    await page.getByLabel('Excerpt end', { exact: true }).fill('8')
    await page.getByRole('button', { name: 'Play reference', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#decomposer-panel audio').currentTime > 0.1)
    await page.getByRole('button', { name: 'Pause reference', exact: true }).click()
    await page.getByLabel('Seek reference', { exact: true }).fill('2')
    assert.ok(await page.locator('#decomposer-panel audio').first().evaluate(audio => Math.abs(audio.currentTime - 2) < 0.1))
    await page.getByRole('button', { name: 'Analyse selected excerpt' }).click()
    const finished = await waitLibrary(library => library.jobs.some(job => ['failed', 'completed'].includes(job.state)), 'Expected DSP result')
    const completed = finished.jobs.find(job => job.state === 'completed')
    assert.ok(completed, JSON.stringify(finished.jobs))
    completedId = completed.id
    assert.equal(completed.raw.descriptions.length, 0, 'DSP must not pretend to be an audio caption model')
    assert.equal(completed.raw.lyrics.length, 0)
    assert.ok(completed.raw.energy.length > 0)
    await page.getByRole('button', { name: /^3 Review/ }).click()
    await page.getByLabel('Estimated key', { exact: true }).fill('C major - user corrected')
    await page.getByRole('button', { name: 'Add lyrics line' }).click()
    await page.getByLabel('lyrics 1 text', { exact: true }).fill('User-authored test line, not inferred lyrics')
    await page.getByRole('button', { name: 'Save reviewed corrections' }).click()
    await waitLibrary(library => library.jobs.find(job => job.id === completedId)?.revision === 1, 'Expected saved corrections')
    assert.notEqual((await snapshot()).jobs[0].raw.key, 'C major - user corrected')
    if (capture) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000))
      await page.locator('.workflow-main:visible').evaluate(element => { element.scrollTop = 0 })
      await page.locator('.settings-panel:visible').evaluate(element => { element.scrollTop = 0 })
      await page.screenshot({ path: join(screenshots, 'decomposer-workspace.png'), scale: 'css' })
    }
    await page.getByRole('button', { name: /^4 Export/ }).click()
    await chooseFile(fixtures)
    await page.getByRole('button', { name: 'Export all available' }).click()
    await page.getByRole('status').filter({ hasText: /Exported to new folder/ }).waitFor()
    const exported = (await readdir(fixtures)).find(name => name.startsWith('SoundStudio-'))
    assert.ok(exported)
    const json = JSON.parse(await readFile(join(fixtures, exported, 'analysis.json'), 'utf8'))
    assert.equal(json.analysis.reviewed.key, 'C major - user corrected')
    assert.ok((await readFile(join(fixtures, exported, 'lyrics.srt'), 'utf8')).includes('User-authored'))
    // Missing caption weights are deliberately not acquired by the test.
    const missing = await page.evaluate(async assetId => window.soundStudio.decomposer.start({
      assetId, title: 'Missing model check',
      options: { start: 0, end: 2, stems: [], lyrics: 'none', notes: false, captions: true, wordTimestamps: false }
    }), asset.id)
    await waitJob(missing.id, 'failed')
    assert.match((await snapshot()).jobs.find(job => job.id === missing.id).error, /caption|model|memory|install|RAM/i)
    const cancellation = await page.evaluate(async assetId => window.soundStudio.decomposer.start({
      assetId, title: 'Cancellation check',
      options: { start: 0, end: 8, stems: [], lyrics: 'none', notes: false, captions: false, wordTimestamps: false }
    }), asset.id)
    await page.evaluate(id => window.soundStudio.decomposer.cancel(id), cancellation.id)
    await waitJob(cancellation.id, 'cancelled')
  } else {
    console.log('DSP/import/export scenario not run: install core with npm run setup:analysis -- --root .runtime --profile core.')
    if (capture) await page.screenshot({ path: join(screenshots, 'decomposer-workspace.png'), scale: 'css' })
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 700))
  await assertNoOverflow()
  await page.getByRole('tab', { name: 'Effects', exact: true }).click()
  assert.equal(await page.getByLabel('Describe your sound').inputValue(), 'Rain through a forest canopy')
  await page.getByRole('tab', { name: 'Music', exact: true }).click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sound-studio.workspace.v3')).workspace === 'music')
  await app.close(); app = undefined
  await launch()
  assert.equal(await page.getByRole('tab', { name: 'Music', exact: true }).getAttribute('aria-selected'), 'true')
  assert.match(await page.getByLabel('Describe your music').inputValue(), /Unanalysed intent/)
  if (completedId) assert.equal((await snapshot()).jobs.find(job => job.id === completedId).reviewed.key, 'C major - user corrected')
  const generationV2 = await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('sound-studio.workspace.v3'))
    const legacy = JSON.stringify({ version: 2, workspace: current.workspace, drafts: current.drafts })
    localStorage.setItem('sound-studio.workspace.v1', legacy)
    localStorage.removeItem('sound-studio.workspace.v3')
    return legacy
  })
  await page.reload()
  await page.getByLabel('Describe your music').waitFor()
  assert.equal(await page.getByLabel('Key', { exact: true }).inputValue(), 'F# minor')
  await page.getByLabel('Instrumental only').uncheck()
  assert.match(await page.getByLabel(/^Lyrics/).inputValue(), /Keep this user-written refrain/)
  assert.equal(await page.evaluate(() => localStorage.getItem('sound-studio.workspace.v1')), generationV2)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sound-studio.workspace.v3')).version === 3)
  const analysisV2 = await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('sound-studio.workspace.v3'))
    current.version = 2
    current.decomposition.notes = true
    const legacy = JSON.stringify(current)
    localStorage.setItem('sound-studio.workspace.v2', legacy)
    localStorage.removeItem('sound-studio.workspace.v3')
    return legacy
  })
  await page.reload()
  await page.getByLabel('Describe your music').waitFor()
  assert.equal(await page.getByLabel('Key', { exact: true }).inputValue(), 'F# minor')
  assert.equal(await page.evaluate(() => localStorage.getItem('sound-studio.workspace.v2')), analysisV2)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sound-studio.workspace.v3')).decomposition.notes === true)
  const legacy = await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('sound-studio.workspace.v3'))
    const legacy = JSON.stringify({ version: 1, workspace: current.workspace, drafts: current.drafts })
    localStorage.setItem('sound-studio.workspace.v1', legacy)
    localStorage.removeItem('sound-studio.workspace.v2')
    localStorage.removeItem('sound-studio.workspace.v3')
    return legacy
  })
  await page.reload()
  await page.getByLabel('Describe your music').waitFor()
  assert.match(await page.getByLabel('Describe your music').inputValue(), /Unanalysed intent/)
  assert.equal(await page.evaluate(() => localStorage.getItem('sound-studio.workspace.v1')), legacy)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sound-studio.workspace.v3')).version === 3)
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') } })
  await page.getByLabel('Describe your music').fill('Still editable when storage is full')
  await page.getByRole('alert').filter({ hasText: /could not be saved/ }).waitFor()
  await page.reload()
  await page.evaluate(() => localStorage.setItem('sound-studio.workspace.v3', '{broken'))
  await page.reload()
  await page.getByRole('alert').filter({ hasText: /Could not load/ }).waitFor()
  await page.getByLabel('Describe your sound').fill('Unsaved but editable')
  assert.equal(await page.evaluate(() => localStorage.getItem('sound-studio.workspace.v3')), '{broken')
  assert.deepEqual(errors, [], 'No uncaught renderer exceptions')
  console.log(`Desktop smoke passed: sandbox/IPC, independent drafts/migration, handoff confirmation, dialogs, minimum layout, ${coreAvailable ? 'real decoder/DSP, playback/seeking, corrections, export, missing models, cancellation,' : 'missing runtime,'} restart persistence and corrupt storage. Synthetic audio tests DSP only, not ML.`)
} catch (error) {
  console.error(diagnostics.slice(-20).join('\n'))
  throw error
} finally {
  if (app) await app.close()
  await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  await rm(fixtures, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
