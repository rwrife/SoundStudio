import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CloudConfiguration, CloudStatus } from '../shared/generation'

interface StoredCloudAccess { version: 1; enabled: boolean; encryptedKey: string | null }

/**
 * Keeps the user's opt-in for partner (remote) nodes and their Comfy.org API key.
 * The key is encrypted with the OS keychain and never leaves the main process except to the local ComfyUI.
 */
export class CloudAccess {
  private readonly file = join(app.getPath('userData'), 'cloud-access.json')
  private state: StoredCloudAccess = { version: 1, enabled: false, encryptedKey: null }
  private loaded = false

  private async load() {
    if (this.loaded) return
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'))
      if (value?.version === 1 && typeof value.enabled === 'boolean' && (value.encryptedKey === null || typeof value.encryptedKey === 'string')) {
        this.state = value
      } else {
        throw new Error('Unsupported cloud access file.')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Ignoring unreadable cloud access settings; partner models stay disabled.', error)
    }
    this.loaded = true
  }

  private async save() {
    await mkdir(app.getPath('userData'), { recursive: true })
    const temp = `${this.file}.tmp`
    await writeFile(temp, JSON.stringify(this.state), { mode: 0o600 })
    await rename(temp, this.file)
  }

  async status(): Promise<CloudStatus> {
    await this.load()
    return { enabled: this.state.enabled && this.state.encryptedKey !== null, hasKey: this.state.encryptedKey !== null, encryptionAvailable: safeStorage.isEncryptionAvailable() }
  }

  async configure(configuration: CloudConfiguration): Promise<CloudStatus> {
    await this.load()
    if (configuration.apiKey === null) {
      this.state = { version: 1, enabled: false, encryptedKey: null }
    } else if (typeof configuration.apiKey === 'string') {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('This device cannot encrypt the API key, so Sound Studio will not store it.')
      this.state.encryptedKey = safeStorage.encryptString(configuration.apiKey).toString('base64')
    }
    if (configuration.enabled && !this.state.encryptedKey) throw new Error('Store a Comfy.org API key before enabling cloud partner models.')
    if (configuration.apiKey !== null) this.state.enabled = configuration.enabled
    if (this.state.encryptedKey || this.state.enabled) await this.save()
    else await rm(this.file, { force: true })
    return this.status()
  }

  /** Returns the key only when the user has opted in. */
  async apiKey(): Promise<string | null> {
    const status = await this.status()
    if (!status.enabled || !this.state.encryptedKey) return null
    try {
      return safeStorage.decryptString(Buffer.from(this.state.encryptedKey, 'base64'))
    } catch {
      throw new Error('The stored Comfy.org API key could not be decrypted. Remove it and add it again in Model Settings.')
    }
  }
}
