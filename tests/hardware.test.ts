import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computerSummary } from '../src/main/hardware'
import { formatMemory, memoryPair, parseBackendDevices } from '../src/shared/hardware'
import { assessHardware, createDefaultBackendSettings, isRecommendedChoice, modelProfiles, modelRequirements, parseBackendSettings, useRecommendedSetup } from '../src/shared/generation'

const gb = 1024 ** 3
const gpu = (total: unknown, free: unknown, type = 'cuda') => parseBackendDevices([{ name: 'GPU', type, vram_total: total, vram_free: free }])
const music = modelProfiles['ace-step-1.5-turbo']

test('host summary contains only measured OS, CPU and memory, not user identity or paths', () => {
  const summary = computerSummary()
  assert.deepEqual(Object.keys(summary).sort(), ['cpu', 'logicalCores', 'os', 'ramFree', 'ramTotal'])
  assert.ok(summary.os.length && summary.cpu.length)
  assert.ok(summary.logicalCores >= 0)
  assert.ok(summary.ramTotal !== null && summary.ramTotal > 0)
  assert.ok(summary.ramFree !== null && summary.ramFree <= summary.ramTotal)
})

test('unknown, nonfinite, negative and inconsistent telemetry stays unknown, not zero', () => {
  for (const bad of [undefined, null, '', '32', -1, NaN, Infinity, {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(memoryPair(bad, bad), { total: null, free: null })
    assert.equal(assessHardware(music, gpu(bad, bad)).level, 'unknown')
  }
  assert.deepEqual(memoryPair(0, 0), { total: null, free: null })
  assert.deepEqual(memoryPair(8 * gb, 12 * gb), { total: 8 * gb, free: null })
  assert.deepEqual(memoryPair(8 * gb, 0), { total: 8 * gb, free: 0 })
  assert.equal(formatMemory(null), 'Unknown')
  assert.equal(formatMemory(32 * gb), '32.0 GB')
  assert.deepEqual(parseBackendDevices(null), [])
  assert.deepEqual(parseBackendDevices([null, 'GPU', []]), [])
  assert.equal(parseBackendDevices([{}])[0].type, 'unknown')
})

test('fit guidance uses free memory per device without rounding up or pooling GPUs', () => {
  assert.equal(assessHardware(music, gpu(24 * gb, 4 * gb)).level, 'tight')
  assert.equal(assessHardware(music, gpu(24 * gb, 12 * gb - 1)).level, 'tight')
  assert.equal(assessHardware(music, [...gpu(8 * gb, 8 * gb), ...gpu(8 * gb, 8 * gb)]).level, 'tight')
  const fit = assessHardware(music, [...gpu(48 * gb, 4 * gb), ...gpu(16 * gb, 14 * gb)])
  assert.equal(fit.level, 'likely')
  assert.match(fit.text, /14.0 GB free of 16.0 GB.*advisory only/)
  assert.equal(assessHardware(music, gpu(24 * gb, undefined)).level, 'unknown')
  assert.equal(assessHardware(music, gpu(24 * gb, 0)).level, 'tight')
})

test('CPU, unified memory, disconnected and remote models never imply GPU compatibility', () => {
  assert.equal(assessHardware(music, gpu(64 * gb, 48 * gb, 'cpu')).level, 'cpu')
  assert.equal(assessHardware(music, gpu(64 * gb, 48 * gb, 'mps')).level, 'unknown')
  assert.equal(assessHardware(music, gpu(64 * gb, 48 * gb, 'unknown')).level, 'unknown')
  assert.equal(assessHardware(music, []).level, 'unknown')
  assert.equal(assessHardware(modelProfiles['mirelo-sfx-2.0'], []).level, 'remote')
  assert.equal(assessHardware(modelProfiles['custom-workflow'], []).level, 'unknown')
  for (const profile of Object.values(modelProfiles)) {
    const requirement = modelRequirements(profile)
    if (profile.execution === 'cloud') assert.match(requirement, /Remote.*GPU not required/)
    else if (profile.execution === 'workflow') assert.match(requirement, /depend on your workflow/)
    else assert.match(requirement, new RegExp(`${profile.recommendedVramGb} GB.*estimate`))
  }
})

test('recommended reset replaces only the selected task and preserves connection and saved other task', () => {
  const settings = createDefaultBackendSettings()
  assert.ok(isRecommendedChoice('effects', settings.models.effects))
  assert.ok(isRecommendedChoice('music', settings.models.music))
  settings.endpoint = 'http://127.0.0.1:9999'
  settings.connectOnLaunch = false
  settings.models.effects = { profileId: 'mirelo-sfx-2.0', checkpoint: 'saved', textEncoder: '', workflow: null }
  settings.models.music.checkpoint = 'custom-ace.safetensors'
  assert.equal(isRecommendedChoice('music', settings.models.music), false)
  const before = JSON.stringify(settings)
  const reset = useRecommendedSetup(settings, 'music')
  assert.equal(JSON.stringify(settings), before, 'Reset never mutates existing state')
  assert.equal(reset.models.effects, settings.models.effects)
  assert.equal(reset.endpoint, settings.endpoint)
  assert.equal(reset.connectOnLaunch, false)
  assert.deepEqual(reset.models.music, createDefaultBackendSettings().models.music)
  assert.deepEqual(parseBackendSettings(JSON.stringify(reset)), reset)
  assert.equal(isRecommendedChoice('effects', settings.models.effects), false)
  assert.deepEqual(useRecommendedSetup(settings, 'effects').models.music, settings.models.music)
})
