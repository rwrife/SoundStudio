import type { AudioInfo } from './audio'
import { effectCategories, musicGenres, musicKeys, musicMoods, type Draft, type Workspace } from './workspace'

// ---------- Model profiles ----------

/**
 * local: open weights run by the user's ComfyUI on this device.
 * cloud: a ComfyUI partner node. ComfyUI sends the prompt to a third-party provider through Comfy.org.
 * workflow: a user-imported ComfyUI API workflow. Its nodes decide where it runs.
 */
export type Execution = 'local' | 'cloud' | 'workflow'

export type ModelProfileId =
  | 'stable-audio-open-1.0' | 'ace-step-1.5-turbo' | 'ace-step-v1-3.5b'
  | 'mirelo-sfx-2.0' | 'seed-audio-1.0' | 'custom-workflow'

export interface ModelProfile {
  id: ModelProfileId
  label: string
  summary: string
  workspaces: ReadonlyArray<Workspace>
  execution: Execution
  minSeconds: number
  maxSeconds: number
  /** 'prompt' means the model has no length control; the duration is only described in the prompt. */
  durationControl: 'exact' | 'prompt'
  maxPromptChars: number
  maxSeed: number
  supportsLyrics: boolean
  supportsKey: boolean
  /** Approximate guidance only, compared with the VRAM ComfyUI reports. */
  recommendedVramGb: number | null
  checkpoint?: { pattern: RegExp; suggested: string }
  textEncoder?: { pattern: RegExp; suggested: string; clipType: string }
  requiredNodes: ReadonlyArray<string>
  /** Cloud only. Where ComfyUI sends the prompt and how it is billed. */
  provider?: { name: string; usdPerSecond: number; pricingNote: string }
  source: string
  license: string
  install: ReadonlyArray<string>
}

const uint32Max = 4294967295

