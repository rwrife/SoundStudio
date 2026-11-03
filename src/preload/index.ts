import { contextBridge, ipcRenderer } from 'electron'
import { channels, type SoundStudioBridge } from '../shared/bridge'
import type { JobState } from '../shared/generation'
import type { LauncherStatus } from '../shared/launcher'
import type { DownloadStatus } from '../shared/modelDownloads'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const bridge: SoundStudioBridge = {
  platform: process.platform,
  decomposer: Object.freeze({
    library: () => invoke('decomposer:library'),
    importAudio: () => invoke('decomposer:import'),
    start: (input: Parameters<SoundStudioBridge['decomposer']['start']>[0]) => invoke('decomposer:start', input),
    cancel: (id: string) => invoke('decomposer:cancel', id),
    review: (input: Parameters<SoundStudioBridge['decomposer']['review']>[0]) => invoke('decomposer:review', input),
    export: (input: Parameters<SoundStudioBridge['decomposer']['export']>[0]) => invoke('decomposer:export', input),
    runtime: () => invoke('decomposer:runtime'),
    install: (profile: Parameters<SoundStudioBridge['decomposer']['install']>[0]) => invoke('decomposer:install', profile),
    cancelInstall: () => invoke('decomposer:cancel-install')
  }),
  checkBackend: endpoint => invoke(channels.checkBackend, endpoint),
  getLauncher: () => invoke(channels.launcherStatus),
  chooseComfyFolder: () => invoke(channels.launcherFolder),
  startComfy: endpoint => invoke(channels.launcherStart, endpoint),
  stopComfy: () => invoke(channels.launcherStop),
  installOutputNode: () => invoke(channels.launcherNode),
  showComfyLog: () => invoke(channels.launcherLog),
  onLauncherUpdate: listener => {
    const handler = (_event: Electron.IpcRendererEvent, status: LauncherStatus) => listener(status)
    ipcRenderer.on(channels.launcherUpdate, handler)
    return () => { ipcRenderer.removeListener(channels.launcherUpdate, handler) }
  },
  getDownload: () => invoke(channels.downloadStatus),
  downloadModels: ids => invoke(channels.downloadStart, ids),
  cancelDownload: () => invoke(channels.downloadCancel),
  onDownloadUpdate: listener => {
    const handler = (_event: Electron.IpcRendererEvent, status: DownloadStatus) => listener(status)
    ipcRenderer.on(channels.downloadUpdate, handler)
    return () => { ipcRenderer.removeListener(channels.downloadUpdate, handler) }
  },
  inspectWorkflow: (endpoint, workflow) => invoke(channels.inspectWorkflow, endpoint, workflow),
  getCloudStatus: () => invoke(channels.cloudStatus),
  configureCloud: configuration => invoke(channels.cloudConfigure, configuration),
  startGeneration: (endpoint, request) => invoke(channels.startGeneration, endpoint, request),
  cancelGeneration: jobId => invoke(channels.cancelGeneration, jobId),
  listJobs: () => invoke(channels.listJobs),
  onJobUpdate: listener => {
    const handler = (_event: Electron.IpcRendererEvent, job: JobState) => listener(job)
    ipcRenderer.on(channels.jobUpdate, handler)
    return () => { ipcRenderer.removeListener(channels.jobUpdate, handler) }
  },
  listTakes: () => invoke(channels.listTakes),
  readTakeAudio: takeId => invoke(channels.takeAudio, takeId),
  exportTake: takeId => invoke(channels.exportTake, takeId),
  deleteTake: takeId => invoke(channels.deleteTake, takeId)
}

contextBridge.exposeInMainWorld('soundStudio', Object.freeze(bridge))
