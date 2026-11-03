import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assessHardware, assessReadiness, buildComfyWorkflow, buildGenerationRequest, createDefaultBackendSettings, estimateCostUsd,
  formatPromptError, importCustomWorkflow, interpretHistory, modelProfiles, normalizeEndpoint, outputNodeClass, parseBackendSettings,
  parseTakeRecord, profilesFor, validateCloudConfiguration, validateCustomWorkflow, validateGenerationRequest,
  type BackendStatus, type CloudStatus, type ModelChoice
} from '../src/shared/generation'
import { createInitialState } from '../src/shared/workspace'

const status = (patch: Partial<BackendStatus> = {}): BackendStatus => ({
  endpoint: 'http://127.0.0.1:8188', comfyuiVersion: '0.9.0', devices: [],
  checkpoints: ['stable-audio-open-1.0.safetensors', 'ace_step_1.5_turbo_aio.safetensors'],
  textEncoders: ['t5-base.safetensors'], clipTypes: ['stable_audio'],
  availableNodes: [...new Set(Object.values(modelProfiles).flatMap(profile => profile.requiredNodes))], apiNodes: ['MireloTextToSFX', 'ByteDanceSeedAudio'],
  checkedAt: new Date(0).toISOString(), ...patch
})
const choice = (profileId: ModelChoice['profileId'], patch: Partial<ModelChoice> = {}): ModelChoice => ({ profileId, checkpoint: '', textEncoder: '', workflow: null, ...patch })
const cloudOff: CloudStatus = { enabled: false, hasKey: false, encryptionAvailable: true }
const cloudOn: CloudStatus = { enabled: true, hasKey: true, encryptionAvailable: true }
const apiWorkflow = {
  1: { class_type: 'MusicGenGenerate', inputs: { prompt: '{{prompt}}', duration: '{{seconds}}', seed: '{{seed}}', note: 'Key {{key}} at {{bpm}} BPM' } },
  2: { class_type: 'SaveAudio', inputs: { audio: ['1', 0], filename_prefix: 'musicgen' } }
}

function request(workspace: 'effects' | 'music', profileId: ModelChoice['profileId'], patch: Record<string, unknown> = {}, model: Partial<ModelChoice> = {}) {
  const draft = { ...createInitialState().drafts[workspace], prompt: 'Heavy wooden door creaks open', seed: '42', ...patch }
  const built = buildGenerationRequest(workspace, draft, choice(profileId, model), { checkpoint: 'model.safetensors', textEncoder: 't5-base.safetensors' })
  assert.deepEqual(built.problems, [])
  return built.request!
}

test('only loopback ComfyUI endpoints are accepted', () => {
  assert.equal(normalizeEndpoint(' http://127.0.0.1:8188/ '), 'http://127.0.0.1:8188')
  assert.equal(normalizeEndpoint('http://localhost:9000'), 'http://localhost:9000')
  assert.equal(normalizeEndpoint('http://[::1]:8188'), 'http://[::1]:8188')
  for (const bad of ['', 'not a url', 'https://127.0.0.1:8188', 'http://192.168.1.5:8188', 'http://comfy.example.com', 'http://127.0.0.1:8188/api', 'http://user:pw@127.0.0.1:8188', 'http://127.0.0.1:8188?x=1', 'file:///etc/passwd', 42]) {
    assert.throws(() => normalizeEndpoint(bad), String(bad))
  }
})

test('profiles are offered only for supported workspaces and cloud profiles carry provider and pricing', () => {
  assert.deepEqual(profilesFor('effects').map(profile => profile.id), ['stable-audio-open-1.0', 'mirelo-sfx-2.0', 'seed-audio-1.0', 'custom-workflow'])
  assert.deepEqual(profilesFor('music').map(profile => profile.id), ['stable-audio-open-1.0', 'ace-step-1.5-turbo', 'ace-step-v1-3.5b', 'custom-workflow'])
  for (const profile of Object.values(modelProfiles)) {
    assert.equal(profile.execution === 'cloud', !!profile.provider, profile.id)
    assert.ok(profile.install.length && profile.license && profile.source.startsWith('https://'))
  }
  assert.equal(estimateCostUsd(modelProfiles['mirelo-sfx-2.0'], 10), 0.13)
  assert.equal(estimateCostUsd(modelProfiles['stable-audio-open-1.0'], 10), 0)
})

