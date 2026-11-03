import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { createFakeComfyInstall, freePort, reachable } from './fake-comfyui-install.mjs'
import { startMockComfyUI } from './mock-comfyui.mjs'

// Exercises the real Electron app. Generation runs against a mock ComfyUI that returns a synthesized test tone,
// so this proves job handling, validation, storage and export, not model quality. Screenshots are captured
// before connecting so the documentation never shows mock output.
const userData = await mkdtemp(join(tmpdir(), 'sound-studio-smoke-'))
const exportDir = await mkdtemp(join(tmpdir(), 'sound-studio-export-'))
// LOCALAPPDATA points at a temporary folder so install detection finds only the fake ComfyUI below.
const localAppData = await mkdtemp(join(tmpdir(), 'sound-studio-local-'))
const capture = process.argv.includes('--screenshots')
const screenshots = resolve('docs/screenshots')
const errors = []
const { ELECTRON_RUN_AS_NODE: _unused, ...inherited } = process.env
const environment = { ...inherited, LOCALAPPDATA: localAppData }
const apiKey = 'comfyui-smoke-test-key-0123456789abcdef'
const mock = await startMockComfyUI()
const fakeComfy = await createFakeComfyInstall(localAppData)
let app

async function launch() {
  const instance = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userData}`],
    env: environment,
    timeout: 60_000
  })
  app = instance
  const page = await instance.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.getByRole('tab', { name: 'Effects', exact: true }).waitFor()
  return page
}

async function assertNoOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Window must not overflow horizontally')
  for (const selector of ['.settings-panel', '.workflow-main']) {
    assert.equal(await page.locator(selector).evaluate(element => element.scrollWidth <= element.clientWidth), true, `${selector} must not overflow horizontally`)
  }
}

const jobStatus = (page, status) => page.locator('.job-card .eyebrow', { hasText: new RegExp(`^${status}`) }).waitFor({ timeout: 30_000 })
const expectTakes = (page, count) => page.locator('.takes-section .section-heading .count', { hasText: new RegExp(`^${count}$`) }).waitFor({ timeout: 10_000 })
const actionReason = page => page.locator('#action-reason').innerText()
const lastPrompt = () => mock.prompts.at(-1).body

async function stopsAnswering(endpoint) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!await reachable(endpoint)) return true
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return false
}

async function openModels(page, { advanced = true } = {}) {
  await page.getByRole('button', { name: 'Model Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Model Settings', exact: true })
  const details = dialog.locator('details.advanced-settings')
  if (advanced && !(await details.evaluate(element => element.open))) await details.locator('summary').click()
  return dialog
}

async function writeBrief(page, fields) {
  await page.getByRole('button', { name: /^1 Describe/ }).click()
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(new RegExp(`^${label}`)).fill(value)
  await page.getByRole('button', { name: 'Continue to generation' }).click()
}

const backendButton = page => page.locator('.backend-button')
const check = (dialog, name) => dialog.locator('li.check').filter({ has: dialog.page().locator('strong', { hasText: name }) })
const offline = `http://127.0.0.1:${await freePort()}`

