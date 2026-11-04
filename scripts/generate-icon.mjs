import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const userData = await mkdtemp(join(tmpdir(), 'sound-studio-icon-'))
const { ELECTRON_RUN_AS_NODE: _unused, ...environment } = process.env
let app

try {
  app = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userData}`],
    env: environment,
    timeout: 60_000
  })
  const page = await app.firstWindow()
  await page.getByRole('tab', { name: 'Effects', exact: true }).waitFor()
  const svg = await readFile('src/renderer/public/icon.svg', 'utf8')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 1024))
  await page.setContent(`<style>body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${svg}`)
  await mkdir('build', { recursive: true })
  await page.locator('svg').screenshot({ path: resolve('build/icon.png'), omitBackground: true, scale: 'css' })
  console.log('Generated build/icon.png from the title-bar SVG.')
} finally {
  if (app) await app.close()
  await rm(userData, { recursive: true, force: true })
}
