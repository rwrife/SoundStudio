import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { formatMemory, type ComputerSummary } from '../shared/hardware'
import type { Backend } from './useBackend'

export function YourComputer({ backend }: { backend: Backend }) {
  const bridge = window.soundStudio
  const [computer, setComputer] = useState<ComputerSummary | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  const refreshHost = useCallback(async () => {
    if (!bridge) return
    const id = ++request.current
    setBusy(true)
    setError('')
    try {
      const result = await bridge.getComputerSummary()
      if (id !== request.current) return
      if (result.ok) setComputer(result.value)
      else { setComputer(null); setError(result.error) }
    } catch (failure) {
      if (id !== request.current) return
      setComputer(null)
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (id === request.current) setBusy(false)
    }
  }, [bridge])

  useEffect(() => {
    void refreshHost()
    return () => { request.current++ }
  }, [refreshHost])

  return <section className="computer-summary" aria-labelledby="computer-heading" aria-busy={busy}>
    <div className="section-heading">
      <h3 id="computer-heading">Your computer</h3>
      <button className="text-button" disabled={!bridge || busy || backend.connection.state === 'checking'} onClick={() => {
        void refreshHost()
        if (backend.status) void backend.recheck()
      }}><RefreshCw size={12} /> Refresh</button>
    </div>
    {!bridge ? <p className="field-hint">Computer details unavailable in browser preview. Open the desktop app to measure this device.</p>
      : error ? <p className="warning-text" role="alert">Could not read computer details: {error}. Try Refresh.</p>
        : !computer ? <p className="field-hint">Reading computer details...</p>
          : <dl>
            <div><dt>Operating system</dt><dd>{computer.os}</dd></div>
            <div><dt>CPU</dt><dd>{computer.cpu}{computer.logicalCores > 0 ? ` / ${computer.logicalCores} logical cores` : ''}</dd></div>
            <div><dt>System RAM</dt><dd>{formatMemory(computer.ramTotal)} total / {formatMemory(computer.ramFree)} available</dd></div>
          </dl>}
    <dl><div><dt>ComfyUI GPU</dt><dd>
      {!backend.status ? 'Unknown - connect in Backend connections.'
        : !backend.status.devices.length ? 'ComfyUI did not report any devices.'
          : backend.status.devices.map((device, index) => <span className="device-memory" key={index}>
            {device.name} ({device.type}){device.type === 'cpu' ? ' - CPU only, not GPU memory'
              : ` - ${formatMemory(device.vramTotal)} total / ${formatMemory(device.vramFree)} free`}
            {device.type === 'mps' ? ' (shared/unified memory; not dedicated VRAM)' : ''}
          </span>)}
    </dd></div></dl>
    {backend.connection.state === 'error' && <p className="warning-text" role="alert">{backend.connection.error} Open Backend connections to reconnect.</p>}
    <p className="field-hint">Host details are measured by the OS; GPU details come from ComfyUI. Memory is not pooled across GPUs.</p>
    <p className="field-hint">Planning target: 32 GB system RAM; 64 GB and CUDA preferred. Not a model compatibility guarantee.</p>
  </section>
}
