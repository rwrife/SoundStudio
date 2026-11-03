import { useEffect, useRef, useState } from 'react'
import { ArrowRight, AudioLines, FolderOpen, Layers3, Pause, Play, Settings2 } from 'lucide-react'
import {
  defaultOptions, mediaUrl, optionsSchema, reviewedBrief, reviewSchema,
  type AnalysisJob, type Asset, type ExportKind, type LibrarySnapshot, type Profile, type Review, type RuntimeStatus, type Stem
} from '../shared/decomposer'
import { buildVariationBrief, decomposerFocuses, examples, steps, type DecompositionDraft, type Draft } from '../shared/workspace'
import { Dialog } from './Dialog'

const api = window.soundStudio?.decomposer
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`

export function DecomposerModels() {
  const [status, setStatus] = useState<RuntimeStatus>()
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<Profile | null>(null)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try { const next = await api?.runtime(); if (active) setStatus(next) }
      catch (error) { if (active) setError(errorText(error)) }
      if (active) timer = setTimeout(() => { void refresh() }, 3000)
    }
    void refresh()
    return () => { active = false; clearTimeout(timer) }
  }, [])
  async function install(profile: Profile) {
    try { setError(''); await api?.install(profile); setConfirm(null); setStatus(await api?.runtime()) }
    catch (error) { setError(errorText(error)) }
  }
  return <section aria-label="Local decomposition models">
    <h3 className="model-heading">Local music decomposition</h3>
    <p className="dialog-intro">Install only what you need. Downloads contact Python package/model hosts; your audio and prompts are never uploaded. Analysis is CPU-only and network-blocked after acquisition.</p>
    {!api && <p role="alert">Model setup requires the Electron desktop app, not the web preview.</p>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {status && <>
      <p className="fine-print">{status.platform} / {status.memoryGiB} GiB physical RAM (not free RAM) / Python {status.python ?? 'not ready'}. GPU acceleration is not configured.</p>
      <p role="status" className="info-box">{status.message}</p>
      {status.error && <p className="error-banner" role="alert">{status.error}</p>}
      {status.busy && <button className="secondary-button" onClick={() => { void api?.cancelInstall().catch(error => setError(errorText(error))) }}>Cancel installation</button>}
      {status.profiles.map(profile => <div key={profile.id} className="model-card">
        <h3>{profile.label}</h3>
        <p><strong>{profile.ready ? 'Installed; local readiness checked' : 'Not ready'}</strong> - {profile.detail}</p>
        <p>{profile.download}</p><p className="fine-print">{profile.license}. Estimates exclude caches and temporary download space.</p>
        {confirm === profile.id ? <div className="download-confirm">
          <p>Download and install this profile from its upstream hosts? Keep enough disk space available. No audio is sent.</p>
          <button className="primary" onClick={() => { void install(profile.id) }}>Confirm download</button>
          <button onClick={() => setConfirm(null)}>Not now</button>
        </div> : <button className="secondary-button full" disabled={status.busy || (profile.id !== 'core' && !status.profiles[0].ready)} onClick={() => setConfirm(profile.id)}>{profile.ready ? 'Repair / reacquire' : 'Download & install'}</button>}
      </div>)}
    </>}
    {!status && api && <p role="status">Checking the managed local runtime...</p>}
  </section>
}

function AudioReview({ asset, job, start, end, visible }: { asset: Asset; job?: AnalysisJob; start: number; end: number; visible: boolean }) {
  const reference = useRef<HTMLAudioElement>(null)
  const tracks = useRef<Partial<Record<Stem, HTMLAudioElement | null>>>({})
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [mode, setMode] = useState<'reference' | 'stems'>('reference')
  const [muted, setMuted] = useState<Stem[]>([])
  const [solo, setSolo] = useState<Stem | null>(null)
  const [error, setError] = useState('')
  const stems = job?.state === 'completed' ? job.raw?.stems ?? [] : []
  function pause() {
    reference.current?.pause()
    Object.values(tracks.current).forEach(track => track?.pause())
    setPlaying(false)
  }
  function synchronize() {
    const audio = reference.current
    if (!audio || !job) return
    for (const [name, track] of Object.entries(tracks.current)) {
      if (!track) continue
      const relative = audio.currentTime - job.options.start
      track.muted = mode !== 'stems' || relative < 0 || relative >= job.options.end - job.options.start || muted.includes(name as Stem) || (solo !== null && solo !== name)
      if (relative >= 0 && Math.abs(track.currentTime - relative) > 0.1) track.currentTime = Math.min(relative, Number.isFinite(track.duration) ? track.duration : relative)
      if (mode === 'stems' && !audio.paused && relative >= 0 && relative < job.options.end - job.options.start && track.paused) {
        void track.play().catch(error => { pause(); setError(`Stem playback failed: ${errorText(error)}`) })
      }
    }
  }
  function seek(time: number) {
    if (!reference.current) return
    reference.current.currentTime = time
    setPosition(time)
    synchronize()
  }
  async function play() {
    if (playing) { pause(); return }
    const audio = reference.current
    if (!audio) return
    setError('')
    if (audio.currentTime < start || audio.currentTime >= end) seek(start)
    audio.muted = mode === 'stems'
    synchronize()
    try {
      await Promise.all([audio.play(), ...Object.values(tracks.current).map(track => track?.play())])
      setPlaying(true)
    } catch (error) { pause(); setError(`Playback failed. ${errorText(error)} Reopen the analysis or reimport missing audio.`) }
  }
  useEffect(() => {
    if (reference.current) reference.current.muted = mode === 'stems'
    synchronize()
  }, [mode, muted, solo])
  useEffect(() => { if (!visible) pause() }, [visible])
  return <section className="audio-review" aria-label="Reference waveform and playback">
    <div className="canvas-toolbar"><span><AudioLines size={16} /> {asset.name}</span><span>{asset.sampleRate} HZ / {asset.channels} CH</span></div>
    <svg className="real-waveform" viewBox="0 0 1000 140" preserveAspectRatio="none" role="img" aria-label="Decoded reference waveform">
      <rect x={1000 * start / asset.duration} y="0" width={1000 * (end - start) / asset.duration} height="140" className="excerpt-highlight" />
      {asset.peaks.map((peak, index) => <line key={index} x1={1000 * index / asset.peaks.length} x2={1000 * index / asset.peaks.length} y1={70 - peak * 64} y2={70 + peak * 64} />)}
      <line className="playhead" x1={1000 * position / asset.duration} x2={1000 * position / asset.duration} y1="0" y2="140" />
    </svg>
    <audio ref={reference} src={mediaUrl(asset.id, 'reference')} preload="metadata"
      onTimeUpdate={() => {
        const time = reference.current?.currentTime ?? 0
        setPosition(time); synchronize()
        if (time >= end && playing) pause()
      }} onEnded={pause} onError={() => setError('Source audio is missing, replaced, corrupt or could not be decoded. Import the original again.')} />
    {stems.map(stem => <audio key={`${job!.id}-${stem}`} ref={node => { tracks.current[stem] = node }}
      src={mediaUrl(job!.id, stem)} preload="metadata" onError={() => { pause(); setError(`The ${stem} stem is unavailable or changed. Run a new analysis.`) }} />)}
    <div className="transport">
      <button className="play-button" aria-label={playing ? 'Pause reference' : 'Play reference'} onClick={() => { void play() }}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
      <span className="timecode">{formatTime(position)} / {formatTime(asset.duration)}</span>
      <input type="range" min="0" max={asset.duration} step="0.01" value={position} aria-label="Seek reference" onChange={event => seek(Number(event.target.value))} />
      <button onClick={() => seek(start)}>Excerpt start</button>
    </div>
    {stems.length > 0 && <div className="stem-mixer">
      <div className="segmented"><button aria-pressed={mode === 'reference'} onClick={() => setMode('reference')}>Original mix</button><button aria-pressed={mode === 'stems'} onClick={() => { pause(); seek(job!.options.start); setMode('stems') }}>Separated stems</button></div>
      {stems.map(stem => <div className="stem-row" key={stem}><strong>{stem}</strong>
        <button aria-pressed={muted.includes(stem)} aria-label={`Mute ${stem}`} onClick={() => setMuted(current => current.includes(stem) ? current.filter(item => item !== stem) : [...current, stem])}>Mute</button>
        <button aria-pressed={solo === stem} aria-label={`Solo ${stem}`} onClick={() => setSolo(solo === stem ? null : stem)}>Solo</button>
      </div>)}
      <p className="fine-print">Stem previews follow the reference clock; listen within the analysed excerpt. Exports retain the model's sample-aligned WAVs.</p>
    </div>}
    {error && <p role="alert" className="error-banner">{error}</p>}
  </section>
}

function ReviewEditor({ job, onSave, onDirty }: { job: AnalysisJob; onSave: (review: Review) => Promise<void>; onDirty: (dirty: boolean) => void }) {
  const [review, setReview] = useState<Review>(() => structuredClone(job.reviewed ?? reviewSchema.strip().parse(job.raw)))
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const update = (patch: Partial<Review>) => { setReview(current => ({ ...current, ...patch })); setDirty(true); onDirty(true) }
  async function save() {
    setSaving(true)
    try { setError(''); await onSave(reviewSchema.parse(review)); setDirty(false); onDirty(false) }
    catch (error) { setError(errorText(error)) }
    finally { setSaving(false) }
  }
  return <section className="review-editor" aria-label="Editable analysis results">
    <h3>Review estimates, sections, descriptions and lyrics</h3>
    <p className="panel-intro">Times are seconds from the original source, not the excerpt. Machine results remain immutable; corrections are saved separately. Singing transcription and word timing can be wrong. Timing is not correctness verification.</p>
    <div className="field-row">
      <label>Estimated tempo (BPM)<input type="number" value={review.tempo ?? ''} min="1" max="400" onChange={event => update({ tempo: event.target.value === '' ? null : Number(event.target.value) })} /></label>
      <label>Estimated key<input value={review.key} maxLength={120} onChange={event => update({ key: event.target.value })} /></label>
    </div>
    {(['sections', 'chords', 'descriptions', 'lyrics'] as const).map(kind => <details key={kind} open={kind === 'descriptions' || kind === 'lyrics'}>
      <summary>{kind} ({review[kind].length})</summary>
      {!review[kind].length && <p className="fine-print">No machine {kind} available. Add a clearly reviewed observation if needed.</p>}
      {review[kind].map((line, index) => <div className="timed-line" key={index}>
        <input aria-label={`${kind} ${index + 1} start`} type="number" step="0.01" value={line.start} onChange={event => update({ [kind]: review[kind].map((item, i) => i === index ? { ...item, start: Number(event.target.value) } : item) })} />
        <input aria-label={`${kind} ${index + 1} end`} type="number" step="0.01" value={line.end} onChange={event => update({ [kind]: review[kind].map((item, i) => i === index ? { ...item, end: Number(event.target.value) } : item) })} />
        <textarea aria-label={`${kind} ${index + 1} text`} value={line.text} maxLength={20000} onChange={event => update({ [kind]: review[kind].map((item, i) => i === index ? { ...item, text: event.target.value } : item) })} />
        <button aria-label={`Remove ${kind} ${index + 1}`} onClick={() => update({ [kind]: review[kind].filter((_item, i) => i !== index) })}>Remove</button>
      </div>)}
      <button className="text-button" onClick={() => update({ [kind]: [...review[kind], { start: review[kind].at(-1)?.end ?? job.options.start, end: job.options.end, text: '' }] })}>Add {kind} line</button>
    </details>)}
    <button className="primary" disabled={!dirty || saving} onClick={() => { void save() }}>Save reviewed corrections</button>
    {dirty && <button className="secondary-button" disabled={saving} onClick={() => { setReview(structuredClone(job.reviewed!)); setDirty(false); onDirty(false); setError('') }}>Discard unsaved corrections</button>}
    <span role="status" className="fine-print">{dirty ? ' Unsaved corrections: save before navigation, export or handoff.' : ` Saved revision ${job.revision}.`}</span>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <details><summary>Raw machine evidence and provenance (read-only)</summary><pre>{JSON.stringify(job.raw, null, 2)}</pre></details>
  </section>
}

export function Decomposer({ draft, config, updateDraft, updateConfig, openModels, sendToMusic, storageError, visible, runtimeRevision }: {
  draft: Draft; config: DecompositionDraft; updateDraft: (patch: Partial<Draft>) => void
  updateConfig: (patch: Partial<DecompositionDraft>) => void; openModels: () => void
  sendToMusic: (brief: { title: string; prompt: string; tempo: string; duration: string; instrumental: boolean }) => void
  storageError: string
  visible: boolean
  runtimeRevision: number
}) {
  const [library, setLibrary] = useState<LibrarySnapshot>({ assets: [], jobs: [], errors: [] })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [runtime, setRuntime] = useState<RuntimeStatus>()
  const [reviewDirty, setReviewDirty] = useState(false)
  const asset = library.assets.find(item => item.id === config.assetId)
  const job = library.jobs.find(item => item.id === config.analysisId)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try { const value = await api?.library(); if (active && value) setLibrary(value) }
      catch (error) { if (active) setError(errorText(error)) }
      if (active) timer = setTimeout(() => { void refresh() }, 800)
    }
    void refresh()
    return () => { active = false; clearTimeout(timer) }
  }, [])
  useEffect(() => {
    let active = true
    void api?.runtime().then(value => { if (active) setRuntime(value) }).catch(error => { if (active) setError(errorText(error)) })
    return () => { active = false }
  }, [runtimeRevision])
  async function action(run: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await run() } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
  }
  async function importAudio() {
    if (!api) throw new Error('Audio import requires the desktop application.')
    const imported = await api.importAudio()
    if (imported) {
      setLibrary(await api.library())
      updateConfig({ assetId: imported.id, analysisId: null, start: 0, end: Math.min(30, imported.duration) })
      setNotice('Original audio copied intact into the local library. Select an excerpt and analysis stages.')
    }
  }
  async function analyze() {
    if (!api || !asset) throw new Error('Import a reference song first.')
    const options = optionsSchema.parse({
      start: config.start, end: config.end, stems: config.stems, lyrics: config.lyrics,
      notes: config.notes, captions: config.captions, wordTimestamps: config.wordTimestamps
    })
    const next = await api.start({ assetId: asset.id, title: draft.title || asset.name.slice(0, 120), options })
    setLibrary(await api.library())
    updateConfig({ analysisId: next.id })
  }
  const selectStep = (step: Draft['step']) => updateDraft({ step })
  const running = job && ['queued', 'running'].includes(job.state)
  function handoff() {
    try {
      if (job?.state === 'completed') sendToMusic({
        title: job.title, prompt: reviewedBrief(job), tempo: String(job.reviewed?.tempo ?? ''),
        duration: String(job.options.end - job.options.start), instrumental: !job.reviewed?.lyrics.length
      })
      else sendToMusic(buildVariationBrief(draft))
    } catch (error) { setError(errorText(error)) }
  }
  return <>
    <aside className="settings-panel" aria-label="Decomposer step settings">
      <div className="step-kicker"><span className="eyebrow">LOCAL REFERENCE ANALYSIS</span><span className="mini-badge">CPU</span></div>
      <h1>Music decomposer</h1><p className="panel-intro">Study a real recording. Keep the original. Review every estimate.</p>
      <button className="secondary-button full" disabled={!api || busy || reviewDirty} onClick={() => { void action(importAudio) }}><FolderOpen size={16} />{busy ? 'Working...' : 'Import local audio'}</button>
      <p className="fine-print">WAV / FLAC / MP3 / OGG / M4A, subject to decoder validation. Up to 512 MB / 30 minutes / stereo. Core runtime required.</p>
      <label className="field-label" htmlFor="analysis-title">Analysis name</label>
      <input id="analysis-title" maxLength={120} value={draft.title} onChange={event => updateDraft({ title: event.target.value })} />
      {draft.step === 'brief' && <>
        <label className="field-label" htmlFor="analysis-goal">Describe your analysis goal <span>{draft.prompt.length}/4000</span></label>
        <textarea id="analysis-goal" maxLength={4000} value={draft.prompt} onChange={event => updateDraft({ prompt: event.target.value })} placeholder="What should a future variation preserve? These notes are intent, not evidence." />
        <label className="field-label" htmlFor="analysis-focus">Analysis focus</label>
        <select id="analysis-focus" value={draft.category} onChange={event => updateDraft({ category: event.target.value })}>{decomposerFocuses.map(item => <option key={item}>{item}</option>)}</select>
      </>}
      <div className="field-row">
        <label className="field-label">Excerpt start (sec)<input aria-label="Excerpt start" type="number" min="0" max={asset?.duration ?? 1800} step="0.01" value={config.start} onChange={event => updateConfig({ start: Number(event.target.value) })} /></label>
        <label className="field-label">Excerpt end (sec)<input aria-label="Excerpt end" type="number" min="0" max={asset?.duration ?? 1800} step="0.01" value={config.end} onChange={event => updateConfig({ end: Number(event.target.value) })} /></label>
      </div>
      <p className="fine-print">Maximum analysed excerpt: 10 minutes. Descriptions aggregate audio windows of at most 30 seconds.</p>
      <div className="stage-options"><strong>Timing, energy, key & chords</strong><small>Always included; DSP estimates, not AI descriptions.</small>
        <fieldset><legend>Separate selected stems (HTDemucs)</legend>{(['vocals', 'drums', 'bass', 'other'] as const).map(stem => <label className="check-field" key={stem}>
          <input type="checkbox" checked={config.stems.includes(stem)} onChange={event => updateConfig({ stems: event.target.checked ? [...config.stems, stem] : config.stems.filter(item => item !== stem) })} />{stem}
        </label>)}</fieldset>
        <label className="field-label" htmlFor="lyrics-model">Lyric transcription</label>
        <select id="lyrics-model" value={config.lyrics} onChange={event => updateConfig({ lyrics: event.target.value as DecompositionDraft['lyrics'] })}>
          <option value="none">Off</option><option value="tiny">Whisper tiny</option><option value="base">Whisper base</option>
        </select>
        <label className="check-field"><input type="checkbox" checked={config.wordTimestamps} onChange={event => updateConfig({ wordTimestamps: event.target.checked })} />Word-level timing estimates</label>
        <label className="check-field"><input type="checkbox" checked={config.notes} onChange={event => updateConfig({ notes: event.target.checked })} />Basic Pitch notes / MIDI</label>
        <label className="check-field"><input type="checkbox" checked={config.captions} onChange={event => updateConfig({ captions: event.target.checked })} />Qwen2-Audio descriptions</label>
      </div>
      <div className="action-area">
        <button className="model-summary" onClick={openModels}><span>Local / {config.captions ? 'Qwen2-Audio' : config.stems.length ? 'HTDemucs' : config.lyrics !== 'none' ? `Whisper ${config.lyrics}` : 'DSP (no ML model)'}</span><Settings2 size={14} /></button>
        <button className="primary full" disabled={!api || busy || !asset || reviewDirty} onClick={() => { selectStep('generate'); void action(analyze) }}>Analyse selected excerpt <ArrowRight size={16} /></button>
        <p className="action-note">Selected missing models fail explicitly. Nothing downloads when analysis starts.</p>
        <button className="text-button" onClick={openModels}>Runtime & model readiness</button>
        {runtime && !runtime.profiles[0]?.ready && <p className="fine-print">Core runtime is not ready. Install it in Model Settings.</p>}
      </div>
      <div className="library-launcher"><button className="text-button" disabled={reviewDirty} onClick={() => setShowLibrary(true)}>Analysis library <span className="count">{library.jobs.filter(item => item.state === 'completed').length}</span></button>
        <span className="saved-state">{storageError ? 'Draft in memory only' : 'Draft saved on this device'}</span></div>
    </aside>
    <main className="workflow-main">
      <nav className="process-stepper" aria-label="Decomposer workflow"><ol>{steps.map((step, index) => <li key={step.id}>
        <button className={`process-step ${draft.step === step.id ? 'current' : ''}`} aria-current={draft.step === step.id ? 'step' : undefined} onClick={() => selectStep(step.id)}>
          <span className="step-number">{index + 1}</span><span className="step-copy"><strong>{step.id === 'brief' ? 'Import & plan' : step.id === 'generate' ? 'Analyse' : step.label}</strong><small>{draft.step === step.id ? 'Current step' : 'Navigate'}</small></span>
        </button></li>)}</ol></nav>
      <div className="canvas-heading"><div><p className="eyebrow">DECOMPOSER</p><h2>{asset ? asset.name : 'Hear how a song is put together'}</h2></div><span className="outline-badge">LOCAL / NO UPLOADS</span></div>
      {!api && <p className="error-banner" role="alert">Web preview: audio import, analysis and exports require the desktop application.</p>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      {notice && <p className="info-box" role="status">{notice}</p>}
      {reviewDirty && <p className="info-box">Unsaved corrections stay open across tabs and steps. Save or discard them in Review before changing analyses, exporting or sending a Music brief.</p>}
      {library.errors.map((message, index) => <p className="error-banner" role="alert" key={index}>{message}</p>)}
      {config.assetId && !asset && <p className="info-box">The selected source is not available in this library. Import it again; saved drafts are unchanged.</p>}
      {asset ? <AudioReview key={`${asset.id}-${job?.id ?? ''}`} asset={asset} job={job} start={config.start} end={Math.min(config.end, asset.duration)} visible={visible} />
        : <section className="sound-canvas"><div className="canvas-empty"><Layers3 size={48} /><h3>Start with a recording you can use.</h3><p>Import a song, select an excerpt, then choose local analysis stages.<br />No synthetic waveforms, inferred lyrics or pretend stems.</p><span className="placeholder-note">No reference audio imported.</span></div></section>}
      {job && <section className="job-card" aria-label="Analysis job">
        <div className="section-heading"><h3>{job.title || 'Untitled analysis'}</h3><strong>{job.state}</strong></div>
        <progress value={job.progress} max="1" aria-label="Analysis progress" /><p role="status">{job.stage}</p>
        <p className="fine-print">Run: {job.options.start}-{job.options.end} sec; stems {job.options.stems.join(', ') || 'off'}; lyrics {job.options.lyrics}; MIDI {job.options.notes ? 'on' : 'off'}; audio descriptions {job.options.captions ? 'on' : 'off'}. Current controls do not change this saved run.</p>
        {running && <button className="secondary-button" onClick={() => { void action(async () => { await api?.cancel(job.id); setLibrary(await api!.library()) }) }}>Cancel analysis</button>}
        {job.error && <p className="error-banner" role="alert">{job.error}</p>}
        {job.raw?.warnings.map((warning, index) => <p className="fine-print" key={index}>{warning}</p>)}
      </section>}
      {job?.state === 'completed' && <div hidden={draft.step !== 'review'}><ReviewEditor key={job.id} job={job} onDirty={setReviewDirty} onSave={async reviewed => {
        const updated = await api!.review({ id: job.id, revision: job.revision, reviewed })
        setLibrary(current => ({ ...current, jobs: current.jobs.map(item => item.id === job.id ? updated : item) }))
      }} /></div>}
      {draft.step === 'review' && job?.state !== 'completed' && <p className="info-box">Complete an analysis to review actual findings. DSP cannot transcribe lyrics or describe instruments.</p>}
      {draft.step === 'export' && <section className="job-card">
        <h3>Export available results</h3><p className="panel-intro">Every export creates a new folder and includes source hash, options, raw results, corrections and model provenance. Lyric timestamps use original-source time; stems and MIDI start at excerpt zero.</p>
        <div className="export-actions">{(['all', 'json', 'markdown', 'lrc', 'srt', 'stems', 'midi'] as ExportKind[]).map(kind => <button className="secondary-button" key={kind} disabled={busy || reviewDirty || job?.state !== 'completed' || (['lrc', 'srt'].includes(kind) && !job.reviewed?.lyrics.length) || (kind === 'stems' && !job.raw?.stems.length) || (kind === 'midi' && !job.raw?.midi)} onClick={() => {
          void action(async () => { const name = await api!.export({ id: job!.id, kind }); if (name) setNotice(`Exported to new folder ${name}.`) })
        }}>{kind === 'all' ? 'Export all available' : kind.toUpperCase()}</button>)}</div>
        <button className="primary" disabled={reviewDirty} onClick={handoff}>{job?.state === 'completed' ? 'Send saved reviewed brief to Music' : 'Send unanalysed intent to Music'}</button>
      </section>}
      {draft.step === 'brief' && <section className="inspiration"><div className="section-heading"><h3>Text-only analysis goals</h3><span>NOT INFERRED RESULTS</span></div><div className="example-grid">
        {examples.decomposer.map(example => <button className="example-card" key={example.title} onClick={() => updateDraft({ prompt: example.prompt, category: example.category })}><span><small>{example.detail}</small><strong>{example.title}</strong></span></button>)}
      </div></section>}
      {job?.state === 'completed' && draft.step !== 'review' && <button className="secondary-button review-launch" onClick={() => selectStep('review')}>Review actual results <ArrowRight size={16} /></button>}
    </main>
    {showLibrary && <Dialog title="Analysis library" eyebrow="LOCAL RECORDINGS & RESULTS" drawer onClose={() => setShowLibrary(false)}>
      <p className="dialog-intro">Originals are copied, not moved. Reopening does not rerun inference. Failed and interrupted jobs remain visible.</p>
      {!library.assets.length && <p>No imported recordings.</p>}
      {library.assets.map(item => <div className="model-card" key={item.id}><h3>{item.name}</h3><p>{formatTime(item.duration)} / {item.hash.slice(0, 16)}...</p>
        <button className="secondary-button" onClick={() => { updateConfig({ assetId: item.id, analysisId: null, start: 0, end: Math.min(item.duration, defaultOptions.end) }); setShowLibrary(false) }}>Open reference</button>
        {library.jobs.filter(job => job.assetId === item.id).map(saved => <button className="library-job" key={saved.id} onClick={() => { updateConfig({ ...saved.options, assetId: item.id, analysisId: saved.id }); selectStep('review'); setShowLibrary(false) }}>{saved.title || 'Analysis'} / {saved.state} / {new Date(saved.createdAt).toLocaleString()}</button>)}
      </div>)}
    </Dialog>}
  </>
}
