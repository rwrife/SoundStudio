import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const capture = process.argv.includes('--screenshots')
const screenshots = resolve('docs/screenshots')
const errors = []
const { ELECTRON_RUN_AS_NODE: _unused, ...environment } = process.env
const executableIndex = process.argv.indexOf('--executable')
const executablePath = executableIndex === -1 ? undefined : process.argv[executableIndex + 1]
if (executableIndex !== -1 && (!executablePath || executablePath.startsWith('--'))) {
  throw new Error('--executable requires the path to a packaged application.')
}
const userData = await mkdtemp(join(tmpdir(), 'sound-studio-smoke-'))
let app

async function launch() {
  const instance = await electron.launch({
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    args: [...(executablePath ? [] : [resolve('out/main/index.js')]), `--user-data-dir=${userData}`],
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

try {
  if (capture) await mkdir(screenshots, { recursive: true })
  let page = await launch()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000))
  await assertNoOverflow(page)
  assert.equal(await page.locator('.workspace-tabs svg').count(), 0, 'Workspace tabs are text-only')
  assert.equal(await page.locator('.workspace-tab-divider').count(), 2)
  assert.equal(await page.locator('.workspace-tab-divider').first().textContent(), '|')
  assert.equal(await page.locator('.workspace-tab-divider').first().getAttribute('aria-hidden'), 'true')
  assert.match(await page.locator('.brand').innerText(), /sound studio/)
  assert.match(await page.getByRole('tab', { name: 'Effects', exact: true }).evaluate(element => getComputedStyle(element).fontFamily), /Segoe UI Variable/)
  assert.equal(await page.getByRole('tab', { name: 'Effects', exact: true }).evaluate(element => getComputedStyle(element).fontSize), '19px')
  assert.equal(await page.getByRole('tab', { name: 'Decomposer', exact: true }).evaluate(element => getComputedStyle(element).fontSize), '19px')
  const tabBounds = await page.getByRole('tab', { name: 'Effects', exact: true }).boundingBox()
  const headerBounds = await page.locator('.topbar').boundingBox()
  assert.ok(tabBounds.y + tabBounds.height < headerBounds.y + headerBounds.height - 10, 'Tab underline sits near the label, above the header edge')
  assert.equal(await page.getByRole('button', { name: 'Play audio', exact: true }).isDisabled(), true)
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  assert.equal(await page.evaluate(() => typeof window.soundStudio?.platform), 'string')
  if (capture) await page.screenshot({ path: join(screenshots, 'effects-workspace.png'), scale: 'css', animations: 'disabled', caret: 'hide' })

  await page.getByLabel('Take name').fill('Forest ambience')
  await page.getByLabel('Describe your sound').fill('Rain through a forest canopy')
  await page.getByLabel('Seamless loop').check()
  await page.getByRole('button', { name: 'Model Settings', exact: true }).click()
  await page.getByRole('dialog', { name: 'Model Settings', exact: true }).waitFor()
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('dialog'))), true, 'Modal must contain keyboard focus')
  await page.getByRole('button', { name: 'Music', exact: true }).click()
  assert.equal(await page.getByRole('heading', { name: 'Local music generation' }).isVisible(), true)
  await page.getByRole('button', { name: 'Decomposer', exact: true }).click()
  assert.equal(await page.getByRole('heading', { name: 'Local music decomposition' }).isVisible(), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Model Settings', exact: true }).evaluate(element => element === document.activeElement), true)
  assert.equal(await page.getByLabel('Describe your sound').inputValue(), 'Rain through a forest canopy')

  await page.getByRole('tab', { name: 'Effects', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: 'Music', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByLabel('Describe your music').inputValue(), '')
  if (capture) {
    await page.evaluate(() => document.activeElement?.blur())
    await page.screenshot({ path: join(screenshots, 'music-workspace.png'), scale: 'css', animations: 'disabled', caret: 'hide' })
  }
  await page.getByRole('button', { name: /After-hours thinking/ }).click()
  assert.match(await page.getByLabel('Describe your music').inputValue(), /lo-fi/)
  assert.equal(await page.getByLabel('Genre').inputValue(), 'Lo-fi')
  await page.getByLabel('Tempo').fill('85')
  await page.getByRole('button', { name: 'Continue to generation' }).click()
  assert.equal(await page.getByRole('button', { name: 'Generate music', exact: true }).isDisabled(), true)
  assert.match(await page.locator('.summary-card').innerText(), /lo-fi/)
  await page.getByRole('button', { name: /Review & refine/ }).click()
  assert.equal(await page.getByRole('button', { name: 'Play take', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: /^4 Export/ }).click()
  assert.equal(await page.getByRole('button', { name: 'Export audio', exact: true }).isDisabled(), true)

  await page.getByRole('tab', { name: 'Music', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: 'Decomposer', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByLabel('Describe your analysis goal').inputValue(), '')
  assert.equal(await page.getByLabel('Separate stems').isChecked(), true)
  assert.equal(await page.getByLabel('Transcribe lyrics').isChecked(), true)
  if (capture) {
    await page.evaluate(() => document.activeElement?.blur())
    await page.screenshot({ path: join(screenshots, 'decomposer-workspace.png'), scale: 'css', animations: 'disabled', caret: 'hide' })
  }
  await page.getByRole('button', { name: /Starlight verse & hook/ }).click()
  assert.match(await page.getByLabel('Describe your analysis goal').inputValue(), /lead vocal stem/)
  assert.equal(await page.getByLabel('Analysis focus').inputValue(), 'Lyrics & vocals')
  await page.getByLabel('Reference tempo').fill('118')
  await page.getByRole('button', { name: 'Continue to decomposition' }).click()
  assert.equal(await page.getByRole('button', { name: 'Decompose track', exact: true }).isDisabled(), true)
  assert.match(await page.locator('.summary-card').innerText(), /With lyrics/)
  assert.match(await page.getByLabel('Planned analysis stages').innerText(), /Stem separation/)
  await page.getByRole('button', { name: /Review & refine/ }).click()
  assert.equal(await page.getByRole('button', { name: 'Play reference', exact: true }).isDisabled(), true)
  assert.match(await page.getByLabel('Breakdown review layers').innerText(), /Lyric transcript/)
  await page.getByRole('button', { name: /^4 Export/ }).click()
  assert.equal(await page.getByRole('button', { name: 'Export breakdown', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: /Send brief to Music workspace/ }).click()
  assert.equal(await page.getByRole('tab', { name: 'Music', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByLabel('Tempo').inputValue(), '118')
  assert.match(await page.getByLabel('Describe your music').inputValue(), /Lyrics & vocals/)
  await page.getByLabel('Tempo').fill('85')
  await page.getByRole('button', { name: /After-hours thinking/ }).click()
  await page.getByRole('button', { name: /^4 Export/ }).click()

  await page.getByRole('button', { name: 'Open library', exact: true }).click()
  assert.equal(await page.getByRole('dialog', { name: 'Sound library' }).isVisible(), true)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Backend not connected/ }).click()
  assert.equal(await page.getByRole('heading', { name: 'No backend connected' }).isVisible(), true)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Quick guide' }).click()
  assert.equal(await page.getByRole('dialog', { name: 'A small guide to the studio' }).isVisible(), true)
  await page.keyboard.press('Escape')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 700))
  await assertNoOverflow(page)
  await page.getByRole('tab', { name: 'Effects', exact: true }).click()
  assert.equal(await page.getByLabel('Describe your sound').inputValue(), 'Rain through a forest canopy')
  assert.equal(await page.getByLabel('Seamless loop').isChecked(), true)

  await page.getByRole('tab', { name: 'Music', exact: true }).click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sound-studio.workspace.v1')).workspace === 'music')
  await app.close()
  app = undefined
  page = await launch()
  assert.equal(await page.getByRole('tab', { name: 'Music', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByRole('button', { name: 'Export audio', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: /^1 Describe/ }).click()
  assert.equal(await page.getByLabel('Tempo').inputValue(), '85')
  assert.match(await page.getByLabel('Describe your music').inputValue(), /lo-fi/)

  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError') }
  })
  await page.getByLabel('Describe your music').fill('Still editable when storage is full')
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /could not be saved/)
  assert.match(await page.locator('.saved-state').innerText(), /memory only/)
  await page.reload()
  await page.getByLabel('Describe your music').waitFor()
  assert.match(await page.getByLabel('Describe your music').inputValue(), /lo-fi/)

  await page.evaluate(() => localStorage.setItem('sound-studio.workspace.v1', '{broken'))
  await page.reload()
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /Could not load/)
  assert.equal(await page.evaluate(() => localStorage.getItem('sound-studio.workspace.v1')), '{broken')
  await page.getByLabel('Describe your sound').fill('Unsaved but still editable')
  assert.match(await page.locator('.saved-state').innerText(), /memory only/)
  assert.equal(await page.evaluate(() => localStorage.getItem('sound-studio.workspace.v1')), '{broken')
  assert.deepEqual(errors, [], 'No renderer errors or CSP violations')
  console.log('Desktop smoke passed: both workspaces, drafts, navigation, dialogs, disabled placeholders, relaunch persistence, corrupt-storage handling, and minimum window size.')
} finally {
  if (app) await app.close()
  await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