export const modelProfiles: Record<ModelProfileId, ModelProfile> = {
  'stable-audio-open-1.0': {
    id: 'stable-audio-open-1.0',
    label: 'Stable Audio Open 1.0',
    summary: 'Open-weight text-to-audio diffusion for sound effects, ambience, foley and short instrumental clips up to 47 seconds.',
    workspaces: ['effects', 'music'],
    execution: 'local',
    minSeconds: 1, maxSeconds: 47, durationControl: 'exact', maxPromptChars: 4000, maxSeed: uint32Max,
    supportsLyrics: false, supportsKey: false,
    recommendedVramGb: 6,
    checkpoint: { pattern: /stable[-_ ]?audio/i, suggested: 'stable-audio-open-1.0.safetensors' },
    textEncoder: { pattern: /t5[-_ ]?base/i, suggested: 't5-base.safetensors', clipType: 'stable_audio' },
    requiredNodes: ['CheckpointLoaderSimple', 'CLIPLoader', 'CLIPTextEncode', 'ConditioningStableAudio', 'EmptyLatentAudio', 'KSampler', 'VAEDecodeAudio', 'SaveAudio'],
    source: 'https://huggingface.co/stabilityai/stable-audio-open-1.0',
    license: 'Stability AI Community License. Accept the terms on Hugging Face before downloading.',
    install: [
      'Download model.safetensors from the model page and save it as ComfyUI/models/checkpoints/stable-audio-open-1.0.safetensors.',
      'Download the T5-base text encoder (google-t5/t5-base model.safetensors) to ComfyUI/models/text_encoders/t5-base.safetensors.'
    ]
  },
  'ace-step-1.5-turbo': {
    id: 'ace-step-1.5-turbo',
    label: 'ACE-Step 1.5 Turbo',
    summary: 'Open-weight music generation for instrumentals or songs with lyrics. Uses tempo, key and duration. Fast 8-step turbo model.',
    workspaces: ['music'],
    execution: 'local',
    minSeconds: 10, maxSeconds: 600, durationControl: 'exact', maxPromptChars: 4000, maxSeed: uint32Max,
    supportsLyrics: true, supportsKey: true,
    recommendedVramGb: 12,
    checkpoint: { pattern: /ace[-_ ]?step[-_ ]?(v)?1[._]5/i, suggested: 'ace_step_1.5_turbo_aio.safetensors' },
    requiredNodes: ['CheckpointLoaderSimple', 'ModelSamplingAuraFlow', 'TextEncodeAceStepAudio1.5', 'ConditioningZeroOut', 'EmptyAceStep1.5LatentAudio', 'KSampler', 'VAEDecodeAudio', 'SaveAudio'],
    source: 'https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files',
    license: 'MIT. Review the ACE-Step 1.5 model card before use.',
    install: ['Download checkpoints/ace_step_1.5_turbo_aio.safetensors (about 9.3 GB) to ComfyUI/models/checkpoints/.']
  },
  'ace-step-v1-3.5b': {
    id: 'ace-step-v1-3.5b',
    label: 'ACE-Step v1 3.5B',
    summary: 'Open-weight music generation for instrumental tracks or songs with lyrics, up to four minutes.',
    workspaces: ['music'],
    execution: 'local',
    minSeconds: 5, maxSeconds: 240, durationControl: 'exact', maxPromptChars: 4000, maxSeed: uint32Max,
    supportsLyrics: true, supportsKey: false,
    recommendedVramGb: 10,
    checkpoint: { pattern: /ace[-_ ]?step[-_ ]?v1[-_ ]?3[._]5b/i, suggested: 'ace_step_v1_3.5b.safetensors' },
    requiredNodes: ['CheckpointLoaderSimple', 'ModelSamplingSD3', 'TextEncodeAceStepAudio', 'ConditioningZeroOut', 'EmptyAceStepLatentAudio', 'KSampler', 'VAEDecodeAudio', 'SaveAudio'],
    source: 'https://huggingface.co/Comfy-Org/ACE-Step_ComfyUI_repackaged',
    license: 'Apache-2.0. Review the model card before use.',
    install: ['Download all_in_one/ace_step_v1_3.5b.safetensors to ComfyUI/models/checkpoints/ace_step_v1_3.5b.safetensors.']
  },
  'mirelo-sfx-2.0': {
    id: 'mirelo-sfx-2.0',
    label: 'Mirelo SFX 2.0',
    summary: 'Hosted text-to-SFX model for foley, ambience and impacts. Runs on Mirelo servers through the ComfyUI partner node.',
    workspaces: ['effects'],
    execution: 'cloud',
    minSeconds: 1, maxSeconds: 600, durationControl: 'exact', maxPromptChars: 2000, maxSeed: uint32Max,
    supportsLyrics: false, supportsKey: false,
    recommendedVramGb: null,
    requiredNodes: ['MireloTextToSFX', 'SaveAudio'],
    provider: {
      name: 'Mirelo via Comfy.org',
      usdPerSecond: 0.0132533115,
      pricingNote: 'ComfyUI lists about $0.0133 per second of audio, charged to your Comfy.org credits. Prices may change.'
    },
    source: 'https://docs.comfy.org/built-in-nodes/MireloTextToSFX',
    license: 'Proprietary hosted model. Subject to Comfy.org and Mirelo terms.',
    install: [
      'Update ComfyUI to a version that includes the Mirelo Text to SFX partner node.',
      'Create a Comfy.org API key at platform.comfy.org and add credits to the account.',
      'Enable cloud partner models below and store the key on this device.'
    ]
  },
  'seed-audio-1.0': {
    id: 'seed-audio-1.0',
    label: 'ByteDance Seed Audio 1.0',
    summary: 'Hosted model for sound effects, ambience and voices from a single prompt. Runs on ByteDance (BytePlus) servers through the ComfyUI partner node. Length is guided by the prompt only.',
    workspaces: ['effects'],
    execution: 'cloud',
    minSeconds: 1, maxSeconds: 120, durationControl: 'prompt', maxPromptChars: 3000, maxSeed: 2147483647,
    supportsLyrics: false, supportsKey: false,
    recommendedVramGb: null,
    requiredNodes: ['ByteDanceSeedAudio', 'SaveAudio'],
    provider: {
      name: 'ByteDance (BytePlus) via Comfy.org',
      usdPerSecond: 0.2145 / 60,
      pricingNote: 'ComfyUI lists about $0.21 per minute of audio, charged to your Comfy.org credits. Prices may change.'
    },
    source: 'https://docs.comfy.org/built-in-nodes/ByteDanceSeedAudio',
    license: 'Proprietary hosted model. Subject to Comfy.org and ByteDance terms.',
    install: [
      'Update ComfyUI to a version that includes the ByteDance Seed Audio 1.0 partner node.',
      'Create a Comfy.org API key at platform.comfy.org and add credits to the account.',
      'Enable cloud partner models below and store the key on this device.'
    ]
  },
  'custom-workflow': {
    id: 'custom-workflow',
    label: 'Custom ComfyUI workflow',
    summary: 'Run your own ComfyUI API workflow, for example MusicGen, DiffRhythm 2 or another audio model from custom nodes.',
    workspaces: ['effects', 'music'],
    execution: 'workflow',
    minSeconds: 1, maxSeconds: 600, durationControl: 'exact', maxPromptChars: 4000, maxSeed: uint32Max,
    supportsLyrics: true, supportsKey: true,
    recommendedVramGb: null,
    requiredNodes: ['SaveAudio'],
    source: 'https://docs.comfy.org/development/comfyui-server/comms_routes',
    license: 'Depends on the nodes and models in your workflow.',
    install: [
      'Install the custom nodes and models for your workflow in ComfyUI and check that it runs there.',
      'In ComfyUI, replace hard-coded values with placeholders such as {{prompt}}, {{seconds}} and {{seed}}.',
      'End with one Save Audio (FLAC) node, then use Workflow > Export (API) and import the JSON here.'
    ]
  }
}

export const profilesFor = (workspace: Workspace) => Object.values(modelProfiles).filter(profile => profile.workspaces.includes(workspace))
export const builtInRequiredNodes = [...new Set(Object.values(modelProfiles).flatMap(profile => profile.requiredNodes))]

export function estimateCostUsd(profile: ModelProfile, seconds: number) {
  return profile.provider ? Math.round(profile.provider.usdPerSecond * seconds * 100) / 100 : 0
}

// ---------- Custom workflows ----------

export type ComfyWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>

export const placeholders = ['prompt', 'negative', 'tags', 'lyrics', 'seconds', 'seed', 'bpm', 'key', 'title'] as const
export type Placeholder = typeof placeholders[number]
const placeholderPattern = /\{\{\s*([a-z]+)\s*\}\}/g
export const maxWorkflowBytes = 512 * 1024

