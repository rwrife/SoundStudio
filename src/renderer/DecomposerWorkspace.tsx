import type { RefObject } from 'react'
import {
  ArrowDownToLine, ArrowRight, AudioLines, Check, ChevronRight, FileText, Headphones, Info,
  Layers3, Library, ListMusic, Music2, Play, ShieldCheck, Sparkles, Waves
} from 'lucide-react'
import { decomposerFocuses, examples, musicMoods, steps, type Draft, type Step } from '../shared/workspace'

interface Props {
  draft: Draft
  label: string
  mainRef: RefObject<HTMLElement | null>
  notice: string
  libraryCount: number
  storageError: string
  onUpdate: (patch: Partial<Draft>) => void
  onStep: (step: Step) => void
  onNotice: (notice: string) => void
  onLibrary: () => void
  onSendToMusic: () => void
}

/** A planning placeholder. Audio import and analysis models are not connected, so nothing here reaches generation code. */
export function DecomposerWorkspace({ draft, label, mainRef, notice, libraryCount, storageError, onUpdate, onStep, onNotice, onLibrary, onSendToMusic }: Props) {
  const stepIndex = steps.findIndex(step => step.id === draft.step)
  const stepLabel = (step: Step) => step === 'generate' ? 'Decompose' : steps.find(item => item.id === step)!.label
  const stepDescription = {
    brief: 'Listen closely. Map every layer.',
    generate: 'Your breakdown plan, ready for a reference track.',
    review: 'A place to inspect stems, timing and lyrics.',
    export: 'From song analysis to your next variation.'
  }[draft.step]

  return <>
    <aside className="settings-panel" aria-label={`${label} step settings`}>
      <div className="step-kicker"><span className="eyebrow">0{stepIndex + 1} / {stepLabel(draft.step)}</span><span className="mini-badge">PLANNING</span></div>
      <h1>{draft.step === 'brief' ? 'Music decomposer' : stepLabel(draft.step)}</h1>
      <p className="panel-intro">{stepDescription}</p>

      {draft.step === 'brief' ? <>
        <div className="input-mode"><Layers3 size={15} /><span>Audio to musical brief</span><span className="mode-label">DRAFT</span></div>
        <label className="field-label" htmlFor="draft-title">Analysis name <span>optional</span></label>
        <input id="draft-title" maxLength={120} value={draft.title} placeholder="A reference worth studying" onChange={event => onUpdate({ title: event.target.value })} />

        <label className="field-label" htmlFor="prompt">Describe your analysis goal <span>{draft.prompt.length}/4000</span></label>
        <textarea id="prompt" maxLength={4000} value={draft.prompt}
          placeholder="What should the breakdown capture? Note instruments, structure, groove, chords or vocal lines to study for variations..."
          onChange={event => onUpdate({ prompt: event.target.value })} />
        <p className="field-hint">Outline what to preserve, transcribe or reimagine when local audio import arrives.</p>

        <label className="field-label" htmlFor="category">Analysis focus</label>
        <select id="category" value={draft.category} onChange={event => onUpdate({ category: event.target.value })}>
          {decomposerFocuses.map(focus => <option key={focus}>{focus}</option>)}
        </select>

        <label className="field-label" htmlFor="mood">Character & mood</label>
        <select id="mood" value={draft.mood} onChange={event => onUpdate({ mood: event.target.value })}>{musicMoods.map(mood => <option key={mood}>{mood}</option>)}</select>

        <div className="field-row">
          <div><label className="field-label" htmlFor="duration">Excerpt window <span>sec</span></label>
            <input id="duration" type="number" min="1" max="180" value={draft.duration} onChange={event => onUpdate({ duration: event.target.value })} /></div>
          <div><label className="field-label" htmlFor="tempo">Reference tempo <span>BPM</span></label>
            <input id="tempo" type="number" min="40" max="240" value={draft.tempo} onChange={event => onUpdate({ tempo: event.target.value })} /></div>
        </div>
        <div className="field-row">
          <label className="check-field"><input type="checkbox" checked={draft.loop} onChange={event => onUpdate({ loop: event.target.checked })} />
            <span>Separate stems<small>Vocals, drums & bass</small></span>
          </label>
          <label className="check-field"><input type="checkbox" checked={!draft.instrumental} onChange={event => onUpdate({ instrumental: !event.target.checked })} />
            <span>Transcribe lyrics<small>Sung words & timing</small></span>
          </label>
        </div>
        <p className="fine-print">Draft analysis plan only. Reference audio import and local decomposition models are not connected yet.</p>
      </> : draft.step === 'generate' ? <>
        <div className="summary-card"><span className="eyebrow">YOUR ANALYSIS PLAN</span><h3>{draft.title || 'Untitled breakdown'}</h3>
          <p>{draft.prompt || 'No description yet. Head back to Describe to shape your plan.'}</p>
          <div className="summary-tags"><span>{draft.category}</span><span>{draft.duration || '--'} sec</span><span>{draft.loop ? '4 stems' : 'Full mix'}</span><span>{draft.instrumental ? 'No lyrics' : 'With lyrics'}</span></div>
        </div>
        <div className="pipeline-list" aria-label="Planned analysis stages">
          <div className="pipeline-item"><Layers3 size={15} /><div><strong>Stem separation</strong><small>{draft.loop ? 'Vocals, drums, bass & accompaniment' : 'Skipped (full-mix analysis only)'}</small></div></div>
          <div className="pipeline-item"><ListMusic size={15} /><div><strong>Timing & harmony</strong><small>Target {draft.tempo || '--'} BPM, key, chords & section grid</small></div></div>
          <div className="pipeline-item"><FileText size={15} /><div><strong>Lyric transcription</strong><small>{draft.instrumental ? 'Disabled (instrumental track)' : 'Sung words & line timestamps'}</small></div></div>
        </div>
        <button className="text-button" onClick={() => onStep('brief')}>Edit your analysis plan <ArrowRight size={14} /></button>
        <div className="info-box"><Info size={17} /><p>Local audio decomposition is not connected. No files are imported and no analysis models are installed.</p></div>
      </> : <>
        <div className="summary-card">
          {draft.step === 'review' ? <Headphones size={24} /> : <ArrowDownToLine size={24} />}
          <h3>{draft.step === 'review' ? 'Every layer in focus' : 'Ready for your next variation'}</h3>
          <p>{draft.step === 'review'
            ? 'Inspect separated stems, timed musical descriptions, chord estimates and lyric transcripts here once decomposition is available.'
            : 'Export structured musical briefs, isolated stems or MIDI once song analysis is available, or send your draft analysis plan to the Music workspace now.'}</p>
        </div>
        {draft.step === 'review' && <div className="pipeline-list" aria-label="Breakdown review layers">
          <div className="pipeline-item"><Waves size={15} /><div><strong>Isolated stems</strong><small>No separated audio stems loaded</small></div></div>
          <div className="pipeline-item"><Music2 size={15} /><div><strong>Musical brief & chords</strong><small>Awaiting local caption & harmony pass</small></div></div>
          <div className="pipeline-item"><FileText size={15} /><div><strong>Lyric transcript</strong><small>{draft.instrumental ? 'Marked instrumental' : 'No vocal transcript aligned yet'}</small></div></div>
        </div>}
        {draft.step === 'export' && <button className="secondary-button full" onClick={onSendToMusic}><Music2 size={15} /> Send brief to Music workspace <ArrowRight size={14} /></button>}
        <div className="info-box"><Info size={17} /><p>{draft.step === 'review' ? 'There are no decomposed tracks or transcripts to review yet.' : 'No song has been analyzed. Stem and MIDI export are not available. Sending the brief to Music does not generate audio.'}</p></div>
      </>}

      <div className="action-area">
        <div className="model-summary static" role="note" aria-label="Analysis models: not connected"><span><span className="status-dot" /> Analysis models / Not connected</span></div>
        {draft.step === 'brief' ? <button className="primary full" onClick={() => onStep('generate')}>Continue to decomposition <ArrowRight size={16} /></button>
          : <button className="primary full" disabled aria-describedby="action-reason">
            {draft.step === 'generate' ? <Sparkles size={16} /> : draft.step === 'review' ? <Play size={16} /> : <ArrowDownToLine size={16} />}
            {draft.step === 'generate' ? 'Decompose track' : draft.step === 'review' ? 'Play reference' : 'Export breakdown'}
          </button>}
        <p id="action-reason" className="action-note">{draft.step === 'brief' ? 'Save the analysis plan. Audio import is not available yet.' : 'Not available yet. Audio import and local analysis models are not connected.'}</p>
      </div>
      <div className="library-launcher"><button className="text-button" onClick={onLibrary} aria-haspopup="dialog"><Library size={16} /> Sound library <span className="count">{libraryCount}</span><ChevronRight size={14} /></button>
        <span className="saved-state"><Check size={12} /> {storageError ? 'Draft in memory only' : 'Draft saved on this device'}</span>
      </div>
    </aside>

    <main className="workflow-main" ref={mainRef}>
      <nav className="process-stepper" aria-label={`${label} workflow`}>
        <ol>{steps.map((step, index) => <li key={step.id}>
          <button className={`process-step ${draft.step === step.id ? 'current' : ''}`} aria-current={draft.step === step.id ? 'step' : undefined} onClick={() => onStep(step.id)}>
            <span className="step-number">{index + 1}</span><span className="step-copy"><strong>{stepLabel(step.id)}</strong>
              <small>{draft.step === step.id ? 'Current step' : step.id === 'brief' ? (draft.prompt.trim() ? 'Plan drafted' : 'Plan your breakdown') : 'Not connected'}</small></span>
          </button>
        </li>)}</ol>
      </nav>

      <div className="canvas-heading"><div><p className="eyebrow">DECOMPOSER CANVAS</p>
        <h2>{draft.step === 'brief' ? 'A song waiting to be understood' : draft.step === 'generate' ? 'Prepare your reference breakdown' : draft.step === 'review' ? 'Inspect stems, notes and lyrics' : 'Carry the structure into a new variation'}</h2></div>
        <span className="outline-badge"><span className="status-dot" /> No audio imported</span>
      </div>

      <section className="sound-canvas" aria-label="Audio preview">
        <div className="canvas-toolbar"><span><AudioLines size={14} /> STEM & LYRIC MAP</span><span>NO AUDIO LOADED</span></div>
        <div className="canvas-empty">
          <div className="sound-illustration" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="wave-mark"><AudioLines size={52} strokeWidth={1.2} /></div><span className="orbit-point point-one" /><span className="orbit-point point-two" /></div>
          <span className="eyebrow canvas-eyebrow">EVERY LAYER TELLS PART OF THE STORY.</span>
          <h3>Hear how a song is put together.</h3>
          <p>Plan stem separation, tempo and harmony mapping, lyric transcription and a detailed variation brief.<br />Your next breakdown starts with a few words.</p>
          <span className="placeholder-note"><Info size={13} /> Planning only. Reference audio import and local decomposition are not available yet.</span>
        </div>
        <div className="transport"><div className="transport-controls">
          <button className="play-button" disabled aria-label="Play audio"><Play size={16} fill="currentColor" /></button>
          <span className="timecode">00:00 <span>/ --:--</span></span></div>
          <div className="transport-track" aria-hidden="true"><span /></div>
          <span className="transport-format">NO TRACK SELECTED</span>
        </div>
      </section>

      <section className="inspiration" aria-labelledby="decomposer-inspiration">
        <div className="section-heading"><h3 id="decomposer-inspiration"><Sparkles size={14} /> A starting point, if you need one</h3><span>LOAD A SAMPLE BREAKDOWN</span></div>
        <div className="example-grid">{examples.decomposer.map((example, index) => {
          const Icon = [Layers3, ListMusic, FileText][index]
          return <button className="example-card" key={example.title} onClick={() => {
            onUpdate({ prompt: example.prompt, category: example.category, step: 'brief' })
            onNotice(`"${example.title}" loaded into your analysis plan. No audio was analyzed.`)
          }}>
            <span className="example-icon"><Icon size={20} strokeWidth={1.5} /></span><span><small>{example.detail}</small><strong>{example.title}</strong></span><ArrowRight size={14} />
          </button>
        })}</div>
        <span className="sr-only" role="status">{notice}</span>
      </section>

      <section className="takes-section" aria-label="Recent breakdowns">
        <div className="section-heading"><h3>Recent breakdowns <span className="count">0</span></h3></div>
        <div className="empty-takes"><Layers3 size={19} /><span>No breakdowns yet. Decomposition is not connected, so nothing is analyzed or stored here.</span><span className="local-tag"><ShieldCheck size={12} /> STAYS ON YOUR DEVICE</span></div>
      </section>
    </main>
  </>
}
