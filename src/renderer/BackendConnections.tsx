import { useState } from 'react'
import { AlertTriangle, Check, CircleAlert, FolderOpen, LoaderCircle, RefreshCw, Square, Zap } from 'lucide-react'
import type { BackendCheck } from '../shared/backendChecks'
import type { Workspace } from '../shared/workspace'
import type { Backend } from './useBackend'
import { ModelDownloadPanel } from './ModelDownloadPanel'

interface Props {
  backend: Backend
  checks: BackendCheck[]
  storageError: string
  onModels: (workspace: Workspace) => void
}

const actionLabel: Record<NonNullable<BackendCheck['action']>, string> = {
  'choose-folder': 'Choose folder', start: 'Start', 'install-node': 'Install', restart: 'Restart ComfyUI', 'models-effects': 'Model Settings', 'models-music': 'Model Settings',
  'download-effects': 'Download', 'download-music': 'Download'
}

/** Backend connections: one-click start for the user's local ComfyUI and readiness checks for everything generation needs. */
export function BackendConnections({ backend, checks, storageError, onModels }: Props) {
  const [endpoint, setEndpoint] = useState(backend.settings.endpoint)
  const [busy, setBusy] = useState(false)
  const launcher = backend.launcher
  const starting = launcher?.phase === 'starting'
  const managed = launcher?.phase === 'running'
  const connected = backend.connection.state === 'connected'
  const checking = backend.connection.state === 'checking'

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try { await work() } finally { setBusy(false) }
  }
  const refresh = () => run(async () => { await backend.refreshLauncher(); await backend.connect(endpoint) })
  const start = () => run(() => backend.startComfy(endpoint))
  const restart = () => run(async () => { await backend.stopComfy(); await backend.startComfy(endpoint) })
  const perform = (check: BackendCheck) => {
    switch (check.action) {
      case 'choose-folder': return void run(() => backend.chooseComfyFolder())
      case 'start': return void start()
      case 'install-node': return void run(() => backend.installOutputNode())
      case 'restart': return void restart()
      case 'models-effects': return onModels('effects')
      case 'models-music': return onModels('music')
      case 'download-effects': return void backend.downloadModels(backend.missingModels.effects)
      case 'download-music': return void backend.downloadModels(backend.missingModels.music)
    }
  }

  if (!backend.available) {
    return <p className="dialog-intro">This browser preview cannot reach ComfyUI. Run the desktop app to generate audio.</p>
  }

  return <div className="backend-connections">
    <p className="dialog-intro">Sound Studio generates audio with ComfyUI on this device. Start it with one click; nothing is sent anywhere else.</p>
    <label className="field-label" htmlFor="endpoint">ComfyUI address <span>this device only</span></label>
    <input id="endpoint" value={endpoint} spellCheck={false} disabled={managed || starting} onChange={event => setEndpoint(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') void refresh() }} />
    <label className="field-label" htmlFor="comfy-folder">ComfyUI folder <span>{launcher?.layout ? 'found' : 'not found'}</span></label>
    <div className="inline-field"><input id="comfy-folder" readOnly value={launcher?.folder ?? ''} placeholder="Choose the folder that contains ComfyUI" spellCheck={false} />
      <button className="subtle-button icon-only" aria-label="Browse for ComfyUI folder" title="Browse for ComfyUI folder" disabled={!launcher || managed || starting || busy}
        onClick={() => void run(() => backend.chooseComfyFolder())}><FolderOpen size={16} /></button></div>

    <div className="launcher-actions">
      {managed
        ? <button className="subtle-button" disabled={busy} onClick={() => void run(() => backend.stopComfy())}><Square size={12} /> Stop ComfyUI</button>
        : connected
          ? <button className="subtle-button" disabled={busy} onClick={backend.disconnect}>Disconnect</button>
          : launcher?.layout
            ? <button className="primary start-comfy" disabled={starting || checking || busy} onClick={() => void start()}>
              {starting ? <LoaderCircle className="spin" size={15} /> : <Zap size={15} />}{starting ? 'Starting ComfyUI...' : 'Start local ComfyUI'}</button>
            : <button className="primary start-comfy" disabled={!launcher || busy} onClick={() => void run(() => backend.chooseComfyFolder())}><FolderOpen size={15} /> Choose ComfyUI folder</button>}
      {starting && <button className="text-button" onClick={() => void backend.stopComfy()}>Cancel</button>}
      {launcher?.hasLog && <button className="text-button" onClick={() => void backend.showComfyLog()}>Show log</button>}
    </div>
    {backend.launcherError
      ? <p className="warning-text" role="alert"><AlertTriangle size={14} /> {backend.launcherError}</p>
      : launcher?.message && <p className={launcher.phase === 'exited' ? 'warning-text' : 'field-hint'} role="status">
        {launcher.phase === 'exited' && <AlertTriangle size={14} />} {launcher.message}</p>}
    <ModelDownloadPanel backend={backend} items={[...backend.missingModels.effects, ...backend.missingModels.music]} />

    <div className="section-heading checks-heading"><span className="section-kicker">READINESS CHECKS</span>
      <button className="text-button" disabled={checking || starting || busy} onClick={() => void refresh()}><RefreshCw size={13} className={checking ? 'spin' : ''} /> Refresh</button></div>
    <ul className="checks" aria-label="Readiness checks">{checks.map(check => <li className={`check ${check.status}`} key={check.id}>
      {check.status === 'ready' ? <Check size={16} aria-hidden="true" /> : check.status === 'pending' ? <LoaderCircle size={16} aria-hidden="true" className={checking || starting ? 'spin' : ''} /> : <CircleAlert size={16} aria-hidden="true" />}
      <div><strong>{check.name} <span className="sr-only">({check.status === 'ready' ? 'ready' : check.status === 'pending' ? 'waiting' : check.status === 'warning' ? 'warning' : 'needs attention'})</span></strong><p>{check.detail}</p></div>
      {check.action && !(check.action === 'start' && (starting || busy)) && <button className="subtle-button check-action" disabled={busy || starting} onClick={() => perform(check)}>{actionLabel[check.action]}</button>}
    </li>)}</ul>

    <div className="connection-row"><span>Prompt drafts</span><span className="blue-text">{storageError ? 'In memory only' : 'Saved locally'}</span></div>
    <div className="connection-row"><span>Takes</span><span>Saved locally ({backend.takes.length})</span></div>
    <div className="connection-row"><span>Cloud partner models</span><span className={backend.cloud?.enabled ? 'warning-inline' : ''}>{backend.cloud?.enabled ? 'Enabled' : 'Off'}</span></div>
    <p className="fine-print">Sound Studio runs ComfyUI on this device only and stops it when you quit. A ComfyUI you started yourself is never stopped. Starting ComfyUI also installs Sound Studio's small WAV output node into its custom_nodes folder and offers to download any models you are missing.</p>
  </div>
}