export interface CustomWorkflow {
  name: string
  graph: ComfyWorkflow
  /** The single SaveAudio node whose FLAC output becomes the take. */
  outputNodeId: string
  placeholders: Placeholder[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const safeName = (value: unknown, max = 260): value is string =>
  typeof value === 'string' && value.length <= max && !/[\u0000-\u001f]/.test(value)

function collectPlaceholders(value: unknown, found: Set<string>, depth = 0) {
  if (depth > 8) throw new Error('The workflow is nested too deeply.')
  if (typeof value === 'string') for (const match of value.matchAll(placeholderPattern)) found.add(match[1])
  else if (Array.isArray(value)) value.forEach(item => collectPlaceholders(item, found, depth + 1))
  else if (isRecord(value)) Object.values(value).forEach(item => collectPlaceholders(item, found, depth + 1))
}

/** Validates a ComfyUI API-format workflow. Used on import and again at the IPC boundary. */
export function validateCustomWorkflow(value: unknown): CustomWorkflow {
  const fail = (detail: string): never => { throw new Error(detail) }
  if (!isRecord(value) || !safeName(value.name, 120) || !value.name.trim()) return fail('The workflow needs a name.')
  const graph = value.graph
  if (!isRecord(graph)) return fail('The workflow is not a ComfyUI API workflow.')
  if (Array.isArray((graph as Record<string, unknown>).nodes) || 'links' in graph) {
    return fail('This looks like a ComfyUI UI workflow. In ComfyUI choose Workflow > Export (API) and import that file.')
  }
  const ids = Object.keys(graph)
  if (ids.length === 0 || ids.length > 500) return fail('The workflow must contain between 1 and 500 nodes.')
  if (JSON.stringify(graph).length > maxWorkflowBytes) return fail('The workflow is larger than 512 KB.')
  const saveNodes: string[] = []
  for (const id of ids) {
    const node: unknown = graph[id]
    if (!/^[\w.:-]{1,64}$/.test(id) || !isRecord(node) || typeof node.class_type !== 'string' || !/^[\w .:+-]{1,120}$/.test(node.class_type) || !isRecord(node.inputs)) {
      return fail(`Node "${id.slice(0, 64)}" is not in ComfyUI API format.`)
    }
    for (const input of Object.values(node.inputs) as unknown[]) {
      if (Array.isArray(input) && input.length === 2 && typeof input[0] === 'string' && typeof input[1] === 'number' && !(input[0] in graph)) {
        return fail(`Node "${id}" links to missing node "${input[0]}".`)
      }
    }
    if (node.class_type === 'SaveAudio') saveNodes.push(id)
  }
  if (saveNodes.length !== 1) return fail('The workflow must contain exactly one Save Audio node. Sound Studio stores its FLAC output as the take.')
  const found = new Set<string>()
  collectPlaceholders(graph, found)
  const unknown = [...found].filter(name => !(placeholders as readonly string[]).includes(name))
  if (unknown.length) return fail(`Unknown placeholders: ${unknown.map(name => `{{${name}}}`).join(', ')}. Use ${placeholders.map(name => `{{${name}}}`).join(', ')}.`)
  if (!found.has('prompt') && !found.has('tags')) return fail('Add {{prompt}} or {{tags}} to a text input so your description reaches the model.')
  return {
    name: value.name.trim(),
    graph: graph as ComfyWorkflow,
    outputNodeId: saveNodes[0],
    placeholders: placeholders.filter(name => found.has(name))
  }
}

export function importCustomWorkflow(text: string, name: string): CustomWorkflow {
  if (text.length > maxWorkflowBytes) throw new Error('The workflow is larger than 512 KB.')
  let graph: unknown
  try { graph = JSON.parse(text) } catch { throw new Error('The file is not valid JSON.') }
  return validateCustomWorkflow({ name, graph })
}

// ---------- Backend settings ----------

export const defaultEndpoint = 'http://127.0.0.1:8188'
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Sound Studio only talks to a ComfyUI server on this device. */
export function normalizeEndpoint(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > 200) throw new Error('Enter the ComfyUI address, for example http://127.0.0.1:8188.')
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new Error('The ComfyUI address is not a valid URL. Use a form like http://127.0.0.1:8188.') }
  if (url.protocol !== 'http:') throw new Error('Use an http:// address for the local ComfyUI server.')
  if (!loopbackHosts.has(url.hostname)) throw new Error('Only ComfyUI running on this device (127.0.0.1, localhost or [::1]) is supported. Remote servers are not allowed.')
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Use only the scheme, host and port of the ComfyUI server, without a path or credentials.')
  }
  return url.origin
}

export interface ModelChoice { profileId: ModelProfileId; checkpoint: string; textEncoder: string; workflow: CustomWorkflow | null }

export interface BackendSettings {
  version: 1
  endpoint: string
  /** Set when the user explicitly connects; reconnects on launch until they disconnect. */
  connectOnLaunch: boolean
  models: Record<Workspace, ModelChoice>
}

export function createDefaultBackendSettings(): BackendSettings {
  const blank = { checkpoint: '', textEncoder: '', workflow: null }
  return {
    version: 1,
    endpoint: defaultEndpoint,
    connectOnLaunch: false,
    models: {
      effects: { profileId: 'stable-audio-open-1.0', ...blank },
      music: { profileId: 'ace-step-1.5-turbo', ...blank }
    }
  }
}

