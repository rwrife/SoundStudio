import { BrowserWindow, dialog, ipcMain, protocol, type IpcMainInvokeEvent } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { z } from 'zod'
import { exportKindSchema, idSchema, profileSchema, stemSchema } from '../shared/decomposer'
import { AnalysisStore } from './analysis-store'
import { LocalRuntime } from './runtime'

export async function registerDecomposer(userData: string, scripts: string, isTrusted: (event: IpcMainInvokeEvent) => boolean) {
  const runtime = new LocalRuntime(join(userData, 'decomposer-runtime'), scripts)
  const store = new AnalysisStore(join(userData, 'decomposer'), runtime)
  await store.initialize()
  function handle(channel: string, handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown> | unknown) {
    ipcMain.handle(`decomposer:${channel}`, async (event, input: unknown) => {
      if (!isTrusted(event)) throw new Error('Untrusted desktop caller.')
      return handler(event, input)
    })
  }
  handle('library', () => store.snapshot())
  handle('import', async event => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('The application window is unavailable.')
    const choice = await dialog.showOpenDialog(owner, {
      title: 'Import a local reference song', properties: ['openFile'],
      filters: [{ name: 'Audio (decoder validates contents)', extensions: ['wav', 'flac', 'mp3', 'ogg', 'm4a'] }]
    })
    if (choice.canceled || !choice.filePaths[0]) return null
    return store.importFile(choice.filePaths[0])
  })
  handle('start', (_event, input) => store.start(input))
  handle('cancel', (_event, input) => store.cancel(idSchema.parse(input)))
  handle('review', (_event, input) => store.saveReview(input))
  handle('export', async (event, input) => {
    const request = z.object({ id: idSchema, kind: exportKindSchema }).strict().parse(input)
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('The application window is unavailable.')
    const choice = await dialog.showOpenDialog(owner, { title: 'Choose a folder for a new non-overwriting export', properties: ['openDirectory', 'createDirectory'] })
    if (choice.canceled || !choice.filePaths[0]) return null
    return store.exportTo(request.id, request.kind, choice.filePaths[0])
  })
  handle('runtime', () => store.isWorking() ? runtime.snapshot() : runtime.diagnose())
  handle('install', (_event, input) => {
    if (store.isWorking()) throw new Error('Finish or cancel current imports and analyses before changing the runtime.')
    return runtime.install(profileSchema.parse(input))
  })
  handle('cancel-install', () => runtime.cancel())
  protocol.handle('soundstudio', async request => {
    try {
      const url = new URL(request.url)
      if (!['GET', 'HEAD'].includes(request.method) || url.hostname !== 'media' || url.search || url.hash) return new Response('Invalid media request', { status: 400 })
      const parts = url.pathname.split('/')
      if (parts.length !== 3) return new Response('Invalid media path', { status: 400 })
      const id = idSchema.parse(parts[1])
      const track = parts[2] === 'reference' ? 'reference' : stemSchema.parse(parts[2])
      const path = await store.mediaFile(id, track)
      const { size } = await stat(path)
      const range = request.headers.get('range')
      let start = 0
      let end = size - 1
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
        if (!match[1]) start = Math.max(0, size - Number(match[2]))
        else start = Number(match[1])
        if (match[1] && match[2]) end = Math.min(end, Number(match[2]))
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      const headers: Record<string, string> = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>
      return new Response(body, { status: range ? 206 : 200, headers })
    } catch (error) {
      console.error('Media unavailable:', error)
      return new Response('Audio is unavailable, corrupt or missing. Reimport or rerun analysis.', { status: 404 })
    }
  })
  return store
}
