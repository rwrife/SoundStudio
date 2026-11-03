import { useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, AudioLines, Check, Cloud, Cpu, FileJson, KeyRound, Music2, ShieldCheck, SlidersHorizontal, Trash2, Upload } from 'lucide-react'
import {
  assessHardware, createDefaultBackendSettings, estimateCostUsd, importCustomWorkflow, modelProfiles, placeholders, profilesFor,
  type Execution, type ModelProfile
} from '../shared/generation'
import type { Workspace } from '../shared/workspace'
import { ModelDownloadPanel } from './ModelDownloadPanel'
import type { Backend } from './useBackend'

const defaults = createDefaultBackendSettings()

const groups: ReadonlyArray<{ execution: Execution; title: string; detail: string }> = [
  { execution: 'local', title: 'On this device', detail: 'Open weights run by your ComfyUI. Prompts and audio stay local.' },
  { execution: 'cloud', title: 'Cloud partner models', detail: 'Run by a third-party service through ComfyUI. Requires your opt-in and a Comfy.org API key. Charges apply.' },
  { execution: 'workflow', title: 'Your ComfyUI workflow', detail: 'MusicGen, DiffRhythm 2 or any audio workflow you can run in ComfyUI.' }
]

export const executionBadge = (execution: Execution) => execution === 'local' ? 'LOCAL' : execution === 'cloud' ? 'CLOUD' : 'WORKFLOW'

export function ModelSettings({ backend, workspace, onWorkspace }: { backend: Backend; workspace: Workspace; onWorkspace: (workspace: Workspace) => void }) {
  const choice = backend.settings.models[workspace]
  const profile = modelProfiles[choice.profileId]
  const readiness = backend.readiness[workspace]
  const status = backend.status
  const hardware = assessHardware(profile, status?.devices ?? [])
  const customized = (['effects', 'music'] as const).some(tab => {
    const current = backend.settings.models[tab]
    const encoder = modelProfiles[current.profileId].textEncoder
    return current.profileId !== defaults.models[tab].profileId || !!current.checkpoint || (!!encoder && encoder.pattern.test(current.textEncoder))
  })
  const [advanced, setAdvanced] = useState(customized)

  return <>
    <p className="dialog-intro">Each workspace comes with a recommended local model, downloaded into your ComfyUI with one click. Prompts and audio stay on this device. To use a different model, file or workflow, open Advanced.</p>
    <div className="segmented" aria-label="Model workspace">{(['effects', 'music'] as const).map(tab =>
      <button key={tab} aria-pressed={workspace === tab} onClick={() => onWorkspace(tab)}>{tab === 'effects' ? 'Effects' : 'Music'}</button>)}</div>
    {backend.settingsError && <p className="warning-text" role="alert"><AlertTriangle size={14} /> {backend.settingsError}</p>}

    <div className="model-card">
      <div className="model-card-icon">{workspace === 'effects' ? <AudioLines size={24} /> : <Music2 size={24} />}</div>
      <span className={`outline-badge ${readiness.ready ? 'ready' : 'attention'}`}>{readiness.ready ? <><Check size={11} /> READY</> : <><AlertTriangle size={11} /> NEEDS SETUP</>}</span>
      <h3>{profile.label}</h3>
      <p>{profile.summary}</p>
      <dl>
        <div><dt>Runs on</dt><dd>{profile.execution === 'local' ? 'Your ComfyUI, on this device' : profile.execution === 'cloud' ? `${profile.provider?.name}` : readiness.remote ? 'Partner nodes in your workflow (off this device)' : 'Your ComfyUI, as defined by the workflow'}</dd></div>
        <div><dt>Length</dt><dd>{profile.minSeconds}-{profile.maxSeconds} sec{profile.durationControl === 'prompt' ? ' (described in the prompt; not exact)' : ''}</dd></div>
        <div><dt>Lyrics / key</dt><dd>{profile.supportsLyrics ? 'Lyrics' : 'No lyrics'} / {profile.supportsKey ? 'Key' : 'No key control'}</dd></div>
        <div><dt>Hardware</dt><dd className={hardware.level === 'tight' || hardware.level === 'cpu' ? 'warning-inline' : ''}>{status || hardware.level === 'remote' ? hardware.text : 'Connect to ComfyUI to check.'}</dd></div>
        {profile.provider && <div><dt>Pricing</dt><dd>{profile.provider.pricingNote}</dd></div>}
        <div><dt>License</dt><dd>{profile.license}</dd></div>
        <div><dt>Source</dt><dd className="selectable">{profile.source}</dd></div>
      </dl>
      {!!readiness.issues.length && <ul className="issue-list" aria-label="Setup needed">{readiness.issues.map(issue => <li key={issue}><AlertTriangle size={13} /> {issue}</li>)}</ul>}
    </div>
    <ModelDownloadPanel backend={backend} items={backend.missingModels[workspace]} />
    {!status && backend.available && <p className="field-hint">Start ComfyUI from Backend connections to check and download models.</p>}

    <details className="advanced-settings" open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}>
      <summary><SlidersHorizontal size={14} /> Advanced <span>models, files, workflows and cloud</span></summary>

    <fieldset className="profile-list">
      <legend className="sr-only">{workspace === 'effects' ? 'Effects' : 'Music'} model</legend>
      {groups.map(group => {
        const items = profilesFor(workspace).filter(item => item.execution === group.execution)
        if (!items.length) return null
        return <div key={group.execution} className="profile-group">
          <h3>{group.title}</h3><p className="field-hint">{group.detail}</p>
          {items.map(item => <label key={item.id} className={`profile-option ${item.id === profile.id ? 'selected' : ''}`}>
            <input type="radio" name={`${workspace}-profile`} checked={item.id === profile.id} onChange={() => backend.chooseModel(workspace, { profileId: item.id })} />
            <span><strong>{item.label}{item.id === defaults.models[workspace].profileId ? ' (recommended)' : ''}</strong><small>{item.summary}</small></span>
            <span className={`execution-badge ${item.execution}`}>{executionBadge(item.execution)}</span>
          </label>)}
        </div>
      })}
    </fieldset>

    {(profile.checkpoint || profile.textEncoder) && <div className="settings-block">
      <h3><Cpu size={15} /> Installed files</h3>
      {profile.checkpoint && <ModelFileSelect id={`${workspace}-checkpoint`} label="Checkpoint" suggested={profile.checkpoint.suggested}
        files={status?.checkpoints ?? []} pattern={profile.checkpoint.pattern} modelLabel={profile.label} selected={choice.checkpoint}
        onChange={checkpoint => backend.chooseModel(workspace, { checkpoint })} disabled={!status} />}
      {profile.textEncoder && <ModelFileSelect id={`${workspace}-encoder`} label="Text encoder" suggested={profile.textEncoder.suggested}
        files={(status?.textEncoders ?? []).filter(file => profile.textEncoder!.pattern.test(file))} pattern={profile.textEncoder.pattern} modelLabel={profile.label}
        selected={profile.textEncoder.pattern.test(choice.textEncoder) ? choice.textEncoder : ''}
        onChange={textEncoder => backend.chooseModel(workspace, { textEncoder })} disabled={!status} />}
    </div>}

    {profile.execution === 'workflow' && <WorkflowImport backend={backend} workspace={workspace} />}

    <div className="settings-block">
      <h3>How to set up {profile.label} manually</h3>
      <ol className="install-steps">{profile.install.map(step => <li key={step}>{step}</li>)}</ol>
    </div>

    <CloudAccessPanel backend={backend} profile={profile} remote={readiness.remote} />
    </details>
  </>
}