function parseModelChoice(value: unknown, workspace: Workspace): ModelChoice {
  if (!isRecord(value) || typeof value.profileId !== 'string' || !(value.profileId in modelProfiles)
    || !modelProfiles[value.profileId as ModelProfileId].workspaces.includes(workspace)
    || !safeName(value.checkpoint) || !safeName(value.textEncoder)) {
    throw new Error('The saved backend settings have an unsupported format.')
  }
  return {
    profileId: value.profileId as ModelProfileId, checkpoint: value.checkpoint, textEncoder: value.textEncoder,
    workflow: value.workflow == null ? null : validateCustomWorkflow(value.workflow)
  }
}

export function parseBackendSettings(serialized: string): BackendSettings {
  const value: unknown = JSON.parse(serialized)
  if (!isRecord(value) || value.version !== 1 || typeof value.endpoint !== 'string' || value.endpoint.length > 200
    || typeof value.connectOnLaunch !== 'boolean' || !isRecord(value.models)) {
    throw new Error('The saved backend settings have an unsupported format.')
  }
  return {
    version: 1, endpoint: value.endpoint, connectOnLaunch: value.connectOnLaunch,
    models: { effects: parseModelChoice(value.models.effects, 'effects'), music: parseModelChoice(value.models.music, 'music') }
  }
}

// ---------- Cloud partner access ----------

export interface CloudStatus {
  /** The user has explicitly allowed workflows with partner nodes to send prompts off this device. */
  enabled: boolean
  hasKey: boolean
  /** OS-backed encryption is required to store the Comfy.org API key. */
  encryptionAvailable: boolean
}

export interface CloudConfiguration { enabled: boolean; apiKey?: string | null }

export function validateCloudConfiguration(value: unknown): CloudConfiguration {
  if (!isRecord(value) || typeof value.enabled !== 'boolean') throw new Error('Invalid cloud configuration.')
  if (value.apiKey !== undefined && value.apiKey !== null
    && (typeof value.apiKey !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(value.apiKey.trim()))) {
    throw new Error('That does not look like a Comfy.org API key. Paste the full key without spaces.')
  }
  return { enabled: value.enabled, apiKey: typeof value.apiKey === 'string' ? value.apiKey.trim() : value.apiKey as null | undefined }
}

// ---------- Backend status, readiness and hardware guidance ----------

export interface BackendDevice { name: string; type: string; vramTotal: number; vramFree: number }

export interface BackendStatus {
  endpoint: string
  comfyuiVersion: string | null
  devices: BackendDevice[]
  checkpoints: string[]
  textEncoders: string[]
  clipTypes: string[]
  availableNodes: string[]
  /** Checked nodes that ComfyUI marks as partner (remote API) nodes. */
  apiNodes: string[]
  checkedAt: string
}

export interface WorkflowInspection { missingNodes: string[]; apiNodes: string[] }

export interface Readiness {
  ready: boolean
  /** True when generating sends the prompt to a third-party service. */
  remote: boolean
  checkpoint: string | null
  textEncoder: string | null
  issues: string[]
}

function pick(selected: string, available: string[], pattern: RegExp) {
  if (selected && available.includes(selected)) return selected
  return available.find(name => pattern.test(name)) ?? null
}

export function assessReadiness(choice: ModelChoice, status: BackendStatus | null, cloud: CloudStatus | null, inspection: WorkflowInspection | null = null): Readiness {
  const profile = modelProfiles[choice.profileId]
  const remote = profile.execution === 'cloud' || (profile.execution === 'workflow' && !!inspection?.apiNodes.length)
  const issues: string[] = []
  if (profile.execution === 'workflow' && !choice.workflow) issues.push('Import a ComfyUI API workflow in Model Settings.')
  if (!status) return { ready: false, remote, checkpoint: null, textEncoder: null, issues: ['Connect to a local ComfyUI server.', ...issues] }
  const missingNodes = profile.requiredNodes.filter(node => !status.availableNodes.includes(node))
  if (missingNodes.length) issues.push(`ComfyUI is missing nodes: ${missingNodes.join(', ')}. Update ComfyUI${profile.execution === 'workflow' ? ' or install the custom nodes' : ''}.`)
  if (profile.execution === 'workflow' && choice.workflow) {
    if (!inspection) issues.push('Checking the workflow nodes in ComfyUI...')
    else if (inspection.missingNodes.length) issues.push(`ComfyUI is missing nodes used by this workflow: ${inspection.missingNodes.join(', ')}. Install the custom nodes and restart ComfyUI.`)
  }
  if (remote && !(cloud?.enabled && cloud.hasKey)) {
    issues.push(profile.execution === 'cloud'
      ? `${profile.label} runs on ${profile.provider?.name}. Enable cloud partner models and store a Comfy.org API key in Model Settings.`
      : `This workflow uses partner nodes that send data off this device (${inspection?.apiNodes.join(', ')}). Enable cloud partner models in Model Settings to run it.`)
  }
  let checkpoint: string | null = null
  if (profile.checkpoint) {
    checkpoint = pick(choice.checkpoint, status.checkpoints, profile.checkpoint.pattern)
    if (!checkpoint) issues.push(`No ${profile.label} checkpoint found in ComfyUI/models/checkpoints.`)
    else if (choice.checkpoint && choice.checkpoint !== checkpoint) issues.push(`The selected checkpoint "${choice.checkpoint}" is no longer available.`)
  }
  let textEncoder: string | null = null
  if (profile.textEncoder) {
    textEncoder = pick(choice.textEncoder, status.textEncoders, profile.textEncoder.pattern)
    if (!textEncoder) issues.push('No T5-base text encoder found in ComfyUI/models/text_encoders.')
    else if (choice.textEncoder && choice.textEncoder !== textEncoder) issues.push(`The selected text encoder "${choice.textEncoder}" is no longer available.`)
    if (status.availableNodes.includes('CLIPLoader') && !status.clipTypes.includes(profile.textEncoder.clipType)) {
      issues.push(`This ComfyUI version's CLIPLoader does not support "${profile.textEncoder.clipType}". Update ComfyUI.`)
    }
  }
  return { ready: issues.length === 0, remote, checkpoint, textEncoder, issues }
}

