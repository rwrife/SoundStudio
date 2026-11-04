import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  AlertTriangle, ArrowDownToLine, ArrowRight, AudioLines, Check, ChevronRight, CircleHelp,
  Clock3, Cloud, FolderOpen, Headphones, Info, Layers3, Library, ListMusic, LoaderCircle,
  Music2, Play, Radio, Settings2, ShieldCheck, SlidersHorizontal,
  Sparkles, Square, Trash2, WandSparkles, Waves, Zap
} from 'lucide-react'
import { version } from '../../package.json'
import { formatTime } from '../shared/audio'
import {
  activeStatuses, buildGenerationRequest, estimateCostUsd, modelProfiles, randomSeed, takeDisplayTitle,
  type JobState, type TakeRecord
} from '../shared/generation'
import {
  effectCategories, examples, isGenerationWorkspace, musicGenres, musicKeys, musicMoods, steps, workspaces,
  type Draft, type Step, type StudioWorkspace, type Workspace
} from '../shared/workspace'
import { Decomposer, DecomposerModels } from './Decomposer'
import { Dialog } from './Dialog'
import { BackendConnections } from './BackendConnections'
import { ModelDownloadPanel } from './ModelDownloadPanel'
import { totalBytes } from '../shared/modelDownloads'
import { backendChecks, backendSummary } from '../shared/backendChecks'
import { executionBadge, ModelSettings } from './ModelSettings'
import { YourComputer } from './YourComputer'
import { TakePlayer } from './TakePlayer'
import { useBackend } from './useBackend'
import { useStudioState } from './useStudioState'

type Surface = 'models' | 'connections' | 'library' | 'help' | null
type Feedback = { workspace: Workspace | 'all'; error: boolean; text: string } | null

const statusLabel: Record<JobState['status'], string> = { queued: 'Queued', running: 'Generating', failed: 'Failed', cancelled: 'Cancelled', completed: 'Completed' }

