import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

// Reopens real managed inference evidence; never fabricates captions or downloads models.
const source = resolve(process.argv[2] || '.runtime\\native-profile-evidence')
const temporary = await mkdtemp(join(tmpdir(), 'sound-studio-captions-'))
const { ELECTRON_RUN_AS_NODE: _unused, ...environment } = process.env
let app
try {
  const jobs = []
  for (const id of await readdir(join(source, 'analyses'))) {
    const record = JSON.parse(await readFile(join(source, 'analyses', id, 'job.json'), 'utf8'))
    if (record.job.state === 'completed' && record.job.options.captionModel === 'captions-native' && record.job.raw?.descriptions.length) jobs.push(record.job)
  }
  const job = jobs.sort((left, right) => left.createdAt.localeCompare(right.createdAt)).at(-1)
  assert.ok(job, 'Run model-smoke.ts with --captions-native on a lawful real recording first.')
  await cp(join(source, 'assets'), join(temporary, 'decomposer', 'assets'), { recursive: true })
  await cp(join(source, 'analyses'), join(temporary, 'decomposer', 'analyses'), { recursive: true })
  const exports = join(temporary, 'exports')
  await mkdir(exports)
  async function launch() {
    app = await electron.launch({ args: [resolve('out\\main\\index.js'), `--user-data-dir=${temporary}`], env: environment })
    const page = await app.firstWindow()
    page.setDefaultTimeout(30000)
    await page.getByRole('tab', { name: 'Decomposer', exact: true }).waitFor()
    return page
  }
  let page = await launch()
  await page.getByRole('tab', { name: 'Music', exact: true }).click()
  await page.getByLabel('Describe your music').fill('Keep this existing Music draft.')
  await page.getByRole('tab', { name: 'Decomposer', exact: true }).click()
  await page.getByRole('button', { name: /^Analysis library/ }).click()
  await page.getByRole('button', { name: new RegExp(`^${job.title} / completed`) }).last().click()
  const summaries = page.locator('.review-editor summary')
  const descriptions = summaries.filter({ hasText: /^descriptions \(/ })
  if (!await descriptions.evaluate(element => element.parentElement.open)) await descriptions.click()
  const text = page.getByLabel('descriptions 1 text', { exact: true })
  await text.waitFor()
  assert.equal(await page.getByLabel('descriptions 1 start', { exact: true }).inputValue(), String(job.raw.descriptions[0].start))
  assert.equal(await page.getByLabel('descriptions 1 end', { exact: true }).inputValue(), String(job.raw.descriptions[0].end))
  await summaries.filter({ hasText: 'Raw machine evidence and provenance (read-only)' }).click()
  const raw = JSON.parse(await page.locator('.review-editor pre').innerText())
  assert.deepEqual(raw, job.raw)
  assert.ok(raw.provenance.some(row => row.stage.startsWith('captions-native-window-') && JSON.parse(row.details).completion.reason === 'eog'))
  await summaries.filter({ hasText: 'Raw machine evidence and provenance (read-only)' }).click()
  if (process.argv.includes('--screenshots')) {
    const displayed = job.raw.descriptions[0].text.trim().replace(/\r\n/g, '\n')
    await text.fill(displayed)
    await page.getByRole('button', { name: 'Save reviewed corrections' }).click()
    await page.waitForFunction(({ id, displayed }) => window.soundStudio.decomposer.library().then(value => value.jobs.find(job => job.id === id)?.reviewed.descriptions[0].text === displayed), { id: job.id, displayed })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000))
    for (const label of [/^chords \(/, /^sections \(/]) {
      const summary = summaries.filter({ hasText: label })
      if (await summary.evaluate(element => element.parentElement.open)) await summary.click()
    }
    await page.getByRole('region', { name: 'Editable analysis results' }).scrollIntoViewIfNeeded()
    await page.locator('.workflow-main:visible').evaluate(element => { element.scrollTop = Math.max(0, element.scrollTop - 70) })
    await page.locator('.settings-panel:visible').evaluate(element => { element.scrollTop = 0 })
    await text.evaluate(element => { element.scrollTop = 0 })
    await mkdir(resolve('docs\\screenshots'), { recursive: true })
    await page.screenshot({ path: resolve('docs\\screenshots\\decomposer-captions.png'), scale: 'css' })
  }
  const corrected = `Desktop review copy: ${job.raw.descriptions[0].text.trim().replace(/\r\n/g, '\n')}`
  await text.fill(corrected)
  await page.getByRole('button', { name: 'Save reviewed corrections' }).click()
  await page.waitForFunction(({ id, corrected }) => window.soundStudio.decomposer.library().then(value => value.jobs.find(job => job.id === id)?.reviewed.descriptions[0].text === corrected), { id: job.id, corrected })
  await page.getByRole('button', { name: /^2 Analyse/ }).click()
  assert.equal(await page.getByLabel('Description model', { exact: true }).inputValue(), 'captions-native')
  await page.getByRole('button', { name: 'Model Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Decomposer', exact: true }).click()
  await page.getByRole('heading', { name: 'Qwen2.5-Omni Q4 qualitative descriptions', exact: true }).waitFor()
  await page.getByRole('heading', { name: 'Qwen2-Audio 7B (unverified)', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByLabel('Description model', { exact: true }).inputValue(), 'captions-native')
  await page.getByRole('button', { name: /^4 Export/ }).click()
  await app.evaluate(({ dialog }, exports) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [exports] }) }, exports)
  await page.getByRole('button', { name: 'Export all available' }).click()
  await page.getByRole('status').filter({ hasText: /Exported to new folder/ }).waitFor()
  const folder = (await readdir(exports)).find(name => name.startsWith('SoundStudio-'))
  const exported = JSON.parse(await readFile(join(exports, folder, 'analysis.json'), 'utf8'))
  assert.deepEqual(exported.analysis.raw, job.raw)
  assert.equal(exported.analysis.options.captionModel, 'captions-native')
  assert.equal(exported.analysis.reviewed.descriptions[0].text, corrected)
  const markdown = await readFile(join(exports, folder, 'brief.md'), 'utf8')
  assert.ok(markdown.includes(corrected))
  await page.getByRole('button', { name: 'Send saved reviewed brief to Music' }).click()
  await page.getByRole('button', { name: 'Cancel transfer' }).click()
  await page.getByRole('tab', { name: 'Music', exact: true }).click()
  assert.equal(await page.getByLabel('Describe your music').inputValue(), 'Keep this existing Music draft.')
  await page.getByRole('tab', { name: 'Decomposer', exact: true }).click()
  await page.getByRole('button', { name: 'Send saved reviewed brief to Music' }).click()
  await page.getByRole('button', { name: 'Append to Music draft' }).click()
  const music = await page.getByLabel('Describe your music').inputValue()
  assert.ok(music.startsWith('Keep this existing Music draft.'))
  assert.ok(music.includes(corrected.replace(/\r\n/g, '\n')))
  await app.close(); app = undefined
  page = await launch()
  assert.equal(await page.getByLabel('Describe your music').inputValue(), music)
  const library = await page.evaluate(() => window.soundStudio.decomposer.library())
  assert.deepEqual(library.jobs.find(item => item.id === job.id).raw, job.raw)
  assert.equal(library.jobs.find(item => item.id === job.id).reviewed.descriptions[0].text, corrected.replace(/\r\n/g, '\n'))
  console.log('Real native caption desktop checks passed: library reopening, source timestamps, immutable raw evidence, edits, explicit profile persistence, model settings, JSON/Markdown exports, confirmed Music handoff and restart.')
} finally {
  if (app) await app.close()
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