function ModelFileSelect({ id, label, suggested, files, pattern, modelLabel, selected, onChange, disabled }: {
  id: string; label: string; suggested: string; files: string[]; pattern: RegExp; modelLabel: string; selected: string; onChange: (value: string) => void; disabled: boolean
}) {
  const matching = files.filter(file => pattern.test(file))
  const other = files.filter(file => !pattern.test(file))
  const automatic = matching[0] ?? null
  return <>
    <label className="field-label" htmlFor={id}>{label} <span>suggested {suggested}</span></label>
    <select id={id} value={selected} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="">{automatic ? `Automatic (${automatic})` : disabled ? 'Connect to ComfyUI to list files' : 'Automatic (none found)'}</option>
      {!!matching.length && <optgroup label={`${modelLabel} files`}>{matching.map(file => <option key={file} value={file}>{file}</option>)}</optgroup>}
      {!!other.length && <optgroup label="Other files">{other.map(file => <option key={file} value={file}>{file}</option>)}</optgroup>}
    </select>
    {!disabled && automatic && selected && !pattern.test(selected) &&
      <button type="button" className="text-button" onClick={() => onChange('')}>Use {automatic} instead <ArrowRight size={14} /></button>}
  </>
}

function WorkflowImport({ backend, workspace }: { backend: Backend; workspace: Workspace }) {
  const workflow = backend.settings.models[workspace].workflow
  const inspection = backend.inspections[workspace]
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  async function load(file: File) {
    setError('')
    try {
      const imported = importCustomWorkflow(await file.text(), file.name.replace(/\.json$/i, '').slice(0, 120) || 'Workflow')
      backend.chooseModel(workspace, { workflow: imported })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return <div className="settings-block">
    <h3><FileJson size={15} /> ComfyUI API workflow</h3>
    {workflow ? <div className="workflow-summary">
      <p><strong>{workflow.name}</strong> / {Object.keys(workflow.graph).length} nodes / output node {workflow.outputNodeId}</p>
      <p className="field-hint">Uses {workflow.placeholders.map(name => `{{${name}}}`).join(', ')}</p>
      {inspection?.apiNodes.length ? <p className="warning-text"><Cloud size={14} /> Contains partner nodes that send data off this device: {inspection.apiNodes.join(', ')}.</p> : null}
      <button className="subtle-button" onClick={() => backend.chooseModel(workspace, { workflow: null })}><Trash2 size={13} /> Remove workflow</button>
    </div> : <p className="field-hint">No workflow imported.</p>}
    <input ref={fileRef} id={`${workspace}-workflow-file`} className="sr-only" type="file" accept="application/json,.json"
      onChange={event => { const file = event.target.files?.[0]; if (file) void load(file) }} />
    <button className="subtle-button" onClick={() => fileRef.current?.click()}><Upload size={13} /> {workflow ? 'Replace workflow' : 'Import workflow JSON'}</button>
    {error && <p className="warning-text" role="alert"><AlertTriangle size={14} /> {error}</p>}
    <p className="field-hint">Placeholders: {placeholders.map(name => `{{${name}}}`).join(' ')}. A value that is only a placeholder, such as {'"{{seed}}"'}, becomes a number for numeric inputs.</p>
  </div>
}

function CloudAccessPanel({ backend, profile, remote }: { backend: Backend; profile: ModelProfile; remote: boolean }) {
  const cloud = backend.cloud
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setFeedback(null)
    try { await action(); setFeedback({ error: false, text: success }) } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : String(error) })
    } finally { setBusy(false) }
  }

  const relevant = profile.execution === 'cloud' || remote
  return <section className={`settings-block cloud-block ${relevant ? 'relevant' : ''}`} aria-labelledby="cloud-heading">
    <h3 id="cloud-heading"><Cloud size={15} /> Cloud partner models</h3>
    <p className="field-hint">Mirelo SFX 2.0, Seed Audio and other ComfyUI partner nodes run on third-party servers. When enabled, ComfyUI sends your prompt and settings to Comfy.org and the provider, and charges your Comfy.org credits.
      {profile.provider ? ` ${profile.label} costs about $${estimateCostUsd(profile, 10).toFixed(2)} per 10 seconds.` : ''} Local models never use this.</p>
    {!backend.available ? <p className="field-hint">Available in the desktop app.</p> : !cloud ? <p className="field-hint">Checking...</p> : <>
      <div className="connection-row"><span>Status</span><span className={cloud.enabled ? 'warning-inline' : ''}>{cloud.enabled ? 'Enabled - prompts may leave this device' : 'Off'}</span></div>
      <div className="connection-row"><span>Comfy.org API key</span><span>{cloud.hasKey ? 'Stored, encrypted on this device' : 'Not stored'}</span></div>
      {!cloud.encryptionAvailable && <p className="warning-text"><AlertTriangle size={14} /> This device cannot encrypt secrets, so an API key cannot be stored.</p>}
      {cloud.encryptionAvailable && <form className="key-form" onSubmit={event => {
        event.preventDefault()
        void run(() => backend.configureCloud({ enabled: cloud.enabled, apiKey: key }).then(() => setKey('')), 'API key stored.')
      }}>
        <label className="field-label" htmlFor="cloud-key"><KeyRound size={12} /> {cloud.hasKey ? 'Replace API key' : 'Comfy.org API key'}</label>
        <input id="cloud-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} placeholder="comfyui-..." />
        <button className="subtle-button" type="submit" disabled={busy || !key.trim()}>Store key</button>
      </form>}
      <label className="check-field"><input type="checkbox" checked={cloud.enabled} disabled={busy || !cloud.hasKey}
        onChange={event => void run(() => backend.configureCloud({ enabled: event.target.checked }), event.target.checked ? 'Cloud partner models enabled.' : 'Cloud partner models disabled.')} />
        <span>Allow cloud partner models<small>I understand prompts are sent to third-party services and may incur charges.</small></span></label>
      {cloud.hasKey && <button className="subtle-button" disabled={busy} onClick={() => void run(() => backend.configureCloud({ enabled: false, apiKey: null }), 'API key removed and cloud models disabled.')}><Trash2 size={13} /> Remove key</button>}
      {feedback && <p className={feedback.error ? 'warning-text' : 'success-text'} role={feedback.error ? 'alert' : 'status'}>{feedback.error ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />} {feedback.text}</p>}
    </>}
  </section>
}
