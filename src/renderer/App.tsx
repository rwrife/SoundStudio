import { Fragment, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowDownToLine, ArrowRight, AudioLines, Check, ChevronRight, CircleHelp,
  Clock3, FileText, FolderOpen, Headphones, Info, Layers3, Library, ListMusic,
  Music2, Play, Radio, Settings2, ShieldCheck, SkipBack, SlidersHorizontal,
  Sparkles, Volume2, WandSparkles, Waves, Zap
} from 'lucide-react'
import { version } from '../../package.json'
import {
  buildVariationBrief, decomposerFocuses, effectCategories, examples, musicGenres,
  musicMoods, steps, workspaces, type Draft, type Step, type Workspace
} from '../shared/workspace'
import { Dialog } from './Dialog'
import { useStudioState } from './useStudioState'

type Surface = 'models' | 'connections' | 'library' | 'help' | null

export function App() {
  const { state, setState, storageError } = useStudioState()
  const [surface, setSurface] = useState<Surface>(null)
  const [modelWorkspace, setModelWorkspace] = useState<Workspace>('effects')
  const [notice, setNotice] = useState('')
  const mainRef = useRef<HTMLElement>(null)
  const { workspace } = state
  const draft = state.drafts[workspace]
  const isMusic = workspace === 'music'
  const isDecomposer = workspace === 'decomposer'

  function updateDraft(patch: Partial<Draft>) {
    setState(current => ({ ...current, drafts: { ...current.drafts, [current.workspace]: { ...current.drafts[current.workspace], ...patch } } }))
  }

  function selectStep(step: Step) {
    updateDraft({ step })
    mainRef.current?.scrollTo({ top: 0 })
  }

  function selectWorkspace(next: Workspace) {
    setState(current => ({ ...current, workspace: next }))
    setNotice('')
  }

  function sendBriefToMusic() {
    const variation = buildVariationBrief(state.drafts.decomposer)
    setState(current => ({
      ...current,
      workspace: 'music',
      drafts: {
        ...current.drafts,
        music: {
          ...current.drafts.music,
          ...variation,
          step: 'brief'
        }
      }
    }))
    setNotice('Decomposer brief transferred to the Music workspace. No audio was generated.')
  }

  function navigateTabs(event: KeyboardEvent<HTMLElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = workspaces.findIndex(item => item.id === workspace)
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? workspaces.length - 1
      : event.key === 'ArrowRight' ? (currentIndex + 1) % workspaces.length
      : (currentIndex - 1 + workspaces.length) % workspaces.length
    const next = workspaces[nextIndex].id
    selectWorkspace(next)
    document.getElementById(`${next}-tab`)?.focus()
  }

  function openModels() {
    setModelWorkspace(workspace)
    setSurface('models')
  }

  const stepIndex = steps.findIndex(step => step.id === draft.step)
  const stepLabel = isDecomposer && draft.step === 'generate' ? 'Decompose' : steps[stepIndex].label
  const stepDescription = {
    brief: isDecomposer ? 'Listen closely. Map every layer.' : isMusic ? 'Set the mood. Find the melody.' : 'Small sounds. Big worlds.',
    generate: isDecomposer ? 'Your breakdown plan, ready for a reference track.' : 'Your idea, ready for a first take.',
    review: isDecomposer ? 'A place to inspect stems, timing and lyrics.' : 'A little space to listen closely.',
    export: isDecomposer ? 'From song analysis to your next variation.' : 'From your studio to your project.'
  }[draft.step]

  return <div className="app">
    <header className="topbar">
      <a className="brand" href="#workspace" aria-label="Sound Studio workspace">
        <img src="./icon.svg" alt="" width="38" height="38" />
        <span>sound <strong>studio</strong><small>LOCAL SOUND. LIMITLESS IDEAS.</small></span>
      </a>
      <nav className="workspace-tabs" role="tablist" aria-label="Sound workspace" onKeyDown={navigateTabs}>
        {workspaces.map((tab, index) => <Fragment key={tab.id}>
          {index > 0 && <span className="workspace-tab-divider" aria-hidden="true">|</span>}
          <button id={`${tab.id}-tab`} role="tab"
            className={workspace === tab.id ? 'active' : ''} aria-selected={workspace === tab.id}
            aria-controls={`${tab.id}-panel`} tabIndex={workspace === tab.id ? 0 : -1} onClick={() => selectWorkspace(tab.id)}>
            {tab.label}
          </button>
        </Fragment>)}
      </nav>
      <div className="topbar-actions">
        <button className="subtle-button" onClick={openModels} aria-haspopup="dialog"><SlidersHorizontal size={15} /> Model Settings</button>
        <button className="backend-button" onClick={() => setSurface('connections')} aria-haspopup="dialog"><span className="status-dot" /> Backend not connected <ChevronRight size={13} /></button>
        <button className="icon-button" aria-label="Quick guide" onClick={() => setSurface('help')} aria-haspopup="dialog"><CircleHelp size={18} /></button>
      </div>
    </header>

    {storageError && <div className="error-banner" role="alert">{storageError} Drafts are currently kept in memory only.</div>}

    <div id="workspace" className="workspace-host">
      {workspaces.map(tab => <div key={tab.id} id={`${tab.id}-panel`} role="tabpanel"
        aria-labelledby={`${tab.id}-tab`} hidden={workspace !== tab.id} className="workspace-layout">
        {workspace === tab.id && <>
          <aside className="settings-panel" aria-label={`${tab.label} step settings`}>
            <div className="step-kicker"><span className="eyebrow">0{stepIndex + 1} / {stepLabel}</span><span className="mini-badge">PREVIEW</span></div>
            <h1>{draft.step === 'brief' ? isDecomposer ? 'Music decomposer' : isMusic ? 'Music studio' : 'Sound effects' : stepLabel}</h1>
            <p className="panel-intro">{stepDescription}</p>

            {draft.step === 'brief' ? <>
              <div className="input-mode">{isDecomposer ? <Layers3 size={15} /> : <WandSparkles size={15} />}<span>{isDecomposer ? 'Audio to musical brief' : `Text to ${isMusic ? 'music' : 'sound'}`}</span><span className="mode-label">DRAFT</span></div>
              <label className="field-label" htmlFor="draft-title">{isDecomposer ? 'Analysis name' : 'Take name'} <span>optional</span></label>
              <input id="draft-title" maxLength={120} value={draft.title} placeholder={isDecomposer ? 'A reference worth studying' : isMusic ? 'An untold story' : 'An undiscovered sound'} onChange={event => updateDraft({ title: event.target.value })} />

              <label className="field-label" htmlFor="prompt">{isDecomposer ? 'Describe your analysis goal' : isMusic ? 'Describe your music' : 'Describe your sound'} <span>{draft.prompt.length}/4000</span></label>
              <textarea id="prompt" maxLength={4000} value={draft.prompt} placeholder={isDecomposer
                ? 'What should the breakdown capture? Note instruments, structure, groove, chords or vocal lines to study for variations...'
                : isMusic
                  ? 'A feeling, an instrument, a world to get lost in...'
                  : 'What do you hear? Describe the source, setting, texture and feeling...'} onChange={event => updateDraft({ prompt: event.target.value })} />
              <p className="field-hint">{isDecomposer ? 'Outline what to preserve, transcribe or reimagine when local audio import arrives.' : 'The more you imagine, the more there is to work with.'}</p>

              <label className="field-label" htmlFor="category">{isDecomposer ? 'Analysis focus' : isMusic ? 'Genre' : 'Sound category'}</label>
              <select id="category" value={draft.category} onChange={event => updateDraft({ category: event.target.value })}>
                {(isDecomposer ? decomposerFocuses : isMusic ? musicGenres : effectCategories).map(category => <option key={category}>{category}</option>)}
              </select>

              {(isMusic || isDecomposer) && <><label className="field-label" htmlFor="mood">{isDecomposer ? 'Character & mood' : 'Mood'}</label>
                <select id="mood" value={draft.mood} onChange={event => updateDraft({ mood: event.target.value })}>{musicMoods.map(mood => <option key={mood}>{mood}</option>)}</select></>}

              <div className="field-row">
                <div><label className="field-label" htmlFor="duration">{isDecomposer ? 'Excerpt window' : 'Duration'} <span>sec</span></label>
                  <input id="duration" type="number" min="1" max={isMusic || isDecomposer ? '180' : '30'} value={draft.duration} onChange={event => updateDraft({ duration: event.target.value })} /></div>
                {isMusic || isDecomposer ? <div><label className="field-label" htmlFor="tempo">{isDecomposer ? 'Reference tempo' : 'Tempo'} <span>BPM</span></label>
                  <input id="tempo" type="number" min="40" max="240" value={draft.tempo} onChange={event => updateDraft({ tempo: event.target.value })} /></div>
                  : <div><label className="field-label" htmlFor="seed">Seed <span>optional</span></label>
                    <input id="seed" type="number" min="0" step="1" value={draft.seed} placeholder="Random" onChange={event => updateDraft({ seed: event.target.value })} /></div>}
              </div>
              {isDecomposer ? <div className="field-row">
                <label className="check-field"><input type="checkbox" checked={draft.loop}
                  onChange={event => updateDraft({ loop: event.target.checked })} />
                  <span>Separate stems<small>Vocals, drums & bass</small></span>
                </label>
                <label className="check-field"><input type="checkbox" checked={!draft.instrumental}
                  onChange={event => updateDraft({ instrumental: !event.target.checked })} />
                  <span>Transcribe lyrics<small>Sung words & timing</small></span>
                </label>
              </div> : <label className="check-field"><input type="checkbox" checked={isMusic ? draft.instrumental : draft.loop}
                onChange={event => updateDraft(isMusic ? { instrumental: event.target.checked } : { loop: event.target.checked })} />
                <span>{isMusic ? 'Instrumental only' : 'Seamless loop'}<small>{isMusic ? 'Let the instruments do the talking' : 'Designed to play on repeat'}</small></span>
              </label>}
              <p className="fine-print">{isDecomposer ? 'Draft analysis plan only. Reference audio import and local decomposition models are not connected yet.' : 'Draft options only. Model-specific limits will be added with generation.'}</p>
            </> : draft.step === 'generate' ? <>
              <div className="summary-card"><span className="eyebrow">{isDecomposer ? 'YOUR ANALYSIS PLAN' : 'YOUR BRIEF'}</span><h3>{draft.title || (isDecomposer ? 'Untitled breakdown' : 'Untitled take')}</h3>
                <p>{draft.prompt || 'No description yet. Head back to Describe to shape your idea.'}</p>
                <div className="summary-tags"><span>{draft.category}</span><span>{draft.duration || '--'} sec</span>{isDecomposer && <span>{draft.loop ? '4 stems' : 'Full mix'}</span>}{isDecomposer && <span>{draft.instrumental ? 'No lyrics' : 'With lyrics'}</span>}</div>
              </div>
              {isDecomposer && <div className="pipeline-list" aria-label="Planned analysis stages">
                <div className="pipeline-item"><Layers3 size={15} /><div><strong>Stem separation</strong><small>{draft.loop ? 'Vocals, drums, bass & accompaniment' : 'Skipped (full-mix analysis only)'}</small></div></div>
                <div className="pipeline-item"><ListMusic size={15} /><div><strong>Timing & harmony</strong><small>Target {draft.tempo || '--'} BPM, key, chords & section grid</small></div></div>
                <div className="pipeline-item"><FileText size={15} /><div><strong>Lyric transcription</strong><small>{draft.instrumental ? 'Disabled (instrumental track)' : 'Sung words & line timestamps'}</small></div></div>
              </div>}
              <button className="text-button" onClick={() => selectStep('brief')}>Edit your {isDecomposer ? 'analysis plan' : 'brief'} <ArrowRight size={14} /></button>
              <div className="info-box"><Info size={17} /><p>{isDecomposer ? 'Local audio decomposition is not connected in this shell. No files are imported and no analysis models are installed.' : 'Local generation is not connected in this shell. No models are installed and no prompts are sent.'}</p></div>
            </> : <>
              <div className="summary-card">
                {draft.step === 'review' ? <Headphones size={24} /> : <ArrowDownToLine size={24} />}
                <h3>{draft.step === 'review' ? isDecomposer ? 'Every layer in focus' : 'Every detail matters' : isDecomposer ? 'Ready for your next variation' : 'Ready when your sound is'}</h3>
                <p>{draft.step === 'review'
                  ? isDecomposer
                    ? 'Inspect separated stems, timed musical descriptions, chord estimates and lyric transcripts here once decomposition is available.'
                    : 'Audition takes, compare variations and refine your sound here once generation is available.'
                  : isDecomposer
                    ? 'Export structured musical briefs, isolated stems or MIDI once song analysis is available, or send your draft analysis plan directly to the Music workspace.'
                    : 'Output formats and export controls will appear here when real audio is available.'}</p>
              </div>
              {isDecomposer && draft.step === 'review' && <div className="pipeline-list" aria-label="Breakdown review layers">
                <div className="pipeline-item"><Waves size={15} /><div><strong>Isolated stems</strong><small>No separated audio stems loaded</small></div></div>
                <div className="pipeline-item"><Music2 size={15} /><div><strong>Musical brief & chords</strong><small>Awaiting local caption & harmony pass</small></div></div>
                <div className="pipeline-item"><FileText size={15} /><div><strong>Lyric transcript</strong><small>{draft.instrumental ? 'Marked instrumental' : 'No vocal transcript aligned yet'}</small></div></div>
              </div>}
              {isDecomposer && draft.step === 'export' && <button className="secondary-button full" onClick={sendBriefToMusic}><Music2 size={15} /> Send brief to Music workspace <ArrowRight size={14} /></button>}
              <div className="info-box"><Info size={17} /><p>{draft.step === 'review' ? isDecomposer ? 'There are no decomposed tracks or transcripts to review yet.' : 'There are no generated takes to review yet.' : isDecomposer ? 'No song has been analyzed. Audio stem and MIDI export are not available.' : 'No audio file has been created. Export is not available.'}</p></div>
            </>}

            <div className="action-area">
              <button className="model-summary" onClick={openModels} aria-haspopup="dialog"><span><span className="status-dot" /> Local / No model selected</span><Settings2 size={14} /></button>
              {draft.step === 'brief' ? <button className="primary full" onClick={() => selectStep('generate')}>{isDecomposer ? 'Continue to decomposition' : 'Continue to generation'} <ArrowRight size={16} /></button>
                : <button className="primary full" disabled aria-describedby="unavailable-reason">
                  {draft.step === 'generate' ? <Sparkles size={16} /> : draft.step === 'review' ? <Play size={16} /> : <ArrowDownToLine size={16} />}
                  {draft.step === 'generate' ? isDecomposer ? 'Decompose track' : `Generate ${isMusic ? 'music' : 'sound'}` : draft.step === 'review' ? isDecomposer ? 'Play reference' : 'Play take' : isDecomposer ? 'Export breakdown' : 'Export audio'}
                </button>}
              <p id="unavailable-reason" className="action-note">{draft.step === 'brief' ? isDecomposer ? 'Save the analysis plan. Audio import comes next.' : 'Save the idea. The sound comes next.' : 'Coming soon - not available in this shell.'}</p>
            </div>
            <div className="library-launcher"><button className="text-button" onClick={() => setSurface('library')} aria-haspopup="dialog"><Library size={16} /> Sound library <span className="count">0</span><ChevronRight size={14} /></button>
              <span className="saved-state"><Check size={12} /> {storageError ? 'Draft in memory only' : 'Draft saved on this device'}</span>
            </div>
          </aside>

          <main className="workflow-main" ref={mainRef}>
            <nav className="process-stepper" aria-label={`${tab.label} workflow`}>
              <ol>{steps.map((step, index) => {
                const label = isDecomposer && step.id === 'generate' ? 'Decompose' : step.label
                return <li key={step.id}>
                  <button className={`process-step ${draft.step === step.id ? 'current' : ''}`} aria-current={draft.step === step.id ? 'step' : undefined}
                    onClick={() => selectStep(step.id)}>
                    <span className="step-number">{index + 1}</span><span className="step-copy"><strong>{label}</strong><small>{draft.step === step.id ? 'Current step' : step.id === 'brief' ? isDecomposer ? 'Plan your breakdown' : 'Draft your idea' : 'Coming soon'}</small></span>
                  </button>
                </li>
              })}</ol>
            </nav>

            <div className="canvas-heading"><div><p className="eyebrow">{isDecomposer ? 'DECOMPOSER' : isMusic ? 'MUSIC' : 'SOUND'} CANVAS</p>
              <h2>{draft.step === 'brief' ? isDecomposer ? 'A song waiting to be understood' : 'An idea waiting to be heard' : draft.step === 'generate' ? isDecomposer ? 'Prepare your reference breakdown' : 'Make room for your next idea' : draft.step === 'review' ? isDecomposer ? 'Inspect stems, notes and lyrics' : 'Find the take that feels right' : isDecomposer ? 'Carry the structure into a new variation' : 'Your sound, beyond the studio'}</h2></div>
              <span className="outline-badge"><span className="status-dot" /> {draft.step === 'brief' ? 'Draft workspace' : 'Shell preview'}</span>
            </div>

            <section className="sound-canvas" aria-label="Audio preview">
              <div className="canvas-toolbar"><span><AudioLines size={14} /> {isDecomposer ? 'STEM & LYRIC MAP' : isMusic ? 'MUSIC PREVIEW' : 'WAVEFORM'}</span><span>NO AUDIO LOADED</span></div>
              <div className="canvas-empty">
                <div className="sound-illustration" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="wave-mark"><AudioLines size={52} strokeWidth={1.2} /></div><span className="orbit-point point-one" /><span className="orbit-point point-two" /></div>
                <span className="eyebrow canvas-eyebrow">{isDecomposer ? 'EVERY LAYER TELLS PART OF THE STORY.' : 'A LITTLE QUIET. A LOT OF POSSIBILITY.'}</span>
                <h3>{isDecomposer ? 'Hear how a song is put together.' : isMusic ? 'Every world deserves a soundtrack.' : 'Make something worth hearing.'}</h3>
                <p>{isDecomposer ? 'Separate stems, map tempo and harmony, transcribe lyrics and build a detailed variation brief.' : isMusic ? 'Set a mood, sketch a melody, imagine the atmosphere.' : 'A forest at dawn. A distant galaxy. The perfect little click.'}<br />Your next {isDecomposer ? 'breakdown' : isMusic ? 'track' : 'sound'} starts with a few words.</p>
                <span className="placeholder-note"><Info size={13} /> {draft.step === 'brief' ? isDecomposer ? 'Start with an analysis plan. Audio import and local decomposition are coming soon.' : 'Start with a brief. Local generation is coming soon.' : isDecomposer ? 'Placeholder workspace - no reference audio has been analyzed.' : 'Placeholder workspace - no audio has been generated.'}</span>
              </div>
              <div className="transport"><div className="transport-controls">
                <button className="icon-button" disabled aria-label="Return to start"><SkipBack size={16} /></button>
                <button className="play-button" disabled aria-label="Play audio"><Play size={16} fill="currentColor" /></button>
                <span className="timecode">00:00 <span>/ --:--</span></span></div>
                <div className="transport-track" aria-hidden="true"><span /></div>
                <span className="transport-format">{isDecomposer ? 'NO TRACK SELECTED' : 'NO TAKE SELECTED'}</span><Volume2 size={16} className="muted" aria-hidden="true" />
              </div>
            </section>

            <section className="inspiration" aria-labelledby={`${tab.id}-inspiration`}>
              <div className="section-heading"><h3 id={`${tab.id}-inspiration`}><Sparkles size={14} /> A starting point, if you need one</h3><span>{isDecomposer ? 'LOAD A SAMPLE BREAKDOWN' : 'LOAD A SAMPLE BRIEF'}</span></div>
              <div className="example-grid">{examples[workspace].map((example, index) => {
                const Icon = isDecomposer ? [Layers3, ListMusic, FileText][index] : isMusic ? [Music2, ListMusic, Waves][index] : [Waves, Zap, Radio][index]
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
              <div className="section-heading"><h3>{isDecomposer ? 'Recent breakdowns' : 'Recent takes'} <span className="count">0</span></h3><button className="text-button" onClick={() => setSurface('library')}>Open library <ArrowRight size={13} /></button></div>
              <div className="empty-takes"><Layers3 size={19} /><span>{isDecomposer ? 'No breakdowns yet. Your decomposed stems, lyric transcripts and musical briefs will find a home here.' : `No takes yet. Your generated ${isMusic ? 'music' : 'sounds'} will find a home here.`}</span><span className="local-tag"><ShieldCheck size={12} /> ONLY ON YOUR DEVICE</span></div>
            </section>
          </main>
        </>}
      </div>)}
    </div>

    <footer className="statusbar"><span><ShieldCheck size={13} /> LOCAL FIRST <span className="footer-divider">/</span><span>No cloud. No uploads.</span></span><span className="footer-flow">Describe <ChevronRight size={10} /> {isDecomposer ? 'Decompose' : 'Generate'} <ChevronRight size={10} /> Refine <ChevronRight size={10} /> Export</span><span><span className="status-dot blue" /> SHELL PREVIEW <span className="footer-divider">/</span> v{version}</span></footer>

    {surface === 'models' && <Dialog title="Model Settings" eyebrow="YOUR LOCAL ENGINE" drawer onClose={() => setSurface(null)}>
      <p className="dialog-intro">The space for the models behind your sound. Nothing is downloaded or connected in this preview.</p>
      <div className="segmented" aria-label="Model workspace">{workspaces.map(tab => <button key={tab.id} aria-pressed={modelWorkspace === tab.id} onClick={() => setModelWorkspace(tab.id)}>{tab.label}</button>)}</div>
      <div className="model-card"><div className="model-card-icon">{modelWorkspace === 'effects' ? <AudioLines size={24} /> : modelWorkspace === 'music' ? <Music2 size={24} /> : <Layers3 size={24} />}</div><span className="outline-badge">NOT CONFIGURED</span>
        <h3>{modelWorkspace === 'effects' ? 'Local sound generation' : modelWorkspace === 'music' ? 'Local music generation' : 'Local music decomposition'}</h3><p>A dedicated {modelWorkspace === 'decomposer' ? 'analysis pipeline for stem separation, tempo and harmony estimation, detailed musical captioning and lyric transcription. Model selection and installation will arrive with the analysis backend.' : `model for ${modelWorkspace === 'effects' ? 'sound effects, foley and ambience' : 'instrumental tracks and musical ideas'}. Model selection and installation will arrive with the generation backend.`}</p>
        <dl><div><dt>Execution</dt><dd>Local only (planned)</dd></div><div><dt>Selected model</dt><dd>None</dd></div><div><dt>Hardware readiness</dt><dd>Not checked</dd></div></dl>
      </div>
      <div className="info-box"><ShieldCheck size={19} /><p>Your drafts stay on this device. This shell does not install models, contact inference services or upload your prompts.</p></div>
      <div className="planned-section"><h3>Room for what's next</h3><p>Hardware-aware model profiles, explicit downloads and model-specific generation and analysis controls. These are planned capabilities, not active settings.</p></div>
    </Dialog>}

    {surface === 'connections' && <Dialog title="Backend connections" eyebrow="LOCAL INFRASTRUCTURE" onClose={() => setSurface(null)}>
      <div className="connection-state"><span className="connection-icon"><Radio size={25} /></span><div><h3>No backend connected</h3><p>This is the application shell, not a running generation or analysis service.</p></div></div>
      <div className="info-box"><Info size={18} /><p>Backend connection, model installation and hardware checks are not implemented yet. There is no endpoint to configure or service to start.</p></div>
      <div className="connection-row"><span>Prompt drafts</span><span className="blue-text">{storageError ? 'In memory only' : 'Saved locally'}</span></div>
      <div className="connection-row"><span>Audio generation & decomposition</span><span>Not available</span></div>
      <div className="connection-row"><span>Network requests for inference</span><span>None</span></div>
    </Dialog>}

    {surface === 'library' && <Dialog title="Sound library" eyebrow="YOUR COLLECTION" drawer onClose={() => setSurface(null)}>
      <p className="dialog-intro">A place for your effects, music, breakdowns and happy accidents.</p>
      <div className="library-empty"><FolderOpen size={42} strokeWidth={1} /><h3>Good things start with a blank slate.</h3><p>No audio assets yet. A searchable library will arrive with generation, decomposition and import support.</p><span className="outline-badge">0 EFFECTS / 0 MUSIC / 0 BREAKDOWNS</span></div>
      <div className="info-box"><Info size={17} /><p>Your current drafts live in the Effects, Music and Decomposer workspaces. They are not generated audio, analyzed stems or library assets.</p></div>
    </Dialog>}

    {surface === 'help' && <Dialog title="A small guide to the studio" eyebrow="WELCOME TO SOUND STUDIO" onClose={() => setSurface(null)}>
      <p className="dialog-intro">Three workspaces. One place to find and understand your sound.</p>
      <div className="guide-item"><AudioLines size={20} /><div><h3>Effects for the little details</h3><p>Describe ambience, foley, interface sounds or something entirely new. Choose a category and sketch your timing.</p></div></div>
      <div className="guide-item"><Music2 size={20} /><div><h3>Music for the bigger picture</h3><p>Set a genre, mood and tempo. Give your future soundtrack a direction.</p></div></div>
      <div className="guide-item"><Layers3 size={20} /><div><h3>Decomposer for studying existing music</h3><p>Plan stem separation, harmonic and tempo analysis, detailed musical descriptions and lyric transcription to guide future variations.</p></div></div>
      <div className="guide-item"><Clock3 size={20} /><div><h3>Your ideas stay with you</h3><p>Drafts are saved on this device as you edit. Switching tabs or opening settings does not discard them.</p></div></div>
      <div className="info-box"><Info size={17} /><p>This early shell supports drafts and navigation only. Generation, decomposition, playback, imports, exports and model setup are coming later.</p></div>
    </Dialog>}
  </div>
}
