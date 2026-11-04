import { arch, cpus, freemem, release, totalmem, type } from 'node:os'
import { memoryPair, type ComputerSummary } from '../shared/hardware'

export function computerSummary(): ComputerSummary {
  const processors = cpus()
  const ram = memoryPair(totalmem(), freemem())
  return {
    os: `${type()} ${release()} (${arch()})`,
    cpu: processors[0]?.model.trim() || 'Unknown',
    logicalCores: processors.length,
    ramTotal: ram.total,
    ramFree: ram.free
  }
}
