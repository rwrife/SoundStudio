import { app, BrowserWindow, dialog, session, type MessageBoxOptions } from 'electron'
import { join } from 'node:path'
import { CloudAccess } from './cloud'
import { GenerationManager } from './generation'
import { registerIpc } from './ipc'
import { ComfyLauncher } from './launcher'
import { ModelDownloader } from './modelDownload'
import { TakeStore } from './takes'
import { channels } from '../shared/bridge'
import { activeStatuses } from '../shared/generation'
import { formatBytes, listLabels, totalBytes } from '../shared/modelDownloads'

app.setName('Sound Studio')

let mainWindow: BrowserWindow | null = null

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
  mainWindow = window
  window.on('closed', () => { if (mainWindow === window) mainWindow = null })

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
  const cloud = new CloudAccess()
  const takes = new TakeStore()
  const generation = new GenerationManager(cloud, takes, job => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channels.jobUpdate, job)
  })
  const launcher = new ComfyLauncher(status => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channels.launcherUpdate, status)
  }, () => generation.list().some(job => activeStatuses.includes(job.status)))
  app.on('will-quit', () => launcher.dispose())
  const downloader = new ModelDownloader(status => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channels.downloadUpdate, status)
  }, () => launcher.modelsFolder(), async (items, modelsDir) => {
    const options: MessageBoxOptions = {
      type: 'question', buttons: ['Download', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
      title: 'Download models',
      message: `Download ${listLabels(items)} (${formatBytes(totalBytes(items))})?`,
      detail: [
        ...items.map(item => `${item.label}: ${formatBytes(item.bytes)} from huggingface.co/${item.repo}\nLicense: ${item.license} (${item.licenseUrl})`),
        `Saved to ${modelsDir}. Files come straight from Hugging Face and are checked against their published SHA-256. Your prompts are not sent anywhere. By downloading you agree to each model's license.`
      ].join('\n\n')
    }
    const result = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options)
    return result.response === 0
  })
  app.on('will-quit', () => downloader.dispose())
  registerIpc({ cloud, takes, generation, launcher, downloader, window: () => mainWindow })
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(reportStartupError)
  })
}).catch(reportStartupError)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