test('local profiles build ComfyUI API graphs from the draft', () => {
  const stable = buildComfyWorkflow(request('effects', 'stable-audio-open-1.0', { loop: true, duration: '7.25' }))
  assert.equal(stable.outputNodeId, '9')
  assert.equal(stable.workflow[9].class_type, 'SaveAudio')
  assert.equal(stable.workflow[2].inputs.type, 'stable_audio')
  assert.equal(stable.workflow[5].inputs.seconds_total, 7.3)
  assert.equal(stable.workflow[7].inputs.seed, 42)
  assert.match(String(stable.workflow[3].inputs.text), /^Heavy wooden door creaks open.*Seamless loop\.$/)

  const ace = buildComfyWorkflow(request('music', 'ace-step-1.5-turbo', { instrumental: false, lyrics: '[verse]\nHello', musicKey: 'A minor', tempo: '96', duration: '60' }))
  const encode = ace.workflow[3]
  assert.equal(encode.class_type, 'TextEncodeAceStepAudio1.5')
  assert.deepEqual([encode.inputs.bpm, encode.inputs.keyscale, encode.inputs.duration, encode.inputs.lyrics, encode.inputs.seed], [96, 'A minor', 60, '[verse]\nHello', 42])
  assert.equal(ace.workflow[6].inputs.steps, 8)
  assert.deepEqual(ace.workflow[7].inputs.vae, ['1', 2])
  assert.equal(buildComfyWorkflow(request('music', 'ace-step-1.5-turbo')).workflow[3].inputs.lyrics, '[Instrumental]')
})

test('the Sound Studio WAV node replaces Save Audio when ComfyUI has it', () => {
  const ace = buildComfyWorkflow(request('music', 'ace-step-1.5-turbo'), outputNodeClass)
  assert.deepEqual(ace.workflow[ace.outputNodeId], { class_type: outputNodeClass, inputs: { audio: ['7', 0], filename_prefix: 'sound-studio/music' } })
  const workflow = validateCustomWorkflow({ name: 'MusicGen', graph: { ...apiWorkflow, 2: { class_type: 'SaveAudio', inputs: { audio: ['1', 0], filename_prefix: 'x', format: 'flac' } } } })
  const custom = buildComfyWorkflow(request('music', 'custom-workflow', {}, { workflow }), outputNodeClass)
  assert.deepEqual(custom.workflow[2], { class_type: outputNodeClass, inputs: { audio: ['1', 0], filename_prefix: 'sound-studio/music' } }, 'Save Audio-only inputs are dropped')
  assert.equal(validateCustomWorkflow({ name: 'WAV', graph: { ...apiWorkflow, 2: { class_type: outputNodeClass, inputs: { audio: ['1', 0] } } } }).outputNodeId, '2')
  const withoutSaveAudio = status({ availableNodes: status().availableNodes.filter(node => node !== 'SaveAudio').concat(outputNodeClass) })
  assert.equal(assessReadiness(choice('ace-step-1.5-turbo'), withoutSaveAudio, cloudOff).ready, true, 'the WAV node satisfies the Save Audio requirement')
})

