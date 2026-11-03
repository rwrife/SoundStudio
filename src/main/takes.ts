import { app, dialog, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { audioMimeTypes, inspectAudio } from '../shared/audio'
import type { TakeAudio, TakeList } from '../shared/bridge'
import { parseTakeRecord, takeDisplayTitle, takeIdPattern, type TakeRecord } from '../shared/generation'

/** Completed takes: validated audio plus a JSON provenance record, stored under the app's user data folder. */
export class TakeStore {
  readonly folder = join(app.getPath('userData'), 'takes')

  private recordPath(id: string) {
    if (!takeIdPattern.test(id)) throw new Error('Unknown take.')
    return join(this.folder, `${id}.json`)
  }

  async save(bytes: Uint8Array, build: (id: string, fileName: string) => TakeRecord): Promise<TakeRecord> {
    const info = inspectAudio(bytes)
    const id = randomUUID()
    const fileName = `${id}.${info.format}`
    const record = build(id, fileName)
    await mkdir(this.folder, { recursive: true })
    await writeFile(join(this.folder, fileName), bytes)
    const temp = join(this.folder, `${id}.json.tmp`)
    await writeFile(temp, JSON.stringify(record, null, 2))
    await rename(temp, this.recordPath(id))
    return record
  }

  async list(): Promise<TakeList> {
    let names: string[]
    try { names = await readdir(this.folder) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { takes: [], unreadable: 0 }
      throw error
    }
    const takes: TakeRecord[] = []
    let unreadable = 0
    for (const name of names.filter(item => /^[0-9a-f-]{36}\.json$/.test(item))) {
      try { takes.push(parseTakeRecord(JSON.parse(await readFile(join(this.folder, name), 'utf8')))) } catch { unreadable += 1 }
    }
    takes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return { takes, unreadable }
  }

  async get(id: string): Promise<TakeRecord> {
    try {
      return parseTakeRecord(JSON.parse(await readFile(this.recordPath(id), 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('That take no longer exists.')
      throw error
    }
  }

  async audio(id: string): Promise<TakeAudio> {
    const record = await this.get(id)
    const bytes = new Uint8Array(await readFile(join(this.folder, record.audio.fileName)))
    const info = inspectAudio(bytes)
    return { bytes, mimeType: audioMimeTypes[info.format], info }
  }

  /** Copies the original audio and writes its provenance beside it. Returns the saved path, or null if cancelled. */
  async export(id: string, window: BrowserWindow): Promise<string | null> {
    const record = await this.get(id)
    const extension = record.audio.format
    const base = takeDisplayTitle(record).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Sound Studio take'
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: 'Export take',
      defaultPath: join(app.getPath('music'), `${base}.${extension}`),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    })
    if (canceled || !filePath) return null
    const target = filePath.toLowerCase().endsWith(`.${extension}`) ? filePath : `${filePath}.${extension}`
    inspectAudio(new Uint8Array(await readFile(join(this.folder, record.audio.fileName))))
    await copyFile(join(this.folder, record.audio.fileName), target)
    const provenance = {
      exportedBy: 'Sound Studio', exportedAt: new Date().toISOString(), audioFile: target.split(/[\\/]/).pop(),
      take: { id: record.id, createdAt: record.createdAt, title: record.title, workspace: record.workspace },
      audio: record.audio, request: { ...record.request, workflow: record.request.workflow ? { name: record.request.workflow.name } : null },
      model: record.model, backend: record.backend, workflow: record.workflow
    }
    await writeFile(target.replace(/\.[^.\\/]+$/, '.provenance.json'), JSON.stringify(provenance, null, 2))
    return target
  }

  async delete(id: string, window: BrowserWindow): Promise<boolean> {
    const record = await this.get(id)
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning', buttons: ['Delete take', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
      title: 'Delete take', message: `Delete "${takeDisplayTitle(record)}"?`,
      detail: 'This removes the audio and its record from Sound Studio. Files you exported are not affected.'
    })
    if (response !== 0) return false
    await rm(this.recordPath(id), { force: true })
    await rm(join(this.folder, record.audio.fileName), { force: true })
    return true
  }
}