export type HardwareFit = { level: 'likely' | 'tight' | 'cpu' | 'unknown' | 'remote'; text: string }

export function assessHardware(profile: ModelProfile, devices: BackendDevice[]): HardwareFit {
  if (profile.execution === 'cloud') return { level: 'remote', text: `Runs on ${profile.provider?.name} servers. Local hardware is not used for inference.` }
  if (profile.recommendedVramGb === null) return { level: 'unknown', text: 'Depends on the nodes and models in your workflow.' }
  const accelerated = devices.filter(device => device.type !== 'cpu' && device.vramTotal > 0)
  if (!devices.length) return { level: 'unknown', text: 'ComfyUI did not report a device.' }
  if (!accelerated.length) return { level: 'cpu', text: 'ComfyUI reports CPU only. Generation will be very slow.' }
  const best = accelerated.reduce((a, b) => (b.vramTotal > a.vramTotal ? b : a))
  const gb = Math.round(best.vramTotal / 1024 ** 3 * 10) / 10
  return gb >= profile.recommendedVramGb
    ? { level: 'likely', text: `Likely fits: ${gb} GB VRAM reported (about ${profile.recommendedVramGb} GB suggested).` }
    : { level: 'tight', text: `May not fit: ${gb} GB VRAM reported, about ${profile.recommendedVramGb} GB suggested. ComfyUI may offload and run slowly.` }
}

// ---------- Generation requests ----------

export interface GenerationRequest {
  workspace: Workspace
  title: string
  prompt: string
  category: string
  mood: string
  durationSeconds: number
  tempo: number | null
  musicKey: string
  seed: number
  loop: boolean
  instrumental: boolean
  lyrics: string
  profileId: ModelProfileId
  checkpoint: string
  textEncoder: string
  workflow: CustomWorkflow | null
}

export const maxSeed = uint32Max

export function randomSeed(max = uint32Max) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % (max + 1)
}

export function buildGenerationRequest(workspace: Workspace, draft: Draft, choice: ModelChoice, readiness: Pick<Readiness, 'checkpoint' | 'textEncoder'>, seed: number = 0):
  { request: GenerationRequest | null; problems: string[] } {
  const profile = modelProfiles[choice.profileId]
  const problems: string[] = []
  const prompt = draft.prompt.trim()
  if (!prompt) problems.push(`Describe your ${workspace === 'music' ? 'music' : 'sound'} first.`)
  else if (prompt.length > profile.maxPromptChars) problems.push(`${profile.label} accepts up to ${profile.maxPromptChars} characters of description.`)
  const duration = Number(draft.duration)
  if (draft.duration.trim() === '' || !Number.isFinite(duration) || duration < profile.minSeconds || duration > profile.maxSeconds) {
    problems.push(`Duration must be ${profile.minSeconds}-${profile.maxSeconds} seconds for ${profile.label}.`)
  }
  let tempo: number | null = null
  if (workspace === 'music') {
    tempo = Number(draft.tempo)
    if (!Number.isInteger(tempo) || tempo < 40 || tempo > 240) problems.push('Tempo must be a whole number from 40 to 240 BPM.')
  }
  let finalSeed = seed % (profile.maxSeed + 1)
  if (draft.seed.trim() !== '') {
    finalSeed = Number(draft.seed)
    if (!Number.isInteger(finalSeed) || finalSeed < 0 || finalSeed > profile.maxSeed) problems.push(`Seed must be a whole number from 0 to ${profile.maxSeed}, or empty for random.`)
  }
  const lyrics = draft.lyrics.trim()
  if (workspace === 'music' && !draft.instrumental) {
    if (!profile.supportsLyrics) problems.push(`${profile.label} cannot sing lyrics. Choose Instrumental only or a lyrics-capable model.`)
    else if (!lyrics) problems.push('Add lyrics, or choose Instrumental only.')
  }
  if (profile.checkpoint && !readiness.checkpoint) problems.push('Select an installed checkpoint in Model Settings.')
  if (profile.textEncoder && !readiness.textEncoder) problems.push('Select an installed text encoder in Model Settings.')
  if (profile.execution === 'workflow') {
    if (!choice.workflow) problems.push('Import a ComfyUI API workflow in Model Settings.')
    else if (workspace === 'effects' && (choice.workflow.placeholders.includes('bpm') || choice.workflow.placeholders.includes('key'))) {
      problems.push('This workflow uses {{bpm}} or {{key}}, which are only available in Music.')
    }
  }
  if (problems.length) return { request: null, problems }
  return {
    problems,
    request: {
      workspace, title: draft.title.trim(), prompt, category: draft.category, mood: draft.mood,
      durationSeconds: Math.round(duration * 10) / 10, tempo, musicKey: draft.musicKey, seed: finalSeed,
      loop: workspace === 'effects' && draft.loop, instrumental: workspace === 'music' && draft.instrumental,
      lyrics: workspace === 'music' && !draft.instrumental ? lyrics : '',
      profileId: profile.id,
      checkpoint: profile.checkpoint ? readiness.checkpoint! : '',
      textEncoder: profile.textEncoder ? readiness.textEncoder! : '',
      workflow: profile.execution === 'workflow' ? choice.workflow : null
    }
  }
}