test('cloud partner graphs use the documented node inputs', () => {
  const mirelo = buildComfyWorkflow(request('effects', 'mirelo-sfx-2.0', { duration: '4' }))
  assert.deepEqual(Object.keys(mirelo.workflow[1].inputs).sort(), ['model', 'model.duration', 'model.negative_prompt', 'model.prompt', 'model.seed'])
  assert.equal(mirelo.workflow[1].inputs.model, 'sfx-2.0')
  assert.equal(mirelo.workflow[1].inputs['model.duration'], 4)

  const seed = buildComfyWorkflow(request('effects', 'seed-audio-1.0', { duration: '12' }))
  assert.equal(seed.workflow[1].class_type, 'ByteDanceSeedAudio')
  assert.match(String(seed.workflow[1].inputs.text_prompt), /About 12 seconds long/)
  assert.equal(modelProfiles['seed-audio-1.0'].durationControl, 'prompt')
  const draft = { ...createInitialState().drafts.effects, prompt: 'Thunder', seed: '4294967295' }
  assert.match(buildGenerationRequest('effects', draft, choice('seed-audio-1.0'), { checkpoint: null, textEncoder: null }).problems.join(), /Seed must be a whole number from 0 to 2147483647/)
})

test('custom workflows require API format, one Save Audio node and known placeholders', () => {
  const workflow = importCustomWorkflow(JSON.stringify(apiWorkflow), 'MusicGen small')
  assert.equal(workflow.outputNodeId, '2')
  assert.deepEqual(workflow.placeholders, ['prompt', 'seconds', 'seed', 'bpm', 'key'])
  assert.throws(() => importCustomWorkflow('{"nodes":[],"links":[]}', 'UI'), /Export \(API\)/)
  assert.throws(() => importCustomWorkflow('nope', 'x'), /not valid JSON/)
  assert.throws(() => validateCustomWorkflow({ name: 'x', graph: { 1: apiWorkflow[1] } }), /exactly one Save Audio/)
  assert.throws(() => validateCustomWorkflow({ name: 'x', graph: { ...apiWorkflow, 3: { ...apiWorkflow[2] } } }), /exactly one Save Audio/)
  assert.throws(() => validateCustomWorkflow({ name: 'x', graph: { ...apiWorkflow, 1: { class_type: 'X', inputs: { text: '{{prompt}} {{voice}}' } } } }), /Unknown placeholders: \{\{voice\}\}/)
  assert.throws(() => validateCustomWorkflow({ name: 'x', graph: { ...apiWorkflow, 1: { class_type: 'X', inputs: { text: 'fixed' } } } }), /Add \{\{prompt\}\}/)
  assert.throws(() => validateCustomWorkflow({ name: 'x', graph: { ...apiWorkflow, 2: { class_type: 'SaveAudio', inputs: { audio: ['9', 0] } } } }), /missing node "9"/)
  assert.throws(() => validateCustomWorkflow({ name: ' ', graph: apiWorkflow }), /needs a name/)

  const built = buildComfyWorkflow(request('music', 'custom-workflow', { tempo: '110', musicKey: 'D major', duration: '20' }, { workflow }))
  assert.equal(built.workflow[1].inputs.duration, 20, 'whole-value placeholders keep their number type')
  assert.equal(built.workflow[1].inputs.seed, 42)
  assert.equal(built.workflow[1].inputs.note, 'Key D major at 110 BPM')
  assert.equal(built.workflow[2].inputs.filename_prefix, 'sound-studio/music')
  assert.equal(workflow.graph[2].inputs.filename_prefix, 'musicgen', 'the imported graph is not mutated')
  const effects = buildGenerationRequest('effects', { ...createInitialState().drafts.effects, prompt: 'Rain' }, choice('custom-workflow', { workflow }), { checkpoint: null, textEncoder: null })
  assert.match(effects.problems.join(), /only available in Music/)
})

