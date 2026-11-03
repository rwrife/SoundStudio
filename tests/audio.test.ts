import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeAudio, formatTime, inspectAudio } from '../src/shared/audio'

function wav({ sampleRate = 44100, channels = 1, bits = 16, frames = 44100, encoding = 1 } = {}) {
  const blockAlign = channels * bits / 8
  const data = frames * blockAlign
  const view = new DataView(new ArrayBuffer(44 + data))
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + data, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, encoding, true); view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, bits, true)
  text(36, 'data'); view.setUint32(40, data, true)
  return new Uint8Array(view.buffer)
}

function flac({ sampleRate = 48000, channels = 2, bits = 16, totalSamples = 96000n, frames = true } = {}) {
  const bytes = new Uint8Array(4 + 4 + 34 + (frames ? 4 : 0))
  bytes.set([0x66, 0x4c, 0x61, 0x43], 0)
  bytes.set([0x80, 0, 0, 34], 4)
  let packed = (BigInt(sampleRate) << 44n) | (BigInt(channels - 1) << 41n) | (BigInt(bits - 1) << 36n) | totalSamples
  for (let index = 7; index >= 0; index -= 1) { bytes[18 + index] = Number(packed & 0xffn); packed >>= 8n }
  if (frames) bytes.set([0xff, 0xf8, 0, 0], 42)
  return bytes
}

test('reads WAV stream details and duration', () => {
  const info = inspectAudio(wav({ sampleRate: 48000, channels: 2, frames: 24000 }))
  assert.deepEqual({ ...info, bytes: 0 }, { format: 'wav', sampleRate: 48000, channels: 2, bitsPerSample: 16, durationSeconds: 0.5, bytes: 0 })
  assert.equal(describeAudio(info), 'WAV / 48 kHz / Stereo')
})

test('reads FLAC stream information and requires audio frames', () => {
  const info = inspectAudio(flac())
  assert.equal(info.format, 'flac')
  assert.equal(info.sampleRate, 48000)
  assert.equal(info.channels, 2)
  assert.equal(info.bitsPerSample, 16)
  assert.equal(info.durationSeconds, 2)
  assert.equal(inspectAudio(flac({ totalSamples: 0n })).durationSeconds, null)
  assert.throws(() => inspectAudio(flac({ frames: false })), /no audio frames/)
})

test('rejects files that are not usable audio', () => {
  assert.throws(() => inspectAudio(new TextEncoder().encode('{"error":"not audio"}')), /not FLAC or WAV/)
  assert.throws(() => inspectAudio(new Uint8Array()), /not FLAC or WAV/)
  assert.throws(() => inspectAudio(wav({ frames: 0 })), /no audio samples/)
  assert.throws(() => inspectAudio(wav({ encoding: 2 })), /Unsupported WAV encoding/)
  assert.throws(() => inspectAudio(wav({ sampleRate: 1000 })), /sample rate/)
  assert.throws(() => inspectAudio(flac({ sampleRate: 0 })), /sample rate/)
  assert.throws(() => inspectAudio(flac().subarray(0, 20)), /truncated/)
})

test('formats playback time', () => {
  assert.equal(formatTime(0), '00:00')
  assert.equal(formatTime(75.9), '01:15')
  assert.equal(formatTime(null), '--:--')
  assert.equal(formatTime(Number.NaN), '--:--')
})
