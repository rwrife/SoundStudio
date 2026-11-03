import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('soundStudio', Object.freeze({
  platform: process.platform
}))
