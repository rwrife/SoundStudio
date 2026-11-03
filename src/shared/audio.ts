export type AudioFormat = 'flac' | 'wav'

export interface AudioInfo {
  format: AudioFormat
  sampleRate: number
  channels: number
  bitsPerSample: number
  /** Null only when a FLAC stream does not declare its length; playback decoding measures it instead. */
  durationSeconds: number | null
  bytes: number
}

export const audioMimeTypes: Record<AudioFormat, string> = { flac: 'audio/flac', wav: 'audio/wav' }

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function checkStream(sampleRate: number, channels: number, bitsPerSample: number) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new Error(`Unsupported sample rate: ${sampleRate} Hz.`)
  if (!Number.isInteger(channels) || channels < 1 || channels > 8) throw new Error(`Unsupported channel count: ${channels}.`)
  if (!Number.isInteger(bitsPerSample) || bitsPerSample < 4 || bitsPerSample > 64) throw new Error(`Unsupported bit depth: ${bitsPerSample}.`)
}

function inspectFlac(bytes: Uint8Array): AudioInfo {
  if (bytes.length < 42) throw new Error('The FLAC file is truncated.')
  if ((bytes[4] & 0x7f) !== 0) throw new Error('The FLAC file does not start with stream information.')
  const blockLength = (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]
  if (blockLength < 34) throw new Error('The FLAC stream information is incomplete.')
  const b = bytes.subarray(18, 26)
  const sampleRate = (b[0] << 12) | (b[1] << 4) | (b[2] >> 4)
  const channels = ((b[2] >> 1) & 0x07) + 1
  const bitsPerSample = (((b[2] & 0x01) << 4) | (b[3] >> 4)) + 1
  const totalSamples = (b[3] & 0x0f) * 2 ** 32 + ((b[4] << 24) >>> 0) + (b[5] << 16) + (b[6] << 8) + b[7]
  checkStream(sampleRate, channels, bitsPerSample)

  let offset = 4
  let last = false
  while (!last) {
    if (offset + 4 > bytes.length) throw new Error('The FLAC metadata is truncated.')
    last = (bytes[offset] & 0x80) !== 0
    offset += 4 + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  }
  if (offset + 2 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xfe) !== 0xf8) {
    throw new Error('The FLAC file contains no audio frames.')
  }
  if (totalSamples === 0) return { format: 'flac', sampleRate, channels, bitsPerSample, durationSeconds: null, bytes: bytes.length }
  return { format: 'flac', sampleRate, channels, bitsPerSample, durationSeconds: totalSamples / sampleRate, bytes: bytes.length }
}

function inspectWav(bytes: Uint8Array): AudioInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 12
  let format: { channels: number; sampleRate: number; blockAlign: number; bitsPerSample: number } | undefined
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) throw new Error('The WAV format chunk is truncated.')
      const encoding = view.getUint16(body, true)
      if (![1, 3, 0xfffe].includes(encoding)) throw new Error(`Unsupported WAV encoding: ${encoding}.`)
      format = { channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), blockAlign: view.getUint16(body + 12, true), bitsPerSample: view.getUint16(body + 14, true) }
      checkStream(format.sampleRate, format.channels, format.bitsPerSample)
      if (format.blockAlign === 0) throw new Error('The WAV block alignment is invalid.')
    } else if (id === 'data') {
      if (!format) throw new Error('The WAV data appears before its format.')
      const available = Math.min(size, bytes.length - body)
      const frames = Math.floor(available / format.blockAlign)
      if (frames === 0) throw new Error('The WAV file contains no audio samples.')
      return { format: 'wav', sampleRate: format.sampleRate, channels: format.channels, bitsPerSample: format.bitsPerSample, durationSeconds: frames / format.sampleRate, bytes: bytes.length }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('The WAV file contains no audio data.')
}

/** Validates the container and stream description of generated audio before it becomes a take. */
export function inspectAudio(bytes: Uint8Array): AudioInfo {
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'fLaC') return inspectFlac(bytes)
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return inspectWav(bytes)
  throw new Error('The file is not FLAC or WAV audio.')
}

export function describeAudio(info: Pick<AudioInfo, 'format' | 'sampleRate' | 'channels'>) {
  const channels = info.channels === 1 ? 'Mono' : info.channels === 2 ? 'Stereo' : `${info.channels} ch`
  return `${info.format.toUpperCase()} / ${(info.sampleRate / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} kHz / ${channels}`
}

export function formatTime(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '--:--'
  const whole = Math.floor(seconds)
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}
