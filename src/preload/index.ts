import { contextBridge, ipcRenderer } from 'electron'
import type { DecomposerApi } from '../shared/decomposer'

const decomposer: DecomposerApi = {
  library: () => ipcRenderer.invoke('decomposer:library'),
  importAudio: () => ipcRenderer.invoke('decomposer:import'),
  start: input => ipcRenderer.invoke('decomposer:start', input),
  cancel: id => ipcRenderer.invoke('decomposer:cancel', id),
  review: input => ipcRenderer.invoke('decomposer:review', input),
  export: input => ipcRenderer.invoke('decomposer:export', input),
  runtime: () => ipcRenderer.invoke('decomposer:runtime'),
  install: profile => ipcRenderer.invoke('decomposer:install', profile),
  cancelInstall: () => ipcRenderer.invoke('decomposer:cancel-install')
}

contextBridge.exposeInMainWorld('soundStudio', Object.freeze({
  platform: process.platform,
  decomposer: Object.freeze(decomposer)
}))
