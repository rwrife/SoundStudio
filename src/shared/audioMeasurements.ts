export interface AudioMeasurementRange {
  startFrame: number
  endFrame: number
}

export interface ChannelMeasurements {
  /** Maximum absolute sample in normalized linear amplitude, not true peak. */
  samplePeak: number
  /** Root mean square in normalized linear amplitude, not integrated loudness. */
  rms: number
  /** Mean signed sample in normalized linear amplitude. */
  dcOffset: number
  /** Samples exactly at -1 or +1; this alone does not establish clipping. */
  fullScaleSamples: number
  /** First sample minus last sample; this alone does not establish loop quality. */
  boundaryStep: number
}

export interface AudioMeasurements {
  algorithm: 'normalized-pcm-v1'
  sampleRate: number
  range: AudioMeasurementRange
  channels: ChannelMeasurements[]
}

/** Measures decoded PCM in [-1, 1]; endFrame is exclusive. No audio is modified. */
export function measureAudio(
  channels: readonly Float32Array[],
  sampleRate: number,
  range: AudioMeasurementRange
): AudioMeasurements {
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new Error('Sample rate must be a positive integer.')
  if (channels.length < 1 || channels.length > 8) throw new Error('Audio must have between one and eight channels.')
  const frames = channels[0].length
  if (channels.some((channel) => channel.length !== frames)) throw new Error('Audio channels must have equal frame counts.')
  const { startFrame, endFrame } = range
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || startFrame < 0 || endFrame > frames || startFrame >= endFrame) {
    throw new Error('Measurement range must contain audio frames within the source.')
  }

  const length = endFrame - startFrame
  const results = channels.map((channel) => {
    let sum = 0
    let squares = 0
    let samplePeak = 0
    let fullScaleSamples = 0
    for (let frame = startFrame; frame < endFrame; frame += 1) {
      const sample = channel[frame]
      if (!Number.isFinite(sample) || sample < -1 || sample > 1) throw new Error('Audio contains an invalid normalized PCM sample.')
      const magnitude = Math.abs(sample)
      samplePeak = Math.max(samplePeak, magnitude)
      if (magnitude === 1) fullScaleSamples += 1
      sum += sample
      squares += sample * sample
    }
    return {
      samplePeak,
      rms: Math.sqrt(squares / length),
      dcOffset: sum / length,
      fullScaleSamples,
      boundaryStep: channel[startFrame] - channel[endFrame - 1]
    }
  })

  return { algorithm: 'normalized-pcm-v1', sampleRate, range: { startFrame, endFrame }, channels: results }
}