test('readiness reports missing models, nodes and cloud opt-in honestly', () => {
  assert.deepEqual(assessReadiness(choice('stable-audio-open-1.0'), null, cloudOff).issues, ['Connect to a local ComfyUI server.'])
  const ready = assessReadiness(choice('stable-audio-open-1.0'), status(), cloudOff)
  assert.deepEqual(ready, { ready: true, remote: false, checkpoint: 'stable-audio-open-1.0.safetensors', textEncoder: 't5-base.safetensors', issues: [] })
  const missing = assessReadiness(choice('stable-audio-open-1.0', { checkpoint: 'gone.safetensors' }), status({ checkpoints: [], textEncoders: [] }), cloudOff)
  assert.equal(missing.ready, false)
  assert.match(missing.issues.join('\n'), /No Stable Audio Open 1.0 checkpoint/)
  assert.match(missing.issues.join('\n'), /No T5-base text encoder/)

  const unrelated = assessReadiness(choice('ace-step-1.5-turbo', { checkpoint: 'hunyuan3d-dit-v2_fp16.safetensors' }),
    status({ checkpoints: ['ace_step_1.5_turbo_aio.safetensors', 'hunyuan3d-dit-v2_fp16.safetensors'] }), cloudOff)
  assert.equal(unrelated.ready, false, 'an unrelated checkpoint is not reported as ready when a matching one is installed')
  assert.match(unrelated.issues.join(), /does not look like the ACE-Step 1.5 Turbo checkpoint. Choose Automatic \(ace_step_1.5_turbo_aio.safetensors\)/)
  const renamed = assessReadiness(choice('ace-step-1.5-turbo', { checkpoint: 'my-music.safetensors' }), status({ checkpoints: ['my-music.safetensors'] }), cloudOff)
  assert.equal(renamed.ready, true, 'a renamed file is accepted when nothing better matches')
  const mireloOff = assessReadiness(choice('mirelo-sfx-2.0'), status(), cloudOff)
  assert.equal(mireloOff.remote, true)
  assert.equal(mireloOff.ready, false)
  assert.match(mireloOff.issues.join(), /Enable cloud partner models/)
  assert.equal(assessReadiness(choice('mirelo-sfx-2.0'), status(), { ...cloudOn, hasKey: false }).ready, false)
  assert.equal(assessReadiness(choice('mirelo-sfx-2.0'), status(), cloudOn).ready, true)
  assert.match(assessReadiness(choice('seed-audio-1.0'), status({ availableNodes: ['SaveAudio'] }), cloudOn).issues.join(), /missing nodes: ByteDanceSeedAudio/)

  const workflow = validateCustomWorkflow({ name: 'Custom', graph: apiWorkflow })
  assert.match(assessReadiness(choice('custom-workflow'), status(), cloudOff).issues.join(), /Import a ComfyUI API workflow/)
  assert.match(assessReadiness(choice('custom-workflow', { workflow }), status(), cloudOff, { missingNodes: ['MusicGenGenerate'], apiNodes: [] }).issues.join(), /MusicGenGenerate/)
  assert.equal(assessReadiness(choice('custom-workflow', { workflow }), status(), cloudOff, { missingNodes: [], apiNodes: [] }).ready, true)
  const partner = assessReadiness(choice('custom-workflow', { workflow }), status(), cloudOff, { missingNodes: [], apiNodes: ['MireloTextToSFX'] })
  assert.equal(partner.remote, true)
  assert.match(partner.issues.join(), /partner nodes that send data off this device \(MireloTextToSFX\)/)
})

test('hardware guidance compares reported VRAM without claiming certainty', () => {
  const gb = 1024 ** 3
  assert.equal(assessHardware(modelProfiles['ace-step-1.5-turbo'], [{ name: 'cuda:0', type: 'cuda', vramTotal: 24 * gb, vramFree: 20 * gb }]).level, 'likely')
  assert.equal(assessHardware(modelProfiles['ace-step-1.5-turbo'], [{ name: 'cuda:0', type: 'cuda', vramTotal: 8 * gb, vramFree: 8 * gb }]).level, 'tight')
  assert.equal(assessHardware(modelProfiles['stable-audio-open-1.0'], [{ name: 'cpu', type: 'cpu', vramTotal: 0, vramFree: 0 }]).level, 'cpu')
  assert.equal(assessHardware(modelProfiles['stable-audio-open-1.0'], []).level, 'unknown')
  assert.equal(assessHardware(modelProfiles['mirelo-sfx-2.0'], []).level, 'remote')
})