/** Re-validates a request at the IPC boundary. Never trust the renderer's copy. */
export function validateGenerationRequest(value: unknown): GenerationRequest {
  const fail = (detail: string): never => { throw new Error(`Invalid generation request: ${detail}`) }
  if (!isRecord(value)) return fail('expected an object.')
  const workspace = value.workspace
  if (workspace !== 'effects' && workspace !== 'music') return fail('unknown workspace.')
  if (typeof value.profileId !== 'string' || !(value.profileId in modelProfiles)) return fail('unknown model profile.')
  const profile = modelProfiles[value.profileId as ModelProfileId]
  if (!profile.workspaces.includes(workspace)) return fail(`${profile.label} is not available for ${workspace}.`)
  if (typeof value.title !== 'string' || value.title.length > 120) return fail('title.')
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > profile.maxPromptChars) return fail('prompt.')
  if (typeof value.lyrics !== 'string' || value.lyrics.length > 4000) return fail('lyrics.')
  const categories: readonly string[] = workspace === 'effects' ? effectCategories : musicGenres
  if (typeof value.category !== 'string' || !categories.includes(value.category)) return fail('category.')
  if (typeof value.mood !== 'string' || !(musicMoods as readonly string[]).includes(value.mood)) return fail('mood.')
  if (typeof value.musicKey !== 'string' || !musicKeys.includes(value.musicKey)) return fail('key.')
  const duration = value.durationSeconds
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < profile.minSeconds || duration > profile.maxSeconds) return fail('duration.')
  if (workspace === 'music' ? !(typeof value.tempo === 'number' && Number.isInteger(value.tempo) && value.tempo >= 40 && value.tempo <= 240) : value.tempo !== null) return fail('tempo.')
  if (typeof value.seed !== 'number' || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > profile.maxSeed) return fail('seed.')
  if (typeof value.loop !== 'boolean' || typeof value.instrumental !== 'boolean') return fail('flags.')
  if (workspace === 'music' && !value.instrumental && (!profile.supportsLyrics || !value.lyrics.trim())) return fail('lyrics are required for vocal music.')
  if (!safeName(value.checkpoint) || (profile.checkpoint ? !value.checkpoint : value.checkpoint !== '')) return fail('checkpoint.')
  if (!safeName(value.textEncoder) || (profile.textEncoder ? !value.textEncoder : value.textEncoder !== '')) return fail('text encoder.')
  let workflow: CustomWorkflow | null = null
  if (profile.execution === 'workflow') {
    try { workflow = validateCustomWorkflow(value.workflow) } catch (error) { return fail(error instanceof Error ? error.message : 'workflow.') }
  } else if (value.workflow !== null) return fail('workflow.')
  return {
    workspace, title: value.title, prompt: value.prompt, category: value.category, mood: value.mood, durationSeconds: duration,
    tempo: value.tempo as number | null, musicKey: value.musicKey, seed: value.seed, loop: value.loop, instrumental: value.instrumental,
    lyrics: value.lyrics, profileId: profile.id, checkpoint: value.checkpoint, textEncoder: value.textEncoder, workflow
  }
}

// ---------- ComfyUI workflows (API format) ----------

export function describePrompt(request: GenerationRequest) {
  if (request.workspace === 'effects') {
    const category = request.category === 'General' ? '' : ` ${request.category} sound effect.`
    return {
      positive: `${request.prompt}${category}${request.loop ? ' Seamless loop.' : ''}`,
      negative: 'low quality, distorted, music',
      tags: [request.category === 'General' ? '' : request.category, request.loop ? 'seamless loop' : '', request.prompt].filter(Boolean).join(', ')
    }
  }
  const style = `${request.category}, ${request.mood}, ${request.tempo} BPM${request.instrumental ? ', instrumental' : ''}`
  return {
    positive: `${style}. ${request.prompt}`,
    negative: request.instrumental ? 'low quality, distorted, vocals, singing, speech' : 'low quality, distorted',
    tags: [request.category, request.mood, `${request.tempo} bpm`, request.instrumental ? 'instrumental' : '', request.prompt].filter(Boolean).join(', ')
  }
}

function fillPlaceholders(value: unknown, values: Record<Placeholder, string | number>): unknown {
  if (typeof value === 'string') {
    const whole = /^\{\{\s*([a-z]+)\s*\}\}$/.exec(value)
    if (whole && whole[1] in values) return values[whole[1] as Placeholder]
    return value.replace(placeholderPattern, (match, name: string) => (name in values ? String(values[name as Placeholder]) : match))
  }
  if (Array.isArray(value)) return value.map(item => fillPlaceholders(item, values))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillPlaceholders(item, values)]))
  return value
}

