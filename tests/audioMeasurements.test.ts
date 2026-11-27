import assert from 'node:assert/strict'
import { test } from 'node:test'
import { measureAudio } from '../src/shared/audioMeasurements'

test('measures silence and DC offset without modifying samples', () => {
  const silence = Float32Array.of(0, 0, 0)
  const offset = Float32Array.of(0.25, 0.25, 0.25)
  const report = measureAudio([silence, offset], 48000, { startFrame: 0, endFrame: 3 })
  assert.deepEqual(report, {
    algorithm: 'normalized-pcm-v1', sampleRate: 48000, range: { startFrame: 0, endFrame: 3 },
    channels: [
      { samplePeak: 0, rms: 0, dcOffset: 0, fullScaleSamples: 0, boundaryStep: 0 },
      { samplePeak: 0.25, rms: 0.25, dcOffset: 0.25, fullScaleSamples: 0, boundaryStep: 0 }
    ]
  })
  assert.deepEqual([...offset], [0.25, 0.25, 0.25])
})

test('measures each channel and selected loop range independently', () => {
  const report = measureAudio([
    Float32Array.of(1, -0.5, 0.5, 0.25, -1),
    Float32Array.of(1, 0, 0.25, -0.5, -1)
  ], 44100, { startFrame: 1, endFrame: 4 })
  assert.equal(report.channels[0].samplePeak, 0.5)
  assert.equal(report.channels[0].boundaryStep, -0.75)
  assert.equal(report.channels[0].fullScaleSamples, 0)
  assert.equal(report.channels[1].boundaryStep, 0.5)
  assert.ok(Math.abs(report.channels[1].dcOffset + 1 / 12) < 1e-12)
  assert.ok(Math.abs(report.channels[1].rms - Math.sqrt((0.25 ** 2 + 0.5 ** 2) / 3)) < 1e-12)
})

test('counts full-scale samples without classifying clipping or loop quality', () => {
  const report = measureAudio([Float32Array.of(1, -1, 1)], 48000, { startFrame: 0, endFrame: 3 })
  assert.equal(report.channels[0].samplePeak, 1)
  assert.equal(report.channels[0].fullScaleSamples, 3)
  assert.equal(report.channels[0].boundaryStep, 0)
})

test('rejects invalid input and malformed ranges', () => {
  const audio = [Float32Array.of(0, 0)]
  assert.throws(() => measureAudio([], 48000, { startFrame: 0, endFrame: 1 }), /channels/)
  assert.throws(() => measureAudio([audio[0], Float32Array.of(0)], 48000, { startFrame: 0, endFrame: 1 }), /equal frame/)
  assert.throws(() => measureAudio(audio, 0, { startFrame: 0, endFrame: 1 }), /Sample rate/)
  for (const range of [{ startFrame: -1, endFrame: 1 }, { startFrame: 0, endFrame: 3 }, { startFrame: 1, endFrame: 1 }, { startFrame: 0.5, endFrame: 2 }]) {
    assert.throws(() => measureAudio(audio, 48000, range), /range/)
  }
  for (const value of [NaN, Infinity, 1.1, -1.1]) {
    assert.throws(() => measureAudio([Float32Array.of(value)], 48000, { startFrame: 0, endFrame: 1 }), /invalid normalized PCM/)
  }
})
