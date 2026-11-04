import type { BackendDevice } from './generation'

export interface ComputerSummary {
  os: string
  cpu: string
  logicalCores: number
  ramTotal: number | null
  ramFree: number | null
}

/** Missing or invalid telemetry must not look like measured zero memory. */
export function memoryBytes(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function memoryPair(total: unknown, free: unknown) {
  const measuredTotal = memoryBytes(total)
  const measuredFree = memoryBytes(free)
  return {
    total: measuredTotal !== null && measuredTotal > 0 ? measuredTotal : null,
    free: measuredFree !== null && measuredTotal !== null && measuredTotal > 0 && measuredFree <= measuredTotal ? measuredFree : null
  }
}

export function formatMemory(value: number | null): string {
  const bytes = memoryBytes(value)
  return bytes === null ? 'Unknown' : `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

export function parseBackendDevices(value: unknown): BackendDevice[] {
  if (!Array.isArray(value)) return []
  return value.filter((device): device is Record<string, unknown> => typeof device === 'object' && device !== null && !Array.isArray(device))
    .map(device => {
      const memory = memoryPair(device.vram_total, device.vram_free)
      return {
        name: typeof device.name === 'string' && device.name.trim() ? device.name.slice(0, 200) : 'Unknown device',
        type: typeof device.type === 'string' && device.type.trim() ? device.type.toLowerCase().slice(0, 40) : 'unknown',
        vramTotal: memory.total,
        vramFree: memory.free
      }
    })
}