test('requests are validated against model limits in the renderer and again at the IPC boundary', () => {
  const effects = createInitialState().drafts.effects
  const problems = (draft: Partial<typeof effects>, profileId: ModelChoice['profileId'] = 'stable-audio-open-1.0') =>
    buildGenerationRequest('effects', { ...effects, prompt: 'Rain', ...draft }, choice(profileId), { checkpoint: 'a', textEncoder: 'b' }).problems.join('\n')
  assert.match(problems({ prompt: '  ' }), /Describe your sound/)
  assert.match(problems({ duration: '48' }), /Duration must be 1-47 seconds/)
  assert.match(problems({ seed: '-1' }), /Seed must be/)
  assert.match(problems({ prompt: 'x'.repeat(2001) }, 'mirelo-sfx-2.0'), /up to 2000 characters/)
  const noModels = buildGenerationRequest('effects', { ...effects, prompt: 'Rain' }, choice('stable-audio-open-1.0'), { checkpoint: null, textEncoder: null }).problems.join()
  assert.match(noModels, /installed checkpoint/)
  const sao = buildGenerationRequest('music', { ...createInitialState().drafts.music, prompt: 'Song', instrumental: false, lyrics: 'la' }, choice('stable-audio-open-1.0'), { checkpoint: 'a', textEncoder: 'b' })
  assert.match(sao.problems.join(), /cannot sing lyrics/)
  const random = buildGenerationRequest('effects', { ...effects, prompt: 'Rain', seed: '' }, choice('stable-audio-open-1.0'), { checkpoint: 'a', textEncoder: 'b' }, 1234)
  assert.equal(random.request?.seed, 1234)

  const valid = request('effects', 'stable-audio-open-1.0')
  assert.deepEqual(validateGenerationRequest(JSON.parse(JSON.stringify(valid))), valid)
  for (const patch of [{ workspace: 'video' }, { profileId: 'ace-step-1.5-turbo' }, { durationSeconds: 48 }, { seed: 1.5 }, { tempo: 120 },
    { checkpoint: '' }, { workflow: apiWorkflow }, { prompt: '' }, { category: 'Unknown' }, { musicKey: 'X' }, { loop: 'yes' }]) {
    assert.throws(() => validateGenerationRequest({ ...valid, ...patch }), /Invalid generation request/, JSON.stringify(patch))
  }
  const music = request('music', 'ace-step-1.5-turbo')
  assert.throws(() => validateGenerationRequest({ ...music, instrumental: false, lyrics: '' }), /lyrics are required/)
  assert.throws(() => validateGenerationRequest({ ...music, tempo: null }), /tempo/)
})

test('backend settings and cloud configuration are validated', () => {
  const settings = createDefaultBackendSettings()
  assert.equal(settings.connectOnLaunch, true, 'checks the loopback ComfyUI on first launch')
  settings.models.music = choice('custom-workflow', { workflow: validateCustomWorkflow({ name: 'DiffRhythm 2', graph: apiWorkflow }) })
  assert.deepEqual(parseBackendSettings(JSON.stringify(settings)), settings)
  assert.throws(() => parseBackendSettings('{"version":2}'))
  assert.throws(() => parseBackendSettings(JSON.stringify({ ...settings, models: { ...settings.models, effects: choice('ace-step-1.5-turbo') } })), 'music-only profile in effects')
  assert.throws(() => parseBackendSettings(JSON.stringify({ ...settings, models: { ...settings.models, music: { ...settings.models.music, workflow: { name: 'x', graph: {} } } } })))

  assert.deepEqual(validateCloudConfiguration({ enabled: true }), { enabled: true, apiKey: undefined })
  assert.deepEqual(validateCloudConfiguration({ enabled: false, apiKey: null }), { enabled: false, apiKey: null })
  assert.equal(validateCloudConfiguration({ enabled: true, apiKey: '  comfyui-abcdefghijklmnop ' }).apiKey, 'comfyui-abcdefghijklmnop')
  for (const bad of [null, {}, { enabled: 'yes' }, { enabled: true, apiKey: 'short' }, { enabled: true, apiKey: 'has space in the middle!!' }, { enabled: true, apiKey: 5 }]) {
    assert.throws(() => validateCloudConfiguration(bad))
  }
})

