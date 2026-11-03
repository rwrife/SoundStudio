import { app, BrowserWindow, dialog, protocol, session } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerDecomposer } from './decomposer-ipc'
import type { AnalysisStore } from './analysis-store'

app.setName('Sound Studio')
protocol.registerSchemesAsPrivileged([{ scheme: 'soundstudio', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
let store: AnalysisStore | undefined

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 960,
    minHeight: 700,
    show: false,
    title: 'Sound Studio',
    backgroundColor: '#111820',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.once('ready-to-show', () => window.show())

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) {
    const url = new URL(devUrl)
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('The development renderer must use a local HTTP server.')
    }
    await window.loadURL(url.href)
  } else {
    await window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

function reportStartupError(error: unknown) {
  console.error('Unable to open Sound Studio:', error)
  dialog.showErrorBox('Sound Studio could not start', `${error instanceof Error ? error.message : String(error)}\n\nRun npm run build and try again.`)
  app.quit()
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  const renderer = pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).href
  store = await registerDecomposer(app.getPath('userData'), join(import.meta.dirname, '../../scripts/analysis'), event => {
    const frame = event.senderFrame
    if (!frame || frame !== event.sender.mainFrame || !BrowserWindow.fromWebContents(event.sender)) return false
    const url = new URL(frame.url)
    if (url.href === renderer) return true
    const devUrl = process.env.ELECTRON_RENDERER_URL
    return !app.isPackaged && Boolean(devUrl) && url.origin === new URL(devUrl!).origin
      && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  })
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(reportStartupError)
  })
}).catch(reportStartupError)

app.on('before-quit', () => store?.shutdown())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
