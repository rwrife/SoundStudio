import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const source = resolve(process.argv[2] || '.runtime\\model-evidence')
const temporary = await mkdtemp(join(tmpdir(), 'sound-studio-stems-'))
const { ELECTRON_RUN_AS_NODE: _unused, ...environment } = process.env
let app
try {
  const jobs = []
  for (const id of await readdir(join(source, 'analyses'))) {
    const record = JSON.parse(await readFile(join(source, 'analyses', id, 'job.json'), 'utf8'))
    if (record.job.state === 'completed' && record.job.raw?.stems.length === 4) jobs.push(record.job)
  }
  const job = jobs.sort((left, right) => left.createdAt.localeCompare(right.createdAt)).at(-1)
  assert.ok(job, 'Run the real-recording model smoke with --stems first.')
  await cp(join(source, 'assets'), join(temporary, 'decomposer', 'assets'), { recursive: true })
  await cp(join(source, 'analyses'), join(temporary, 'decomposer', 'analyses'), { recursive: true })
  app = await electron.launch({ args: [resolve('out\\main\\index.js'), `--user-data-dir=${temporary}`], env: environment })
  const page = await app.firstWindow()
  await page.getByRole('tab', { name: 'Effects', exact: true }).waitFor()
  await page.evaluate(job => {
    const state = JSON.parse(localStorage.getItem('sound-studio.workspace.v2'))
    state.workspace = 'decomposer'
    state.drafts.decomposer.step = 'review'
    state.decomposition = { assetId: job.assetId, analysisId: job.id, ...job.options }
    localStorage.setItem('sound-studio.workspace.v2', JSON.stringify(state))
  }, job)
  await page.reload()
  await page.getByRole('button', { name: 'Separated stems', exact: true }).click()
  await page.getByRole('button', { name: 'Play reference', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('#decomposer-panel audio')].length === 5 && [...document.querySelectorAll('#decomposer-panel audio')].every(audio => !audio.paused && audio.currentTime > 0.1))
  await page.getByRole('button', { name: 'Solo vocals', exact: true }).click()
  const muted = await page.locator('#decomposer-panel audio').evaluateAll(elements => elements.map(audio => ({ src: audio.src.split('/').at(-1), muted: audio.muted, time: audio.currentTime })))
  assert.equal(muted.find(track => track.src === 'reference').muted, true)
  assert.equal(muted.find(track => track.src === 'vocals').muted, false)
  assert.equal(muted.find(track => track.src === 'drums').muted, true)
  const referenceTime = muted.find(track => track.src === 'reference').time
  for (const track of muted.filter(track => track.src !== 'reference')) assert.ok(Math.abs(referenceTime - job.options.start - track.time) < 0.25, 'Stem playback follows source clock')
  await page.getByLabel('Seek reference', { exact: true }).fill(String(job.options.start + 1))
  await page.waitForFunction(start => {
    const audio = [...document.querySelectorAll('#decomposer-panel audio')]
    return audio.every(item => !item.paused) && audio.slice(1).every(item => Math.abs(audio[0].currentTime - start - item.currentTime) < 0.25)
  }, job.options.start)
  await page.getByRole('button', { name: 'Mute vocals', exact: true }).click()
  assert.equal(await page.locator('#decomposer-panel audio').evaluateAll(elements => elements.every(audio => audio.muted)), true)
  await page.getByRole('button', { name: 'Pause reference', exact: true }).click()
  assert.equal(await page.locator('#decomposer-panel audio').evaluateAll(elements => elements.every(audio => audio.paused)), true)
  await page.getByRole('button', { name: 'Original mix', exact: true }).click()
  await page.getByRole('tab', { name: 'Music', exact: true }).click()
  assert.equal(await page.locator('#decomposer-panel audio').evaluateAll(elements => elements.every(audio => audio.paused)), true)
  await page.getByRole('tab', { name: 'Decomposer', exact: true }).click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000))
  await page.locator('.workflow-main:visible').evaluate(element => { element.scrollTop = 0 })
  await page.locator('.settings-panel:visible').evaluate(element => { element.scrollTop = 0 })
  await mkdir(resolve('docs\\screenshots'), { recursive: true })
  await page.screenshot({ path: resolve('docs\\screenshots\\decomposer-stems.png'), scale: 'css' })
  console.log('Real separated-stem playback passed: five decoded tracks, source-relative seeking, mute, solo, pause and hidden-workspace pause.')
} finally {
  if (app) await app.close()
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