export function buildComfyWorkflow(request: GenerationRequest): { workflow: ComfyWorkflow; outputNodeId: string } {
  const prefix = `sound-studio/${request.workspace}`
  const text = describePrompt(request)
  const save = (audio: [string, number]) => ({ class_type: 'SaveAudio', inputs: { audio, filename_prefix: prefix } })
  switch (request.profileId) {
    case 'stable-audio-open-1.0':
      return {
        outputNodeId: '9',
        workflow: {
          1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: request.checkpoint } },
          2: { class_type: 'CLIPLoader', inputs: { clip_name: request.textEncoder, type: 'stable_audio' } },
          3: { class_type: 'CLIPTextEncode', inputs: { text: text.positive, clip: ['2', 0] } },
          4: { class_type: 'CLIPTextEncode', inputs: { text: text.negative, clip: ['2', 0] } },
          5: { class_type: 'ConditioningStableAudio', inputs: { positive: ['3', 0], negative: ['4', 0], seconds_start: 0, seconds_total: request.durationSeconds } },
          6: { class_type: 'EmptyLatentAudio', inputs: { seconds: request.durationSeconds, batch_size: 1 } },
          7: { class_type: 'KSampler', inputs: { model: ['1', 0], seed: request.seed, steps: 50, cfg: 4.98, sampler_name: 'dpmpp_3m_sde_gpu', scheduler: 'exponential', positive: ['5', 0], negative: ['5', 1], latent_image: ['6', 0], denoise: 1 } },
          8: { class_type: 'VAEDecodeAudio', inputs: { samples: ['7', 0], vae: ['1', 2] } },
          9: save(['8', 0])
        }
      }
    case 'ace-step-1.5-turbo':
      // Mirrors ComfyUI's official audio_ace_step_1_5_checkpoint template.
      return {
        outputNodeId: '8',
        workflow: {
          1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: request.checkpoint } },
          2: { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3 } },
          3: { class_type: 'TextEncodeAceStepAudio1.5', inputs: {
            clip: ['1', 1], tags: text.tags, lyrics: request.instrumental ? '[Instrumental]' : request.lyrics, seed: request.seed,
            bpm: request.tempo, duration: request.durationSeconds, timesignature: '4', language: 'en', keyscale: request.musicKey,
            generate_audio_codes: true, cfg_scale: 2, temperature: 0.85, top_p: 0.9, top_k: 0, min_p: 0
          } },
          4: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['3', 0] } },
          5: { class_type: 'EmptyAceStep1.5LatentAudio', inputs: { seconds: request.durationSeconds, batch_size: 1 } },
          6: { class_type: 'KSampler', inputs: { model: ['2', 0], seed: request.seed, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0], denoise: 1 } },
          7: { class_type: 'VAEDecodeAudio', inputs: { samples: ['6', 0], vae: ['1', 2] } },
          8: save(['7', 0])
        }
      }
    case 'ace-step-v1-3.5b':
      return {
        outputNodeId: '8',
        workflow: {
          1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: request.checkpoint } },
          2: { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift: 5 } },
          3: { class_type: 'TextEncodeAceStepAudio', inputs: { clip: ['1', 1], tags: text.tags, lyrics: request.instrumental ? '[instrumental]' : request.lyrics, lyrics_strength: 0.99 } },
          4: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['3', 0] } },
          5: { class_type: 'EmptyAceStepLatentAudio', inputs: { seconds: request.durationSeconds, batch_size: 1 } },
          6: { class_type: 'KSampler', inputs: { model: ['2', 0], seed: request.seed, steps: 50, cfg: 5, sampler_name: 'euler', scheduler: 'simple', positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0], denoise: 1 } },
          7: { class_type: 'VAEDecodeAudio', inputs: { samples: ['6', 0], vae: ['1', 2] } },
          8: save(['7', 0])
        }
      }
    case 'mirelo-sfx-2.0':
      // DynamicCombo inputs use dotted keys in ComfyUI's API format.
      return {
        outputNodeId: '2',
        workflow: {
          1: { class_type: 'MireloTextToSFX', inputs: { model: 'sfx-2.0', 'model.prompt': text.positive, 'model.negative_prompt': text.negative, 'model.duration': request.durationSeconds, 'model.seed': request.seed } },
          2: save(['1', 0])
        }
      }
    case 'seed-audio-1.0':
      return {
        outputNodeId: '2',
        workflow: {
          1: { class_type: 'ByteDanceSeedAudio', inputs: {
            text_prompt: `${text.positive} Sound effects and ambience only, no speech or music unless described. About ${request.durationSeconds} seconds long.`,
            reference_mode: 'text only', sample_rate: '48000', speech_rate: 0, loudness_rate: 0, pitch_rate: 0, seed: request.seed, model: 'seed-audio-1.0-multilingual'
          } },
          2: save(['1', 0])
        }
      }
    case 'custom-workflow': {
      const custom = request.workflow!
      const values: Record<Placeholder, string | number> = {
        prompt: text.positive, negative: text.negative, tags: text.tags, lyrics: request.lyrics,
        seconds: request.durationSeconds, seed: request.seed, bpm: request.tempo ?? 0, key: request.musicKey, title: request.title
      }
      const workflow = fillPlaceholders(custom.graph, values) as ComfyWorkflow
      workflow[custom.outputNodeId] = { ...workflow[custom.outputNodeId], inputs: { ...workflow[custom.outputNodeId].inputs, filename_prefix: prefix } }
      return { workflow, outputNodeId: custom.outputNodeId }
    }
  }
}