export function App() {
  const { state, setState, storageError } = useStudioState()
  const backend = useBackend()
  const [surface, setSurface] = useState<Surface>(null)
  const [modelWorkspace, setModelWorkspace] = useState<StudioWorkspace>('effects')
  const [notice, setNotice] = useState('')
  const [handoff, setHandoff] = useState<{ title: string; prompt: string; tempo: string; duration: string; instrumental: boolean } | null>(null)
  const [runtimeRevision, setRuntimeRevision] = useState(0)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [selectedTakes, setSelectedTakes] = useState<Record<Workspace, string | null>>({ effects: null, music: null })
  const [starting, setStarting] = useState(false)
  const seenCompleted = useRef(new Set<string>())
  const mainRef = useRef<HTMLElement>(null)
  const studioWorkspace = state.workspace
  const isDecomposer = studioWorkspace === 'decomposer'
  // Decomposer renders its own panel with no generation path, so these values always describe Effects or Music.
  const workspace: Workspace = isGenerationWorkspace(studioWorkspace) ? studioWorkspace : 'effects'
  const draft = state.drafts[workspace]
  const isMusic = workspace === 'music'
  const noun = isMusic ? 'music' : 'sound'

  const choice = backend.settings.models[workspace]
  const profile = modelProfiles[choice.profileId]
  const readiness = backend.readiness[workspace]
  const plan = buildGenerationRequest(workspace, draft, choice, readiness)
  const workspaceTakes = backend.takes.filter(take => take.workspace === workspace)
  const selectedTake = workspaceTakes.find(take => take.id === selectedTakes[workspace]) ?? workspaceTakes[0] ?? null
  const workspaceJobs = backend.jobs.filter(job => job.workspace === workspace).reverse()
  const activeJob = workspaceJobs.find(job => activeStatuses.includes(job.status)) ?? null
  const latestJob = workspaceJobs[0] ?? null
  const connected = backend.connection.state === 'connected'
  const canGenerate = backend.available && connected && readiness.ready && !!plan.request && !activeJob && !starting
  const workspaceFeedback = feedback && (feedback.workspace === workspace || feedback.workspace === 'all') ? feedback : null

  useEffect(() => {
    for (const job of backend.jobs) {
      if (job.status !== 'completed' || !job.takeId || seenCompleted.current.has(job.id)) continue
      seenCompleted.current.add(job.id)
      setSelectedTakes(current => ({ ...current, [job.workspace]: job.takeId }))
    }
  }, [backend.jobs])

  function updateDraft(patch: Partial<Draft>) {
    setState(current => ({ ...current, drafts: { ...current.drafts, [current.workspace]: { ...current.drafts[current.workspace], ...patch } } }))
  }

  function selectStep(step: Step) {
    updateDraft({ step })
    mainRef.current?.scrollTo({ top: 0 })
  }

  function selectWorkspace(next: StudioWorkspace) {
    setState(current => ({ ...current, workspace: next }))
    setNotice('')
  }

  function applyHandoff(append: boolean) {
    if (!handoff) return
    const prompt = append && state.drafts.music.prompt ? `${state.drafts.music.prompt}\n\n${handoff.prompt}` : handoff.prompt
    if (prompt.length > 200000) {
      setNotice('The full brief exceeds the Music draft limit. Export the structured analysis instead; nothing was truncated or replaced.')
      return
    }
    setState(current => ({
      ...current,
      workspace: 'music',
      drafts: { ...current.drafts, music: { ...current.drafts.music, ...(append ? { prompt } : { ...handoff, prompt }), step: 'brief' } }
    }))
    setHandoff(null)
    setNotice('Decomposer brief transferred with your approval. Model prompt limits still apply; nothing was truncated.')
  }

  function navigateTabs(event: KeyboardEvent<HTMLElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = workspaces.findIndex(item => item.id === studioWorkspace)
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? workspaces.length - 1
      : event.key === 'ArrowRight' ? (currentIndex + 1) % workspaces.length
      : (currentIndex - 1 + workspaces.length) % workspaces.length
    const next = workspaces[nextIndex].id
    selectWorkspace(next)
    document.getElementById(`${next}-tab`)?.focus()
  }

  function openModels() {
    setModelWorkspace(studioWorkspace)
    setSurface('models')
  }

  async function generate() {
    const { request, problems } = buildGenerationRequest(workspace, draft, choice, readiness, randomSeed(profile.maxSeed))
    if (!request) { setFeedback({ workspace, error: true, text: problems.join(' ') }); return }
    setStarting(true); setFeedback(null)
    try {
      const job = await backend.start(request)
      if (job.status === 'failed') setFeedback({ workspace, error: true, text: job.message })
    } catch (error) {
      setFeedback({ workspace, error: true, text: error instanceof Error ? error.message : String(error) })
    } finally { setStarting(false) }
  }

  async function exportTake(take: TakeRecord) {
    try {
      const path = await backend.exportTake(take.id)
      if (path) setFeedback({ workspace: 'all', error: false, text: `Exported to ${path} with a .provenance.json record beside it.` })
    } catch (error) {
      setFeedback({ workspace: 'all', error: true, text: `Export failed. ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  async function deleteTake(take: TakeRecord) {
    try {
      if (await backend.deleteTake(take.id)) setFeedback({ workspace: 'all', error: false, text: `Deleted "${takeDisplayTitle(take)}".` })
    } catch (error) {
      setFeedback({ workspace: 'all', error: true, text: `Delete failed. ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  function openTake(take: TakeRecord) {
    setSelectedTakes(current => ({ ...current, [take.workspace]: take.id }))
    setState(current => ({ ...current, workspace: take.workspace, drafts: { ...current.drafts, [take.workspace]: { ...current.drafts[take.workspace], step: 'review' } } }))
    setSurface(null)
  }

  const launcher = backend.launcher
  const comfyStarting = launcher?.phase === 'starting'
  const missingHere = backend.missingModels[workspace]
  const checks = backendChecks({ connection: backend.connection, launcher, models: backend.settings.models, readiness: backend.readiness,
    downloads: { effects: totalBytes(backend.missingModels.effects), music: totalBytes(backend.missingModels.music) }, downloading: backend.download.phase === 'downloading' })
  const summary = backendSummary(checks, launcher?.phase)
  const blockingHere = checks.filter(check => check.status === 'blocked' && check.id !== (workspace === 'music' ? 'effects' : 'music'))
  const backendLabel = backend.available ? summary.label : 'Desktop app required'
  const modelSummary = `${profile.execution === 'local' ? 'Local' : profile.execution === 'cloud' ? 'Cloud' : readiness.remote ? 'Cloud workflow' : 'Workflow'} / ${choice.workflow && profile.execution === 'workflow' ? choice.workflow.name : profile.label}`
  const generateReason = !backend.available ? 'Generation needs the desktop app.'
    : !connected ? 'Connect to ComfyUI to generate.'
    : !readiness.ready ? (backend.download.phase === 'downloading' && missingHere.length ? 'Generation is ready once the download finishes.' : missingHere.length ? 'Download the model to generate.' : 'Finish model setup to generate.')
    : !plan.request ? plan.problems[0]
    : activeJob ? 'A take is being generated.'
    : readiness.remote ? `Sends your prompt to ${profile.provider?.name ?? 'a partner service'}${profile.provider ? `. About $${estimateCostUsd(profile, plan.request.durationSeconds).toFixed(2)}` : ''}.`
    : 'Runs on your ComfyUI. Nothing leaves this device.'

  const stepIndex = steps.findIndex(step => step.id === draft.step)
  const stepDescription = {
    brief: isMusic ? 'Set the mood. Find the melody.' : 'Small sounds. Big worlds.',
    generate: 'Your idea, ready for a first take.',
    review: 'A little space to listen closely.',
    export: 'From your studio to your project.'
  }[draft.step]
  const stepStatus = (step: Step) => draft.step === step ? 'Current step'
    : step === 'brief' ? (draft.prompt.trim() ? 'Brief drafted' : 'Draft your idea')
    : step === 'generate' ? (activeJob ? statusLabel[activeJob.status] : readiness.ready ? 'Model ready' : 'Needs setup')
    : step === 'review' ? `${workspaceTakes.length} take${workspaceTakes.length === 1 ? '' : 's'}`
    : selectedTake ? 'Take selected' : 'No take yet'

  return <div className="app">
    <header className="topbar">
      <a className="brand" href="#workspace" aria-label="Sound Studio workspace">
        <img src="./icon.svg" alt="" width="40" height="40" />
        <span className="brand-text"><span className="brand-wordmark">sound<strong>studio</strong></span><small>LOCAL SOUND. LIMITLESS IDEAS.</small></span>
      </a>
      <nav className="workspace-tabs" role="tablist" aria-label="Sound workspace" onKeyDown={navigateTabs}>
        {workspaces.map((tab, index) => <Fragment key={tab.id}>
          {index > 0 && <span className="workspace-tab-divider" aria-hidden="true">|</span>}
          <button id={`${tab.id}-tab`} role="tab"
            className={studioWorkspace === tab.id ? 'active' : ''} aria-selected={studioWorkspace === tab.id}
            aria-controls={`${tab.id}-panel`} tabIndex={studioWorkspace === tab.id ? 0 : -1} onClick={() => selectWorkspace(tab.id)}>
            {tab.label}
          </button>
        </Fragment>)}
      </nav>
      <div className="topbar-actions">
        <button className="subtle-button" onClick={openModels} aria-haspopup="dialog"><SlidersHorizontal size={15} /> Model Settings</button>
        <button className={`backend-button ${!isDecomposer && summary.tone === 'warning' && backend.available ? 'warning' : ''}`} onClick={() => isDecomposer ? openModels() : setSurface('connections')} aria-haspopup="dialog" aria-label={isDecomposer ? 'Local analysis' : backendLabel}>
          <span className={`status-dot ${isDecomposer || !backend.available ? '' : summary.tone === 'ready' ? 'blue' : summary.tone === 'pending' ? 'starting' : 'warn'}`} /><span className="backend-label">{isDecomposer ? 'Local analysis' : backendLabel}</span><ChevronRight size={13} /></button>
        <button className="icon-button" aria-label="Quick guide" onClick={() => setSurface('help')} aria-haspopup="dialog"><CircleHelp size={18} /></button>
      </div>
    </header>

    {storageError && <div className="error-banner" role="alert">{storageError} Drafts are currently kept in memory only.</div>}

    <div id="workspace" className="workspace-host">
      {workspaces.map(tab => <div key={tab.id} id={`${tab.id}-panel`} role="tabpanel"
        aria-labelledby={`${tab.id}-tab`} hidden={studioWorkspace !== tab.id} className="workspace-layout">
        {tab.id === 'decomposer' ? <Decomposer draft={state.drafts.decomposer} config={state.decomposition}
          visible={isDecomposer} runtimeRevision={runtimeRevision}
          updateDraft={patch => setState(current => ({ ...current, drafts: { ...current.drafts, decomposer: { ...current.drafts.decomposer, ...patch } } }))}
          updateConfig={patch => setState(current => ({ ...current, decomposition: { ...current.decomposition, ...patch } }))}
          openModels={() => { setModelWorkspace('decomposer'); setSurface('models') }} sendToMusic={setHandoff} storageError={storageError} />
          : studioWorkspace === tab.id && <>
          <aside className="settings-panel" aria-label={`${tab.label} step settings`}>
            <div className="step-kicker"><span className="eyebrow">0{stepIndex + 1} / {steps[stepIndex].label}</span><span className="mini-badge">{executionBadge(profile.execution)}</span></div>
            <h1>{draft.step === 'brief' ? isMusic ? 'Music studio' : 'Sound effects' : steps[stepIndex].label}</h1>
            <p className="panel-intro">{stepDescription}</p>

            {draft.step === 'brief' ? <>
              <div className="input-mode"><WandSparkles size={15} /><span>Text to {noun}</span><span className="mode-label">DRAFT</span></div>
              <label className="field-label" htmlFor="draft-title">Take name <span>optional</span></label>
              <input id="draft-title" maxLength={120} value={draft.title} placeholder={isMusic ? 'An untold story' : 'An undiscovered sound'} onChange={event => updateDraft({ title: event.target.value })} />

              <label className="field-label" htmlFor="prompt">{isMusic ? 'Describe your music' : 'Describe your sound'} <span className={draft.prompt.length > profile.maxPromptChars ? 'warning-inline' : ''}>{draft.prompt.length}/{profile.maxPromptChars}</span></label>
              <textarea id="prompt" maxLength={isMusic ? 200000 : 4000} value={draft.prompt} placeholder={isMusic
                ? 'A feeling, an instrument, a world to get lost in...'
                : 'What do you hear? Describe the source, setting, texture and feeling...'} onChange={event => updateDraft({ prompt: event.target.value })} />
              <p className="field-hint">The more you imagine, the more there is to work with.</p>

              <label className="field-label" htmlFor="category">{isMusic ? 'Genre' : 'Sound category'}</label>
              <select id="category" value={draft.category} onChange={event => updateDraft({ category: event.target.value })}>
                {(isMusic ? musicGenres : effectCategories).map(category => <option key={category}>{category}</option>)}
              </select>

              {isMusic && <><label className="field-label" htmlFor="mood">Mood</label>
                <select id="mood" value={draft.mood} onChange={event => updateDraft({ mood: event.target.value })}>{musicMoods.map(mood => <option key={mood}>{mood}</option>)}</select></>}

              <div className="field-row">
                <div><label className="field-label" htmlFor="duration">Duration <span>sec</span></label>
                  <input id="duration" type="number" min={profile.minSeconds} max={profile.maxSeconds} value={draft.duration} onChange={event => updateDraft({ duration: event.target.value })} /></div>
                {isMusic ? <div><label className="field-label" htmlFor="tempo">Tempo <span>BPM</span></label>
                  <input id="tempo" type="number" min="40" max="240" value={draft.tempo} onChange={event => updateDraft({ tempo: event.target.value })} /></div>
                  : <div><label className="field-label" htmlFor="seed">Seed <span>optional</span></label>
                    <input id="seed" type="number" min="0" max={profile.maxSeed} step="1" value={draft.seed} placeholder="Random" onChange={event => updateDraft({ seed: event.target.value })} /></div>}
              </div>
              {isMusic && <div className="field-row">
                <div><label className="field-label" htmlFor="seed">Seed <span>optional</span></label>
                  <input id="seed" type="number" min="0" max={profile.maxSeed} step="1" value={draft.seed} placeholder="Random" onChange={event => updateDraft({ seed: event.target.value })} /></div>
                {profile.supportsKey && <div><label className="field-label" htmlFor="music-key">Key</label>
                  <select id="music-key" value={draft.musicKey} onChange={event => updateDraft({ musicKey: event.target.value })}>{musicKeys.map(key => <option key={key}>{key}</option>)}</select></div>}
              </div>}
              {profile.durationControl === 'prompt' && <p className="field-hint">{profile.label} has no length control. The duration is described in the prompt, so the take may be shorter or longer.</p>}
              <label className="check-field"><input type="checkbox" checked={isMusic ? draft.instrumental : draft.loop}
                onChange={event => updateDraft(isMusic ? { instrumental: event.target.checked } : { loop: event.target.checked })} />
                <span>{isMusic ? 'Instrumental only' : 'Seamless loop'}<small>{isMusic ? 'Let the instruments do the talking' : 'Asks the model for a loopable sound. Seamlessness is not guaranteed.'}</small></span>
              </label>
              {isMusic && !draft.instrumental && <>
                <label className="field-label" htmlFor="lyrics">Lyrics <span>{draft.lyrics.length}/4000</span></label>
                <textarea id="lyrics" className="lyrics" maxLength={4000} value={draft.lyrics} placeholder={'[verse]\nWrite your lyrics here\n\n[chorus]\n...'} onChange={event => updateDraft({ lyrics: event.target.value })} />
                {!profile.supportsLyrics && <p className="warning-text"><AlertTriangle size={14} /> {profile.label} cannot sing lyrics. Choose a lyrics-capable model in Model Settings.</p>}
              </>}
              <p className="fine-print">{profile.label}: {profile.minSeconds}-{profile.maxSeconds} sec, up to {profile.maxPromptChars.toLocaleString()} characters.</p>
            </> : draft.step === 'generate' ? <>
              <div className="summary-card"><span className="eyebrow">YOUR BRIEF</span><h3>{draft.title || 'Untitled take'}</h3>
                <p>{draft.prompt || 'No description yet. Head back to Describe to shape your idea.'}</p>
                <div className="summary-tags"><span>{draft.category}</span><span>{draft.duration || '--'} sec</span>{isMusic && <span>{draft.tempo} BPM</span>}{isMusic && profile.supportsKey && <span>{draft.musicKey}</span>}</div>
              </div>
              <button className="text-button" onClick={() => selectStep('brief')}>Edit your brief <ArrowRight size={14} /></button>
              <ModelDownloadPanel backend={backend} items={missingHere} />
              {(!readiness.ready || !plan.request) && <ul className="issue-list" aria-label="Before you generate">
                {[...readiness.issues.filter(issue => !(missingHere.length && /^No .* found in ComfyUI\/models/.test(issue))), ...(plan.request ? [] : plan.problems.filter(problem => readiness.ready || !problem.startsWith('Select an installed')))].map(issue => <li key={issue}><AlertTriangle size={13} /> {issue}</li>)}
              </ul>}
              {latestJob && <JobCard job={latestJob} onCancel={() => void backend.cancel(latestJob.id).catch(error => setFeedback({ workspace, error: true, text: String(error instanceof Error ? error.message : error) }))}
                onReview={() => selectStep('review')} />}
            </> : draft.step === 'review' ? <>
              {selectedTake ? <TakeSummary take={selectedTake} /> : <div className="summary-card"><Headphones size={24} /><h3>Nothing to review yet</h3><p>Generate a take and it will appear here, ready to play.</p></div>}
              {workspaceTakes.length > 1 && <p className="field-hint">Choose another take under Recent takes to compare.</p>}
            </> : <>
              {selectedTake ? <TakeSummary take={selectedTake} /> : <div className="summary-card"><ArrowDownToLine size={24} /><h3>Ready when your sound is</h3><p>Generate and review a take, then export it here.</p></div>}
              <div className="info-box"><Info size={17} /><p>Export copies the original {selectedTake?.audio.format.toUpperCase() ?? 'audio'} file and writes a .provenance.json with the prompt, model, settings and workflow beside it.</p></div>
            </>}

            {workspaceFeedback && <p className={workspaceFeedback.error ? 'warning-text' : 'success-text'} role={workspaceFeedback.error ? 'alert' : 'status'}>
              {workspaceFeedback.error ? <AlertTriangle size={14} /> : <Check size={14} />} {workspaceFeedback.text}</p>}

            <div className="action-area">
              {backend.available && summary.tone === 'warning' && (!connected || blockingHere.length > 0) && (draft.step === 'brief' || draft.step === 'generate') && <button className="setup-warning" onClick={() => setSurface('connections')} aria-haspopup="dialog">
                <AlertTriangle size={15} /><span>{connected ? `${blockingHere.length} backend check${blockingHere.length === 1 ? ' needs' : 's need'} attention` : 'ComfyUI is not running'}
                  <small>{connected ? 'Review setup before generation' : 'Start it with one click'} <ArrowRight size={11} /></small></span></button>}
              <button className={`model-summary ${readiness.remote ? 'remote' : ''}`} onClick={openModels} aria-haspopup="dialog" aria-label={`Model: ${modelSummary}. ${readiness.ready ? 'Ready' : 'Needs setup'}. Open Model Settings`}>
                <span><span className={`status-dot ${readiness.ready ? 'blue' : 'warn'}`} />{readiness.remote && <Cloud size={12} />} {modelSummary}</span><Settings2 size={14} /></button>
              {draft.step === 'brief' ? <button className="primary full" onClick={() => selectStep('generate')}>Continue to generation <ArrowRight size={16} /></button>
                : draft.step === 'generate' ? <button className="primary full" disabled={!canGenerate} aria-describedby="action-reason" onClick={() => void generate()}>
                  {starting ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />} Generate {noun}</button>
                : draft.step === 'review' ? <button className="primary full" disabled={!selectedTake} aria-describedby="action-reason" onClick={() => selectStep('export')}>Continue to export <ArrowRight size={16} /></button>
                : <button className="primary full" disabled={!selectedTake || !backend.available} aria-describedby="action-reason" onClick={() => selectedTake && void exportTake(selectedTake)}><ArrowDownToLine size={16} /> Export audio</button>}
              <p id="action-reason" className="action-note">{draft.step === 'brief' ? 'Save the idea. The sound comes next.'
                : draft.step === 'generate' ? generateReason
                : draft.step === 'review' ? (selectedTake ? 'Happy with this take? Take it with you.' : 'No takes yet.')
                : selectedTake ? 'Choose where to save the file.' : 'Select a take to export.'}</p>
            </div>
            <div className="library-launcher"><button className="text-button" onClick={() => setSurface('library')} aria-haspopup="dialog"><Library size={16} /> Sound library <span className="count">{backend.takes.length}</span><ChevronRight size={14} /></button>
              <span className="saved-state"><Check size={12} /> {storageError ? 'Draft in memory only' : 'Draft saved on this device'}</span>
            </div>
          </aside>

          <main className="workflow-main" ref={mainRef}>
            <nav className="process-stepper" aria-label={`${tab.label} workflow`}>
              <ol>{steps.map((step, index) => <li key={step.id}>
                <button className={`process-step ${draft.step === step.id ? 'current' : ''}`} aria-current={draft.step === step.id ? 'step' : undefined}
                  onClick={() => selectStep(step.id)}>
                  <span className="step-number">{index + 1}</span><span className="step-copy"><strong>{step.label}</strong><small>{stepStatus(step.id)}</small></span>
                </button>
              </li>)}</ol>
            </nav>

            <div className="canvas-heading"><div><p className="eyebrow">{isMusic ? 'MUSIC' : 'SOUND'} CANVAS</p>
              <h2>{draft.step === 'brief' ? 'An idea waiting to be heard' : draft.step === 'generate' ? 'Make room for your next idea' : draft.step === 'review' ? 'Find the take that feels right' : 'Your sound, beyond the studio'}</h2></div>
              <span className="outline-badge"><span className={`status-dot ${activeJob || selectedTake ? 'blue' : ''}`} /> {activeJob ? statusLabel[activeJob.status] : selectedTake ? 'Take loaded' : 'No audio yet'}</span>
            </div>

            {selectedTake ? <TakePlayer key={selectedTake.id} take={selectedTake} /> : <section className="sound-canvas" aria-label="Audio preview">
              <div className="canvas-toolbar"><span><AudioLines size={14} /> {isMusic ? 'MUSIC PREVIEW' : 'WAVEFORM'}</span><span>{activeJob ? 'GENERATING' : 'NO AUDIO LOADED'}</span></div>
              <div className="canvas-empty">
                <div className="sound-illustration" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="wave-mark"><AudioLines size={52} strokeWidth={1.2} /></div><span className="orbit-point point-one" /><span className="orbit-point point-two" /></div>
                <span className="eyebrow canvas-eyebrow">A LITTLE QUIET. A LOT OF POSSIBILITY.</span>
                <h3>{isMusic ? 'Every world deserves a soundtrack.' : 'Make something worth hearing.'}</h3>
                <p>{isMusic ? 'Set a mood, sketch a melody, imagine the atmosphere.' : 'A forest at dawn. A distant galaxy. The perfect little click.'}<br />Your next {isMusic ? 'track' : 'sound'} starts with a few words.</p>
                <span className="placeholder-note"><Info size={13} /> {activeJob ? activeJob.message : !backend.available ? 'Generation and playback need the desktop app.' : connected ? 'No takes yet. Generated audio will play here.' : 'Connect your local ComfyUI to generate audio.'}</span>
                {backend.available && !connected && !activeJob && (launcher?.layout
                  ? <button className="primary start-comfy" disabled={comfyStarting || backend.connection.state === 'checking'} onClick={() => void backend.startComfy(backend.settings.endpoint)}>
                    {comfyStarting ? <LoaderCircle className="spin" size={15} /> : <Zap size={15} />}{comfyStarting ? 'Starting ComfyUI...' : 'Start local ComfyUI'}</button>
                  : <button className="subtle-button" onClick={() => setSurface('connections')}><Radio size={14} /> Set up ComfyUI</button>)}
              </div>
              <div className="transport"><div className="transport-controls">
                <button className="play-button" disabled aria-label="Play audio"><Play size={16} fill="currentColor" /></button>
                <span className="timecode">00:00 <span>/ --:--</span></span></div>
                <div className="transport-track" aria-hidden="true"><span /></div>
                <span className="transport-format">NO TAKE SELECTED</span>
              </div>
            </section>}

            <section className="inspiration" aria-labelledby={`${tab.id}-inspiration`}>
              <div className="section-heading"><h3 id={`${tab.id}-inspiration`}><Sparkles size={14} /> A starting point, if you need one</h3><span>LOAD A SAMPLE BRIEF</span></div>
              <div className="example-grid">{examples[workspace].map((example, index) => {
                const Icon = isMusic ? [Music2, ListMusic, Waves][index] : [Waves, Zap, Radio][index]
                return <button className="example-card" key={example.title} onClick={() => {
                  updateDraft({ prompt: example.prompt, category: example.category, step: 'brief' })
                  setNotice(`"${example.title}" loaded into your brief. No audio was generated.`)
                }}>
                  <span className="example-icon"><Icon size={20} strokeWidth={1.5} /></span><span><small>{example.detail}</small><strong>{example.title}</strong></span><ArrowRight size={14} />
                </button>
              })}</div>
              <span className="sr-only" role="status">{notice}</span>
            </section>

            <section className="takes-section" aria-label="Recent takes">
              <div className="section-heading"><h3>Recent takes <span className="count">{workspaceTakes.length}</span></h3><button className="text-button" onClick={() => setSurface('library')}>Open library <ArrowRight size={13} /></button></div>
              {workspaceJobs.filter(job => job.status !== 'completed').slice(0, 3).map(job => <div key={job.id} className={`job-row ${job.status}`}>
                {activeStatuses.includes(job.status) ? <LoaderCircle size={14} className="spin" /> : <AlertTriangle size={14} />}
                <span><strong>{job.title}</strong> / {statusLabel[job.status]}: {job.message}</span></div>)}
              {workspaceTakes.length ? <div className="take-list">{workspaceTakes.slice(0, 8).map(take => <button key={take.id}
                className={`take-row ${take.id === selectedTake?.id ? 'selected' : ''}`} aria-pressed={take.id === selectedTake?.id}
                onClick={() => setSelectedTakes(current => ({ ...current, [workspace]: take.id }))}>
                <Play size={13} /><span className="take-row-title">{takeDisplayTitle(take)}</span>
                <span className="take-row-meta">{take.model.provider ? <><Cloud size={11} /> </> : null}{take.model.workflowName ?? take.model.label} / {formatTime(take.audio.durationSeconds)}</span>
              </button>)}</div>
                : <div className="empty-takes"><Layers3 size={19} /><span>No takes yet. Your generated {isMusic ? 'music' : 'sounds'} will find a home here.</span><span className="local-tag"><ShieldCheck size={12} /> STORED ON YOUR DEVICE</span></div>}
            </section>
          </main>
        </>}
      </div>)}
    </div>

    <footer className="statusbar"><span><ShieldCheck size={13} /> LOCAL FIRST <span className="footer-divider">/</span><span>{backend.cloud?.enabled ? 'Cloud partner models enabled' : 'No cloud. No uploads.'}</span></span><span className="footer-flow">Describe <ChevronRight size={10} /> {isDecomposer ? 'Decompose' : 'Generate'} <ChevronRight size={10} /> Refine <ChevronRight size={10} /> Export</span><span><span className="status-dot blue" /> PREVIEW <span className="footer-divider">/</span> v{version}</span></footer>

    {surface === 'models' && <Dialog title="Model Settings" eyebrow="YOUR LOCAL ENGINE" drawer onClose={() => { setSurface(null); setRuntimeRevision(value => value + 1) }}>
      <YourComputer backend={backend} />
      <label className="field-label" htmlFor="model-task">Task</label>
      <select id="model-task" value={modelWorkspace} onChange={event => {
        const task = event.target.value
        if (task === 'effects' || task === 'music' || task === 'decomposer') setModelWorkspace(task)
      }}>{workspaces.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}</select>
      {modelWorkspace === 'decomposer' ? <DecomposerModels />
        : <ModelSettings backend={backend} workspace={modelWorkspace} />}
    </Dialog>}

    {surface === 'connections' && <Dialog title="Backend connections" eyebrow="LOCAL INFRASTRUCTURE" onClose={() => setSurface(null)}>
      <BackendConnections backend={backend} checks={checks} storageError={storageError} onModels={next => { setModelWorkspace(next); setSurface('models') }} />
    </Dialog>}

    {surface === 'library' && <Dialog title="Sound library" eyebrow="YOUR COLLECTION" drawer onClose={() => setSurface(null)}>
      <p className="dialog-intro">Every take you have generated, stored on this device.</p>
      <button className="secondary-button" onClick={() => { setSurface(null); selectWorkspace('decomposer') }}>Open Decomposer analysis library</button>
      {backend.takesError && <p className="warning-text" role="alert"><AlertTriangle size={14} /> {backend.takesError}</p>}
      {!!backend.unreadableTakes && <p className="warning-text"><AlertTriangle size={14} /> {backend.unreadableTakes} take record{backend.unreadableTakes === 1 ? '' : 's'} could not be read and {backend.unreadableTakes === 1 ? 'was' : 'were'} left untouched.</p>}
      {feedback?.workspace === 'all' && <p className={feedback.error ? 'warning-text' : 'success-text'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
      {backend.takes.length ? <ul className="library-list">{backend.takes.map(take => <li key={take.id}>
        <div><strong>{takeDisplayTitle(take)}</strong>
          <small>{take.workspace === 'music' ? 'Music' : 'Effect'} / {take.model.workflowName ?? take.model.label}{take.model.provider ? ` (${take.model.provider})` : ''} / {formatTime(take.audio.durationSeconds)} {take.audio.format.toUpperCase()} / {new Date(take.createdAt).toLocaleString()}</small></div>
        <span className="library-actions">
          <button className="icon-button" aria-label={`Open ${takeDisplayTitle(take)}`} onClick={() => openTake(take)}><Play size={15} /></button>
          <button className="icon-button" aria-label={`Export ${takeDisplayTitle(take)}`} onClick={() => void exportTake(take)}><ArrowDownToLine size={15} /></button>
          <button className="icon-button" aria-label={`Delete ${takeDisplayTitle(take)}`} onClick={() => void deleteTake(take)}><Trash2 size={15} /></button>
        </span>
      </li>)}</ul> : <div className="library-empty"><FolderOpen size={42} strokeWidth={1} /><h3>Good things start with a blank slate.</h3><p>No takes yet. Generated audio is saved here after ComfyUI returns a valid file.</p></div>}
      <span className="outline-badge">{backend.takes.filter(take => take.workspace === 'effects').length} EFFECTS / {backend.takes.filter(take => take.workspace === 'music').length} MUSIC</span>
    </Dialog>}

    {surface === 'help' && <Dialog title="A small guide to the studio" eyebrow="WELCOME TO SOUND STUDIO" onClose={() => setSurface(null)}>
      <p className="dialog-intro">Three workspaces. One place to find and understand your sound.</p>
      <div className="guide-item"><AudioLines size={20} /><div><h3>Effects for the little details</h3><p>Describe ambience, foley, interface sounds or something entirely new. Choose a category and sketch your timing.</p></div></div>
      <div className="guide-item"><Music2 size={20} /><div><h3>Music for the bigger picture</h3><p>Set a genre, mood, tempo and key, and add lyrics when your model can sing.</p></div></div>
      <div className="guide-item"><Layers3 size={20} /><div><h3>Decomposer for studying existing music</h3><p>Import existing audio, analyse an excerpt locally, review estimates and export stems, lyrics, MIDI and a musical brief. Models require explicit installation; estimates and sung lyrics need human review.</p></div></div>
      <div className="guide-item"><Settings2 size={20} /><div><h3>Bring your own ComfyUI</h3><p>Install ComfyUI and a model. Sound Studio can start ComfyUI for you from Backend, or connect to one you started. Choose models in Model Settings.</p></div></div>
      <div className="guide-item"><Clock3 size={20} /><div><h3>Your ideas stay with you</h3><p>Drafts and takes are saved on this device. Cloud partner models are off unless you turn them on.</p></div></div>
    </Dialog>}
    {handoff && <Dialog title="Send brief to Music" eyebrow="PRESERVE YOUR EXISTING DRAFT" onClose={() => setHandoff(null)}>
      <p className="dialog-intro">Transfer {handoff.prompt.length.toLocaleString()} characters. Your Music draft is unchanged until you choose. Append preserves its settings; replace uses analysis settings. Generation still requires a brief within the selected model's limits.</p>
      <pre className="handoff-preview">{handoff.prompt}</pre>
      <div className="export-actions"><button className="primary" onClick={() => applyHandoff(true)}>Append to Music draft</button><button className="secondary-button" onClick={() => applyHandoff(false)}>Replace Music draft</button><button onClick={() => setHandoff(null)}>Cancel transfer</button></div>
      {notice && <p role="status">{notice}</p>}
    </Dialog>}
  </div>
}

function JobCard({ job, onCancel, onReview }: { job: JobState; onCancel: () => void; onReview: () => void }) {
  const active = activeStatuses.includes(job.status)
  return <div className={`job-card ${job.status}`} role="status" aria-live="polite">
    <div className="job-card-head"><span className="eyebrow">{statusLabel[job.status]}{job.remote ? ' / CLOUD' : ''}</span>
      {active && <button className="subtle-button" onClick={onCancel}><Square size={11} /> Cancel</button>}
      {job.status === 'completed' && job.takeId && <button className="subtle-button" onClick={onReview}>Review take <ArrowRight size={12} /></button>}</div>
    <p><strong>{job.title}</strong> / {job.profileLabel}</p>
    <p className="job-message">{job.message}</p>
    {active && <div className="progress" role="progressbar" aria-label="Generation progress" aria-valuemin={0} aria-valuemax={job.progress?.max ?? undefined} aria-valuenow={job.progress?.value ?? undefined}>
      <span style={{ width: job.progress ? `${(job.progress.value / job.progress.max) * 100}%` : undefined }} className={job.progress ? '' : 'indeterminate'} /></div>}
  </div>
}

function TakeSummary({ take }: { take: TakeRecord }) {
  return <div className="summary-card"><span className="eyebrow">SELECTED TAKE</span><h3>{takeDisplayTitle(take)}</h3>
    <p>{take.request.prompt}</p>
    <div className="summary-tags"><span>{formatTime(take.audio.durationSeconds)}</span><span>{take.audio.format.toUpperCase()} {Math.round(take.audio.sampleRate / 100) / 10} kHz</span><span>Seed {take.request.seed}</span></div>
    <p className="field-hint">{take.model.workflowName ?? take.model.label}{take.model.provider ? ` via ${take.model.provider}` : ' on your ComfyUI'}</p>
  </div>
}