try {
  if (capture) await mkdir(screenshots, { recursive: true })
  let page = await launch()
  // A first run checks the default address for ComfyUI. Point it at a closed port so a ComfyUI the developer
  // happens to be running is never touched by the test.
  await page.waitForFunction(() => localStorage.getItem('sound-studio.backend.v1') !== null)
  await page.evaluate(endpoint => {
    const settings = JSON.parse(localStorage.getItem('sound-studio.backend.v1'))
    if (settings.connectOnLaunch !== true) throw new Error('A first run should check for a local ComfyUI')
    localStorage.setItem('sound-studio.backend.v1', JSON.stringify({ ...settings, endpoint }))
  }, offline)
  await page.reload()
  await page.getByRole('tab', { name: 'Effects', exact: true }).waitFor()
  await page.getByRole('button', { name: /^Setup needs attention/ }).waitFor({ timeout: 15_000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000))
  await assertNoOverflow(page)
  assert.equal(await page.locator('.workspace-tabs svg').count(), 0, 'Workspace tabs are text-only')
  assert.equal(await page.locator('.workspace-tab-divider').textContent(), '|')
  assert.equal(await page.locator('.workspace-tab-divider').getAttribute('aria-hidden'), 'true')
  assert.match(await page.locator('.brand').innerText(), /sound studio/)
  assert.match(await page.getByRole('tab', { name: 'Effects', exact: true }).evaluate(element => getComputedStyle(element).fontFamily), /Segoe UI Variable/)
  assert.equal(await page.getByRole('tab', { name: 'Effects', exact: true }).evaluate(element => getComputedStyle(element).fontSize), '19px')
  const tabBounds = await page.getByRole('tab', { name: 'Effects', exact: true }).boundingBox()
  const headerBounds = await page.locator('.topbar').boundingBox()
  assert.ok(tabBounds.y + tabBounds.height < headerBounds.y + headerBounds.height - 10, 'Tab underline sits near the label, above the header edge')
  assert.equal(await page.getByRole('button', { name: 'Play audio', exact: true }).isDisabled(), true)
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  assert.equal(await page.evaluate(() => typeof window.soundStudio?.platform), 'string')
  assert.equal(await page.evaluate(() => typeof window.soundStudio?.startGeneration), 'function')
  assert.match(await page.locator('.setup-warning').innerText(), /ComfyUI is not running/)
  assert.equal(await page.getByRole('button', { name: 'Model: Local / Stable Audio Open 1.0. Needs setup. Open Model Settings' }).isVisible(), true)
  assert.match(await page.locator('.statusbar').innerText(), /No cloud\. No uploads\./)
  if (capture) await page.screenshot({ path: join(screenshots, 'effects-workspace.png'), scale: 'css', animations: 'disabled', caret: 'hide' })

  await page.getByLabel('Take name').fill('Forest ambience')
  await page.getByLabel('Describe your sound').fill('Rain through a forest canopy')
  await page.getByLabel('Seamless loop').check()
  let models = await openModels(page, { advanced: false })
  await models.waitFor()
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('dialog'))), true, 'Modal must contain keyboard focus')
  // First run shows only the recommended model; choosing models and files is under Advanced.
  assert.equal(await models.locator('details.advanced-settings').evaluate(element => element.open), false)
  assert.equal(await models.getByRole('radio', { name: /^Stable Audio Open 1\.0/ }).isVisible(), false)
  assert.match(await models.locator('.model-card').innerText(), /NEEDS SETUP[\s\S]*Connect to a local ComfyUI server/)
  if (capture) await page.screenshot({ path: join(screenshots, 'model-settings.png'), scale: 'css', animations: 'disabled', caret: 'hide' })
  await models.locator('details.advanced-settings summary').click()
  for (const heading of ['On this device', 'Cloud partner models', 'Your ComfyUI workflow']) assert.equal(await models.getByRole('heading', { name: heading, exact: true }).first().isVisible(), true)
  for (const label of [/^Stable Audio Open 1\.0/, /^Mirelo SFX 2\.0/, /^ByteDance Seed Audio 1\.0/, /^Custom ComfyUI workflow/]) assert.equal(await models.getByRole('radio', { name: label }).count(), 1)
  assert.equal(await models.getByRole('radio', { name: /^Stable Audio Open 1\.0 \(recommended\)/ }).isChecked(), true)
  assert.equal(await models.getByRole('checkbox', { name: /Allow cloud partner models/ }).isDisabled(), true)
  await models.getByRole('button', { name: 'Music', exact: true }).click()
  assert.equal(await models.getByRole('radio', { name: /^ACE-Step 1\.5 Turbo/ }).isChecked(), true)
  assert.equal(await models.getByRole('radio', { name: /^ACE-Step v1 3\.5B/ }).count(), 1)
  assert.equal(await models.getByRole('radio', { name: /^Mirelo/ }).count(), 0, 'Effects-only cloud models are not offered for music')
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Model Settings', exact: true }).evaluate(element => element === document.activeElement), true)
  assert.equal(await page.getByLabel('Describe your sound').inputValue(), 'Rain through a forest canopy')

  await page.getByRole('tab', { name: 'Effects', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: 'Music', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByLabel('Describe your music').inputValue(), '')
  assert.equal(await page.getByLabel('Key', { exact: true }).inputValue(), 'C major')
  await page.getByLabel('Instrumental only').uncheck()
  assert.equal(await page.getByLabel(/^Lyrics/).isVisible(), true)
  await page.getByLabel('Instrumental only').check()
  if (capture) await page.screenshot({ path: join(screenshots, 'music-workspace.png'), scale: 'css', animations: 'disabled', caret: 'hide' })
  await page.getByRole('button', { name: /After-hours thinking/ }).click()
  assert.match(await page.getByLabel('Describe your music').inputValue(), /lo-fi/)
  assert.equal(await page.getByLabel('Genre').inputValue(), 'Lo-fi')
  await page.getByLabel('Tempo').fill('85')
  await page.getByRole('button', { name: 'Continue to generation' }).click()
  assert.equal(await page.getByRole('button', { name: 'Generate music', exact: true }).isDisabled(), true)
  assert.equal(await actionReason(page), 'Connect to ComfyUI to generate.')
  assert.match(await page.locator('.summary-card').innerText(), /lo-fi/)
  await page.getByRole('button', { name: /Review & refine/ }).click()
  assert.equal(await page.getByRole('button', { name: 'Continue to export', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: /^4 Export/ }).click()
  assert.equal(await page.getByRole('button', { name: 'Export audio', exact: true }).isDisabled(), true)

  await page.getByRole('button', { name: 'Open library', exact: true }).click()
  assert.match(await page.getByRole('dialog', { name: 'Sound library' }).innerText(), /No takes yet/)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Quick guide' }).click()
  assert.equal(await page.getByRole('dialog', { name: 'A small guide to the studio' }).isVisible(), true)
  await page.keyboard.press('Escape')

  await backendButton(page).click()
  const connections = page.getByRole('dialog', { name: 'Backend connections' })
  assert.equal(await connections.getByRole('list', { name: 'Readiness checks' }).isVisible(), true)
  assert.match(await check(connections, 'ComfyUI server').innerText(), /needs attention/)
  assert.match(await check(connections, 'Music model').innerText(), /ACE-Step 1\.5 Turbo\. Checked once ComfyUI is running/)
  // The fake install lives under the user's temporary folder, so its path is masked rather than published.
  if (capture) await page.screenshot({ path: join(screenshots, 'backend-connections.png'), scale: 'css', animations: 'disabled', caret: 'hide', maskColor: '#2b3a52',
    mask: [connections.getByLabel(/^ComfyUI folder/), check(connections, 'ComfyUI folder').locator('p')] })
  await connections.getByLabel(/ComfyUI address/).fill('http://example.com:8188')
  await connections.getByLabel(/ComfyUI address/).press('Enter')
  await check(connections, 'ComfyUI server').getByText(/Only ComfyUI running on this device/).waitFor()
  assert.equal(await page.getByRole('button', { name: /^Setup needs attention/ }).isVisible(), true)

  // One-click start: the detected folder is prefilled, starting installs the WAV output node, and the canvas
  // button launches on loopback and connects.
  if (fakeComfy) {
    assert.equal(await connections.getByLabel(/^ComfyUI folder/).inputValue(), fakeComfy.folder)
    assert.equal(await connections.getByRole('button', { name: 'Start local ComfyUI' }).isDisabled(), false)
    assert.match(await check(connections, 'Audio output node').innerText(), /Not installed yet/)
    await connections.getByLabel(/ComfyUI address/).fill(fakeComfy.endpoint)
    await connections.getByLabel(/ComfyUI address/).press('Enter')
    await check(connections, 'ComfyUI server').getByRole('button', { name: 'Start', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    // Declines the model download Sound Studio offers after one-click start, so the smoke never touches the network.
    await app.evaluate(({ dialog }) => {
      globalThis.downloadPrompts = []
      dialog.showMessageBox = async (...args) => { globalThis.downloadPrompts.push(args.at(-1)); return { response: 1, checkboxChecked: false } }
    })
    await page.getByRole('button', { name: 'Start local ComfyUI' }).click()
    await backendButton(page).click()
    await check(connections, 'ComfyUI server').getByText(/ComfyUI 0\.3\.0-launched at .*, started by Sound Studio\./).waitFor({ timeout: 60_000 })
    await check(connections, 'Effects model').getByRole('button', { name: 'Download' }).waitFor()
    const prompts = await app.evaluate(() => globalThis.downloadPrompts)
    assert.equal(prompts.length, 1, 'the missing default models are offered once')
    assert.match(prompts[0].message, /^Download Stable Audio Open 1\.0, T5-base text encoder, and ACE-Step 1\.5 Turbo \(14\.7 GB\)\?/)
    assert.match(prompts[0].detail, /Stability AI Community License[\s\S]*SHA-256/)
    assert.match(await check(connections, 'Effects model').innerText(), /Stable Audio Open 1\.0 is not downloaded yet \(5\.4 GB\)/)
    assert.match(await check(connections, 'Music model').innerText(), /ACE-Step 1\.5 Turbo is not downloaded yet \(9\.3 GB\)/)
    assert.equal(await connections.getByRole('button', { name: /^Download models \(14\.7 GB\)/ }).isVisible(), true)
    assert.equal(existsSync(join(fakeComfy.folder, 'models', 'checkpoints')), false, 'declining downloads nothing')
    assert.match(await check(connections, 'Audio output node').innerText(), /Save Audio WAV \(Sound Studio\) is loaded/)
    assert.match(await readFile(join(fakeComfy.folder, 'custom_nodes', 'sound_studio_nodes', '__init__.py'), 'utf8'), /^# Managed by Sound Studio/)
    assert.match(await check(connections, 'Graphics processor').innerText(), /reports no GPU/)
    assert.deepEqual(JSON.parse(await readFile(join(fakeComfy.folder, 'launch-args.json'), 'utf8')), ['--listen', '127.0.0.1', '--port', fakeComfy.port, '--disable-auto-launch'])
    assert.match(await readFile(join(userData, 'logs', 'comfyui.log'), 'utf8'), /Sound Studio started ComfyUI[\s\S]*Fake ComfyUI listening on 127\.0\.0\.1/)
    await connections.getByRole('button', { name: 'Stop ComfyUI' }).click()
    await connections.getByText('ComfyUI stopped.').waitFor()
    await check(connections, 'ComfyUI server').getByText('ComfyUI is not running.').waitFor()
    assert.equal(await stopsAnswering(fakeComfy.endpoint), true, 'Stop ends the process Sound Studio started')
  } else {
    console.warn('Python was not found, so the ComfyUI launcher check was skipped.')
  }
  await connections.getByLabel(/ComfyUI address/).fill(mock.endpoint)
  await connections.getByLabel(/ComfyUI address/).press('Enter')
  await page.getByRole('button', { name: /^Local backends ready/ }).waitFor()
  assert.match(await check(connections, 'ComfyUI server').innerText(), /ComfyUI 0\.3\.0-mock/)
  assert.match(await check(connections, 'Graphics processor').innerText(), /Mock GPU \/ 16 GB/)
  assert.match(await check(connections, 'Effects model').innerText(), /stable-audio-open-1\.0\.safetensors/)
  assert.match(await check(connections, 'Music model').innerText(), /ace_step_1\.5_turbo_aio\.safetensors/)
  await page.keyboard.press('Escape')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 700))
  await assertNoOverflow(page)

  // Local generation through the Stable Audio graph.
  await page.getByRole('tab', { name: 'Effects', exact: true }).click()
  assert.equal(await page.getByLabel('Seamless loop').isChecked(), true)
  await page.getByRole('button', { name: 'Continue to generation' }).click()
  assert.equal(await page.getByRole('button', { name: 'Model: Local / Stable Audio Open 1.0. Ready. Open Model Settings' }).isVisible(), true)
  assert.equal(await actionReason(page), 'Runs on your ComfyUI. Nothing leaves this device.')
  await page.getByRole('button', { name: 'Generate sound', exact: true }).click()
  await jobStatus(page, 'Completed')
  const localPrompt = lastPrompt()
  assert.equal(localPrompt.extra_data?.api_key_comfy_org, undefined, 'Local jobs never carry an API key')
  assert.equal(Object.values(localPrompt.prompt).find(node => node.class_type === 'CheckpointLoaderSimple').inputs.ckpt_name, 'stable-audio-open-1.0.safetensors')
  assert.equal(Object.values(localPrompt.prompt).some(node => node.class_type === 'SoundStudioSaveWAV'), true, 'Jobs save through the WAV node when ComfyUI has it')
  assert.match(JSON.stringify(localPrompt.prompt), /Rain through a forest canopy/)
  await page.getByRole('img', { name: 'Waveform of Forest ambience' }).waitFor()
  assert.match(await page.locator('.canvas-toolbar').innerText(), /WAV \/ 44\.1 KHZ \/ MONO/)
  await expectTakes(page, 1)
  await page.getByRole('button', { name: 'Play take', exact: true }).click()
  await page.getByRole('button', { name: 'Pause take', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Pause take', exact: true }).click()
  await page.getByRole('button', { name: 'Play take', exact: true }).waitFor()

  // Failures and cancellations stay honest and never create takes.
  await writeBrief(page, { 'Describe your sound': 'FAIL on purpose' })
  await page.getByRole('button', { name: 'Generate sound', exact: true }).click()
  await jobStatus(page, 'Failed')
  assert.match(await page.locator('.job-card').innerText(), /Mock failure requested/)
  await writeBrief(page, { 'Describe your sound': 'SLOW on purpose' })
  await page.getByRole('button', { name: 'Generate sound', exact: true }).click()
  await jobStatus(page, 'Generating')
  assert.equal(await page.getByRole('button', { name: 'Generate sound', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await jobStatus(page, 'Cancelled')
  await expectTakes(page, 1)

  // Cloud partner models need an explicit opt-in and a stored key, and the key is only sent for partner jobs.
  models = await openModels(page)
  await models.getByRole('radio', { name: /^Mirelo SFX 2\.0/ }).check()
  assert.match(await models.getByRole('list', { name: 'Setup needed' }).innerText(), /Enable cloud partner models/)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('button', { name: 'Generate sound', exact: true }).isDisabled(), true)
  assert.equal(await actionReason(page), 'Finish model setup to generate.')
  models = await openModels(page)
  await models.locator('#cloud-key').fill(apiKey)
  await models.getByRole('button', { name: 'Store key' }).click()
  await models.getByText('API key stored.').waitFor()
  assert.equal((await readFile(join(userData, 'cloud-access.json'), 'utf8')).includes(apiKey), false, 'The API key is never stored in plain text')
  await models.getByRole('checkbox', { name: /Allow cloud partner models/ }).click()
  await models.getByText('Cloud partner models enabled.').waitFor()
  assert.equal(await models.getByRole('checkbox', { name: /Allow cloud partner models/ }).isChecked(), true)
  await models.locator('.model-card .outline-badge', { hasText: 'READY' }).waitFor()
  await page.keyboard.press('Escape')
  assert.match(await page.locator('.statusbar').innerText(), /Cloud partner models enabled/)
  await writeBrief(page, { 'Take name': 'Cloud rain', 'Describe your sound': 'Rain through a forest canopy' })
  assert.match(await actionReason(page), /^Sends your prompt to Mirelo via Comfy\.org\. About \$\d+\.\d\d\.$/)
  await page.getByRole('button', { name: 'Generate sound', exact: true }).click()
  await jobStatus(page, 'Completed / CLOUD')
  assert.equal(lastPrompt().extra_data?.api_key_comfy_org, apiKey)
  assert.equal(Object.values(lastPrompt().prompt).some(node => node.class_type === 'MireloTextToSFX'), true)
  await expectTakes(page, 2)
  models = await openModels(page)
  await models.getByRole('button', { name: 'Remove key' }).click()
  await models.getByText('API key removed and cloud models disabled.').waitFor()
  await models.getByRole('radio', { name: /^Stable Audio Open 1\.0/ }).check()
  await page.keyboard.press('Escape')
  assert.match(await page.locator('.statusbar').innerText(), /No cloud\. No uploads\./)

  // Music: ACE-Step 1.5, then an imported MusicGen-style custom workflow.
  await page.getByRole('tab', { name: 'Music', exact: true }).click()
  await page.getByRole('button', { name: /^2 Generate/ }).click()
  assert.equal(await actionReason(page), 'Runs on your ComfyUI. Nothing leaves this device.')
  await page.getByRole('button', { name: 'Generate music', exact: true }).click()
  await jobStatus(page, 'Completed')
  const aceGraph = Object.values(lastPrompt().prompt)
  assert.equal(aceGraph.find(node => node.class_type === 'TextEncodeAceStepAudio1.5').inputs.bpm, 85)
  assert.equal(aceGraph.find(node => node.class_type === 'CheckpointLoaderSimple').inputs.ckpt_name, 'ace_step_1.5_turbo_aio.safetensors')

  models = await openModels(page)
  await models.getByRole('radio', { name: /^Custom ComfyUI workflow/ }).check()
  assert.match(await models.getByRole('list', { name: 'Setup needed' }).innerText(), /Import a ComfyUI API workflow/)
  const musicgen = {
    1: { class_type: 'MusicgenGenerate', inputs: { prompt: '{{prompt}}', duration: '{{seconds}}', seed: '{{seed}}', bpm: '{{bpm}}' } },
    2: { class_type: 'SaveAudio', inputs: { audio: ['1', 0], filename_prefix: 'musicgen' } }
  }
  await models.locator('#music-workflow-file').setInputFiles({ name: 'musicgen-small.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(musicgen)) })
  await models.getByText(/musicgen-small \/ 2 nodes/).waitFor()
  await models.locator('.model-card .outline-badge', { hasText: 'READY' }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('button', { name: 'Model: Workflow / musicgen-small. Ready. Open Model Settings' }).isVisible(), true)
  await page.getByRole('button', { name: 'Generate music', exact: true }).click()
  await jobStatus(page, 'Completed')
  const custom = lastPrompt().prompt
  assert.equal(custom['1'].inputs.bpm, 85)
  assert.equal(custom['1'].inputs.duration, 30)
  assert.equal(typeof custom['1'].inputs.seed, 'number')
  assert.match(custom['1'].inputs.prompt, /lo-fi/)
  await expectTakes(page, 2)

  // Export copies the validated audio and writes provenance beside it.
  const exportPath = join(exportDir, 'after-hours.wav')
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, exportPath)
  await page.getByRole('button', { name: 'Review take' }).click()
  await page.getByRole('button', { name: 'Continue to export', exact: true }).click()
  await page.getByRole('button', { name: 'Export audio', exact: true }).click()
  const exportFeedback = page.locator('.settings-panel').locator('.success-text, .warning-text[role="alert"]')
  await exportFeedback.waitFor()
  assert.match(await exportFeedback.innerText(), /^Exported to .*after-hours\.wav with a \.provenance\.json record beside it\.$/)
  assert.equal((await readFile(exportPath)).subarray(0, 4).toString(), 'RIFF')
  const provenance = JSON.parse(await readFile(join(exportDir, 'after-hours.provenance.json'), 'utf8'))
  assert.match(JSON.stringify(provenance), /musicgen-small/)
  assert.match(JSON.stringify(provenance), /lo-fi/)

  // The library lists every take, reports unreadable records without touching them, and deletes on confirmation.
  const takesDir = join(userData, 'takes')
  const garbage = join(takesDir, '00000000-0000-4000-8000-000000000000.json')
  await writeFile(garbage, '{not a take')
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
  await page.getByRole('button', { name: 'Open library', exact: true }).click()
  const library = page.getByRole('dialog', { name: 'Sound library' })
  assert.equal(await library.locator('.library-list li').count(), 4)
  await library.getByRole('button', { name: 'Delete Cloud rain' }).click()
  await library.getByText('Deleted "Cloud rain".').waitFor()
  assert.equal(await library.locator('.library-list li').count(), 3)
  assert.match(await library.innerText(), /1 take record could not be read/)
  assert.equal(await readFile(garbage, 'utf8'), '{not a take')
  assert.equal((await readdir(takesDir)).filter(name => name.endsWith('.wav')).length, 3)
  await page.keyboard.press('Escape')

  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sound-studio.workspace.v1')).workspace === 'music')
  await app.close()
  app = undefined
  page = await launch()
  await page.getByRole('button', { name: /^Local backends ready/ }).waitFor({ timeout: 15_000 })
  assert.equal(await page.getByRole('tab', { name: 'Music', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByRole('button', { name: 'Model: Workflow / musicgen-small. Ready. Open Model Settings' }).isVisible(), true)
  await expectTakes(page, 2)
  await page.getByRole('img', { name: /^Waveform of / }).waitFor()
  await page.getByRole('button', { name: /^1 Describe/ }).click()
  assert.equal(await page.getByLabel('Tempo').inputValue(), '85')
  assert.match(await page.getByLabel('Describe your music').inputValue(), /lo-fi/)

  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError') }
  })
  await page.getByLabel('Describe your music').fill('Still editable when storage is full')
  await page.locator('.error-banner').waitFor()
  assert.match(await page.locator('.error-banner').innerText(), /could not be saved/)
  assert.match(await page.locator('.saved-state').innerText(), /memory only/)
  await page.reload()
  await page.getByLabel('Describe your music').waitFor()
  assert.match(await page.getByLabel('Describe your music').inputValue(), /lo-fi/)

  await page.evaluate(() => localStorage.setItem('sound-studio.workspace.v1', '{broken'))
  await page.reload()
  await page.locator('.error-banner').waitFor()
  assert.match(await page.locator('.error-banner').innerText(), /Could not load/)
  assert.equal(await page.evaluate(() => localStorage.getItem('sound-studio.workspace.v1')), '{broken')
  await page.getByLabel('Describe your sound').fill('Unsaved but still editable')
  assert.match(await page.locator('.saved-state').innerText(), /memory only/)
  assert.equal(await page.evaluate(() => localStorage.getItem('sound-studio.workspace.v1')), '{broken')

  // The dialog's start button, and quitting stops only the ComfyUI that Sound Studio started.
  if (fakeComfy) {
    await backendButton(page).click()
    const backendDialog = page.getByRole('dialog', { name: 'Backend connections' })
    await backendDialog.getByRole('button', { name: 'Disconnect' }).click()
    await backendDialog.getByLabel(/ComfyUI address/).fill(fakeComfy.endpoint)
    await backendDialog.getByRole('button', { name: 'Start local ComfyUI' }).click()
    await check(backendDialog, 'ComfyUI server').getByText(/started by Sound Studio/).waitFor({ timeout: 60_000 })
    await app.close()
    app = undefined
    assert.equal(await stopsAnswering(fakeComfy.endpoint), true, 'Quitting stops the ComfyUI Sound Studio started')
    assert.equal(await reachable(mock.endpoint), true, 'A ComfyUI started elsewhere is never stopped')
  }  assert.deepEqual(errors, [], 'No renderer errors or CSP violations')
  console.log(`Desktop smoke passed against a mock ComfyUI (${mock.prompts.length} prompts): connection policy, ${fakeComfy ? 'starting and stopping a ComfyUI install, ' : ''}local, failed, cancelled, cloud opt-in and custom-workflow jobs, playback, export with provenance, library delete, relaunch persistence, corrupt-storage handling and minimum window size.`)
} finally {
  if (app) await app.close()
  await mock.close()
  await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  await rm(exportDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  await rm(localAppData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
