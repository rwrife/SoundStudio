import { app, BrowserWindow, dialog, session } from 'electron'
import { join } from 'node:path'
import appIcon from '../../build/icon.png?asset'

app.setName('Sound Studio')

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 960,
    minHeight: 700,
    show: false,
    title: 'Sound Studio',
    icon: appIcon,
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
  app.dock?.setIcon(appIcon)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(reportStartupError)
  })
}).catch(reportStartupError)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
