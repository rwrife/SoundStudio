import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, AudioLines, Pause, Play, SkipBack } from 'lucide-react'
import { describeAudio, formatTime, type AudioInfo } from '../shared/audio'
import { takeDisplayTitle, type TakeRecord } from '../shared/generation'

const barCount = 120

type Loaded = { url: string; info: AudioInfo; peaks: number[] | null; silent: boolean; decodeError: string }

/** Plays a stored take. The waveform and silence check come from decoding the actual file. */
export function TakePlayer({ take }: { take: TakeRecord }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState<number | null>(take.audio.durationSeconds)

  useEffect(() => {
    let cancelled = false
    let url = ''
    setLoaded(null); setError(''); setPlaying(false); setTime(0); setDuration(take.audio.durationSeconds)
    void (async () => {
      const result = await window.soundStudio?.readTakeAudio(take.id)
      if (cancelled || !result) return
      if (!result.ok) { setError(result.error); return }
      const { bytes, mimeType, info } = result.value
      url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType }))
      let peaks: number[] | null = null
      let silent = false
      let decodeError = ''
      try {
        const context = new OfflineAudioContext(1, 1, 44100)
        const buffer = await context.decodeAudioData(bytes.slice().buffer as ArrayBuffer)
        const samples = buffer.getChannelData(0)
        const size = Math.max(1, Math.floor(samples.length / barCount))
        let loudest = 0
        peaks = Array.from({ length: barCount }, (_, bar) => {
          let peak = 0
          for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
            const data = buffer.getChannelData(channel)
            for (let index = bar * size; index < Math.min(data.length, (bar + 1) * size); index += 1) peak = Math.max(peak, Math.abs(data[index]))
          }
          loudest = Math.max(loudest, peak)
          return peak
        })
        silent = loudest < 0.0005
        if (loudest > 0) peaks = peaks.map(peak => peak / loudest)
        if (!info.durationSeconds) setDuration(buffer.duration)
      } catch (decode) {
        decodeError = `The waveform could not be drawn. ${decode instanceof Error ? decode.message : ''}`.trim()
      }
      if (cancelled) { URL.revokeObjectURL(url); return }
      setLoaded({ url, info, peaks, silent, decodeError })
    })()
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [take.id, take.audio.durationSeconds])

  async function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      try { await audio.play() } catch (play) { setError(`Playback failed. ${play instanceof Error ? play.message : ''}`) }
    } else audio.pause()
  }

  function restart() {
    if (audioRef.current) audioRef.current.currentTime = 0
    setTime(0)
  }

  const total = duration ?? 0
  const progress = total > 0 ? Math.min(1, time / total) : 0

  return <section className="sound-canvas" aria-label="Audio preview">
    <div className="canvas-toolbar"><span><AudioLines size={14} /> {take.workspace === 'music' ? 'MUSIC PREVIEW' : 'WAVEFORM'}</span>
      <span>{loaded ? describeAudio(loaded.info).toUpperCase() : error ? 'UNAVAILABLE' : 'LOADING'}</span></div>
    <div className="take-stage">
      <p className="eyebrow">SELECTED TAKE</p>
      <h3 className="take-title">{takeDisplayTitle(take)}</h3>
      <p className="take-meta">{take.model.workflowName ?? take.model.label} / seed {take.request.seed} / {new Date(take.createdAt).toLocaleString()}</p>
      {loaded?.peaks ? <div className="waveform" role="img" aria-label={`Waveform of ${takeDisplayTitle(take)}`}>
        {loaded.peaks.map((peak, index) => <span key={index} className={index / barCount < progress ? 'played' : ''} style={{ height: `${Math.max(2, peak * 100)}%` }} />)}
      </div> : <div className="waveform waveform-empty">{error || loaded?.decodeError || 'Loading audio...'}</div>}
      {loaded?.silent && <p className="warning-text" role="status"><AlertTriangle size={14} /> This take appears to be silent. Check the model and prompt in ComfyUI.</p>}
      {error && <p className="warning-text" role="alert"><AlertTriangle size={14} /> {error}</p>}
    </div>
    {loaded && <audio ref={audioRef} src={loaded.url} preload="auto" loop={take.request.loop}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
      onLoadedMetadata={event => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration) }}
      onError={() => setError('This audio format could not be played here. Export it to use it in another application.')} />}
    <div className="transport"><div className="transport-controls">
      <button className="icon-button" disabled={!loaded} aria-label="Return to start" onClick={restart}><SkipBack size={16} /></button>
      <button className="play-button" disabled={!loaded} aria-label={playing ? 'Pause take' : 'Play take'} onClick={() => void toggle()}>
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
      <span className="timecode">{formatTime(time)} <span>/ {formatTime(duration)}</span></span></div>
      <input className="seek" type="range" min={0} max={total || 1} step={0.01} value={Math.min(time, total || 1)} disabled={!loaded || !total}
        aria-label="Playback position" onChange={event => {
          const next = Number(event.target.value)
          if (audioRef.current) audioRef.current.currentTime = next
          setTime(next)
        }} />
      <span className="transport-format">{take.request.loop ? 'LOOP / ' : ''}{take.audio.format.toUpperCase()}</span>
    </div>
  </section>
}
