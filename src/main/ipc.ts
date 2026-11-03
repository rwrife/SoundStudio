import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { channels } from '../shared/bridge'
import { takeIdPattern, validateCloudConfiguration, validateCustomWorkflow, validateGenerationRequest, type Result } from '../shared/generation'
import type { CloudAccess } from './cloud'
import { ComfyClient } from './comfyui'
import type { GenerationManager } from './generation'
import type { ComfyLauncher } from './launcher'
import type { ModelDownloader } from './modelDownload'
import type { TakeStore } from './takes'
import { validateDownloadIds } from '../shared/modelDownloads'

interface Services { cloud: CloudAccess; takes: TakeStore; generation: GenerationManager; launcher: ComfyLauncher; downloader: ModelDownloader; window: () => BrowserWindow | null }

const uuidLike = (value: unknown): string => {
  if (typeof value !== 'string' || !takeIdPattern.test(value)) throw new Error('Unknown item.')
  return value
}

/** Registers the bridge handlers. Every call must come from the app window's main frame and is re-validated here. */
export function registerIpc({ cloud, takes, generation, launcher, downloader, window }: Services) {
  const handle = <T>(channel: string, run: (window: BrowserWindow, ...args: unknown[]) => Promise<T>) => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<Result<T>> => {
      const current = window()
      if (!current || event.sender !== current.webContents || event.senderFrame !== current.webContents.mainFrame) {
        return { ok: false, error: 'Request rejected.' }
      }
      try {
        return { ok: true, value: await run(current, ...args) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  handle(channels.checkBackend, async (_window, endpoint) => new ComfyClient(endpoint).status())
  handle(channels.launcherStatus, async () => launcher.status())
  handle(channels.launcherFolder, async current => launcher.chooseFolder(current))
  handle(channels.launcherStart, async (_window, endpoint) => launcher.start(endpoint))
  handle(channels.launcherStop, async () => launcher.stop())
  handle(channels.launcherNode, async () => launcher.installNode())
  handle(channels.launcherLog, async () => launcher.showLog())
  handle(channels.downloadStatus, async () => downloader.get())
  handle(channels.downloadStart, async (_window, ids) => downloader.start(validateDownloadIds(ids)))
  handle(channels.downloadCancel, async () => downloader.cancel())
  handle(channels.inspectWorkflow, async (_window, endpoint, workflow) => {
    const valid = validateCustomWorkflow({ name: 'Workflow', graph: workflow })
    const { missingNodes, apiNodes } = await new ComfyClient(endpoint).inspectNodes(Object.values(valid.graph).map(node => node.class_type))
    return { missingNodes, apiNodes }
  })
  handle(channels.cloudStatus, async () => cloud.status())
  handle(channels.cloudConfigure, async (_window, configuration) => cloud.configure(validateCloudConfiguration(configuration)))
  handle(channels.startGeneration, async (_window, endpoint, request) => generation.start(String(endpoint), validateGenerationRequest(request)))
  handle(channels.cancelGeneration, async (_window, id) => generation.cancel(uuidLike(id)))
  handle(channels.listJobs, async () => generation.list())
  handle(channels.listTakes, async () => takes.list())
  handle(channels.takeAudio, async (_window, id) => takes.audio(uuidLike(id)))
  handle(channels.exportTake, async (current, id) => takes.export(uuidLike(id), current))
  handle(channels.deleteTake, async (current, id) => takes.delete(uuidLike(id), current))
}
