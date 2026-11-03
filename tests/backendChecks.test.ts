import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backendChecks, backendSummary, type CheckInput } from '../src/shared/backendChecks'
import { createDefaultBackendSettings, outputNodeClass, type BackendStatus, type Readiness } from '../src/shared/generation'
import type { LauncherStatus } from '../src/shared/launcher'

const launcher = (patch: Partial<LauncherStatus> = {}): LauncherStatus => ({
  folder: 'C:\\ComfyUI', layout: 'venv', installError: '', outputNode: 'installed', phase: 'stopped', endpoint: null, message: '', hasLog: false, ...patch
})
const status = (patch: Partial<BackendStatus> = {}): BackendStatus => ({
  endpoint: 'http://127.0.0.1:8188', comfyuiVersion: '0.43.0', devices: [{ name: 'cuda:0 RTX', type: 'cuda', vramTotal: 16 * 1024 ** 3, vramFree: 0 }],
  checkpoints: [], textEncoders: [], clipTypes: [], availableNodes: [outputNodeClass], apiNodes: [], checkedAt: '', ...patch
})
const ready: Readiness = { ready: true, remote: false, checkpoint: 'model.safetensors', textEncoder: null, issues: [] }
const blocked: Readiness = { ready: false, remote: false, checkpoint: null, textEncoder: null, issues: ['No ACE-Step 1.5 checkpoint found.'] }
const input = (patch: Partial<CheckInput> = {}): CheckInput => ({
  connection: { state: 'connected', status: status() }, launcher: launcher(), models: createDefaultBackendSettings().models, readiness: { effects: ready, music: ready }, ...patch
})
const byId = (checks: ReturnType<typeof backendChecks>) => Object.fromEntries(checks.map(check => [check.id, check]))

test('a running ComfyUI with models and the WAV node is ready', () => {
  const checks = backendChecks(input())
  assert.deepEqual(checks.map(check => check.status), ['ready', 'ready', 'ready', 'ready', 'ready', 'ready'])
  assert.match(byId(checks).device.detail, /RTX \/ 16 GB/)
  assert.deepEqual(backendSummary(checks, 'stopped'), { label: 'Local backends ready', tone: 'ready' })
})

test('a stopped ComfyUI offers one-click start and waits to check the rest', () => {
  const checks = byId(backendChecks(input({ connection: { state: 'disconnected' } })))
  assert.equal(checks.server.status, 'blocked')
  assert.equal(checks.server.action, 'start')
  assert.equal(checks.device.status, 'pending')
  assert.equal(checks.music.status, 'pending')
  assert.deepEqual(backendSummary(Object.values(checks), 'stopped'), { label: 'Setup needs attention', tone: 'warning' })
  assert.equal(backendSummary(Object.values(checks), 'starting').label, 'Starting ComfyUI...')
  assert.equal(backendSummary(backendChecks(input({ connection: { state: 'checking' } })), 'stopped').label, 'Checking backends')
})

test('a missing folder, output node or model is reported with the action that fixes it', () => {
  const noFolder = byId(backendChecks(input({ connection: { state: 'disconnected' }, launcher: launcher({ folder: null, layout: null, outputNode: null }) })))
  assert.equal(noFolder.folder.action, 'choose-folder')
  assert.equal(noFolder.server.action, undefined, 'cannot start without a folder')

  const notLoaded = byId(backendChecks(input({ connection: { state: 'connected', status: status({ availableNodes: ['SaveAudio'] }) }, launcher: launcher({ phase: 'running' }) })))
  assert.equal(notLoaded.output.status, 'warning')
  assert.equal(notLoaded.output.action, 'restart')
  const missing = byId(backendChecks(input({ connection: { state: 'connected', status: status({ availableNodes: ['SaveAudio'] }) }, launcher: launcher({ outputNode: 'missing' }) })))
  assert.equal(missing.output.action, 'install-node')

  const cpuOnly = byId(backendChecks(input({ connection: { state: 'connected', status: status({ devices: [{ name: 'cpu', type: 'cpu', vramTotal: 0, vramFree: 0 }] }) } })))
  assert.equal(cpuOnly.device.status, 'warning')

  const noModel = byId(backendChecks(input({ readiness: { effects: ready, music: blocked } })))
  assert.equal(noModel.music.status, 'blocked')
  assert.equal(noModel.music.action, 'models-music')
  assert.match(noModel.music.detail, /ACE-Step 1.5 Turbo: No ACE-Step 1.5 checkpoint found\./)
})