// ---------- ComfyUI responses ----------

export interface ComfyOutputFile { filename: string; subfolder: string; type: string }

export type HistoryOutcome =
  | { kind: 'pending' }
  | { kind: 'success'; file: ComfyOutputFile }
  | { kind: 'error'; message: string }
  | { kind: 'interrupted' }

const safeSegment = (value: unknown, allowEmpty: boolean): value is string =>
  typeof value === 'string' && (allowEmpty || value.length > 0) && value.length <= 255
  && !/[\u0000-\u001f]/.test(value) && !value.split(/[\\/]/).some(part => part === '..') && !/^[\\/]|^[a-zA-Z]:/.test(value)

/** Interprets a ComfyUI /history/{prompt_id} entry for the workflow's output node. */
export function interpretHistory(entry: unknown, outputNodeId: string): HistoryOutcome {
  if (!isRecord(entry)) return { kind: 'pending' }
  const status = isRecord(entry.status) ? entry.status : {}
  const messages = Array.isArray(status.messages) ? status.messages : []
  const event = (name: string) => messages.find(message => Array.isArray(message) && message[0] === name)?.[1]
  if (event('execution_interrupted')) return { kind: 'interrupted' }
  const failure = event('execution_error')
  if (status.status_str === 'error' || failure) {
    const detail = isRecord(failure) ? `${typeof failure.node_type === 'string' ? `${failure.node_type}: ` : ''}${typeof failure.exception_message === 'string' ? failure.exception_message.trim() : 'Unknown error'}` : 'Unknown error'
    return { kind: 'error', message: `ComfyUI could not generate this take. ${detail}`.slice(0, 1200) }
  }
  const outputs = isRecord(entry.outputs) ? entry.outputs : {}
  const node = isRecord(outputs[outputNodeId]) ? outputs[outputNodeId] : undefined
  const audio = node && Array.isArray(node.audio) ? node.audio[0] : undefined
  if (isRecord(audio)) {
    if (!safeSegment(audio.filename, false) || !safeSegment(audio.subfolder ?? '', true) || audio.type !== 'output') {
      return { kind: 'error', message: 'ComfyUI returned an unexpected output location.' }
    }
    return { kind: 'success', file: { filename: audio.filename, subfolder: (audio.subfolder as string | undefined) ?? '', type: 'output' } }
  }
  if (status.completed === true) return { kind: 'error', message: 'ComfyUI finished without returning audio.' }
  return { kind: 'pending' }
}

export function formatPromptError(body: unknown, statusCode: number): string {
  if (!isRecord(body)) return `ComfyUI rejected the workflow (HTTP ${statusCode}).`
  const parts: string[] = []
  if (isRecord(body.error) && typeof body.error.message === 'string') parts.push(body.error.message)
  if (isRecord(body.node_errors)) {
    for (const node of Object.values(body.node_errors)) {
      if (!isRecord(node) || !Array.isArray(node.errors)) continue
      for (const error of node.errors) {
        if (isRecord(error)) parts.push([node.class_type, error.message, error.details].filter(part => typeof part === 'string' && part).join(': '))
      }
    }
  }
  return `ComfyUI rejected the workflow. ${parts.join(' ') || `HTTP ${statusCode}.`}`.slice(0, 1200)
}

// ---------- Jobs and takes ----------

export type JobStatus = 'queued' | 'running' | 'failed' | 'cancelled' | 'completed'
export const activeStatuses: ReadonlyArray<JobStatus> = ['queued', 'running']

export interface JobState {
  id: string
  workspace: Workspace
  title: string
  profileLabel: string
  remote: boolean
  status: JobStatus
  message: string
  progress: { value: number; max: number } | null
  createdAt: string
  finishedAt: string | null
  takeId: string | null
}

export interface TakeRecord {
  version: 1
  id: string
  createdAt: string
  workspace: Workspace
  title: string
  audio: AudioInfo & { fileName: string }
  request: GenerationRequest
  model: { profileId: ModelProfileId; label: string; execution: Execution; checkpoint: string | null; textEncoder: string | null; workflowName: string | null; provider: string | null }
  backend: { type: 'comfyui'; endpoint: string; promptId: string; comfyuiVersion: string | null; output: ComfyOutputFile; remoteNodes: string[] }
  workflow: ComfyWorkflow
}

export const takeIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function parseTakeRecord(value: unknown): TakeRecord {
  if (!isRecord(value) || value.version !== 1 || typeof value.id !== 'string' || !takeIdPattern.test(value.id)
    || typeof value.createdAt !== 'string' || (value.workspace !== 'effects' && value.workspace !== 'music')
    || typeof value.title !== 'string' || !isRecord(value.audio) || typeof value.audio.fileName !== 'string'
    || !(value.audio.fileName === `${value.id}.flac` || value.audio.fileName === `${value.id}.wav`)
    || !isRecord(value.model) || !isRecord(value.backend) || !Array.isArray(value.backend.remoteNodes) || !isRecord(value.workflow)) {
    throw new Error('Unrecognized take record.')
  }
  validateGenerationRequest(value.request)
  return value as unknown as TakeRecord
}

export const takeDisplayTitle = (take: Pick<TakeRecord, 'title' | 'request'>) => take.title || take.request.prompt.slice(0, 60)

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