test('ComfyUI history and errors are interpreted without inventing output', () => {
  assert.deepEqual(interpretHistory(undefined, '9'), { kind: 'pending' })
  assert.deepEqual(interpretHistory({ outputs: { 9: { audio: [{ filename: 'a.flac', subfolder: 'sound-studio', type: 'output' }] } }, status: { completed: true } }, '9'),
    { kind: 'success', file: { filename: 'a.flac', subfolder: 'sound-studio', type: 'output' } })
  assert.deepEqual(interpretHistory({ outputs: {}, status: { completed: true, status_str: 'success' } }, '9'), { kind: 'error', message: 'ComfyUI finished without returning audio.' })
  const error = interpretHistory({ status: { status_str: 'error', messages: [['execution_error', { node_type: 'KSampler', exception_message: 'CUDA out of memory' }]] } }, '9')
  assert.deepEqual(error, { kind: 'error', message: 'ComfyUI could not generate this take. KSampler: CUDA out of memory' })
  assert.deepEqual(interpretHistory({ status: { messages: [['execution_interrupted', {}]] } }, '9'), { kind: 'interrupted' })
  const encoding = interpretHistory({ status: { status_str: 'error', messages: [['execution_error', { node_type: 'SaveAudio', exception_message: "'_Module' object is not callable" }]] } }, '9')
  assert.match(encoding.kind === 'error' ? encoding.message : '', /PyAV\/FFmpeg is missing or blocked.*audio output node/)
  for (const audio of [{ filename: '../x.flac', subfolder: '', type: 'output' }, { filename: 'x.flac', subfolder: 'C:/x', type: 'output' }, { filename: 'x.flac', subfolder: '', type: 'temp' }]) {
    assert.equal(interpretHistory({ outputs: { 9: { audio: [audio] } } }, '9').kind, 'error', JSON.stringify(audio))
  }
  assert.equal(formatPromptError({ error: { message: 'Prompt outputs failed validation' }, node_errors: { 1: { class_type: 'CheckpointLoaderSimple', errors: [{ message: 'Value not in list', details: 'ckpt_name' }] } } }, 400),
    'ComfyUI rejected the workflow. Prompt outputs failed validation CheckpointLoaderSimple: Value not in list: ckpt_name')
  assert.equal(formatPromptError('oops', 500), 'ComfyUI rejected the workflow (HTTP 500).')
})

test('take records must match their id and contain a valid request', () => {
  const id = '12345678-1234-4234-8234-123456789abc'
  const take = {
    version: 1, id, createdAt: new Date(0).toISOString(), workspace: 'effects', title: '',
    audio: { format: 'wav', sampleRate: 44100, channels: 1, bitsPerSample: 16, durationSeconds: 1, bytes: 88244, fileName: `${id}.wav` },
    request: request('effects', 'stable-audio-open-1.0'), model: {}, backend: { remoteNodes: [] }, workflow: {}
  }
  assert.equal(parseTakeRecord(take).id, id)
  assert.throws(() => parseTakeRecord({ ...take, id: '../../evil' }))
  assert.throws(() => parseTakeRecord({ ...take, audio: { ...take.audio, fileName: '../other.wav' } }))
  assert.throws(() => parseTakeRecord({ ...take, request: { ...take.request, durationSeconds: 999 } }))
})
