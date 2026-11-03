import { modelProfiles, type ModelProfileId, type Readiness } from './generation'

/** A model file Sound Studio can download into the user's ComfyUI after a native confirmation. */
export interface ModelDownload {
  id: string
  label: string
  profileId: ModelProfileId
  kind: 'checkpoint' | 'textEncoder'
  /** Folder under ComfyUI/models. */
  folder: 'checkpoints' | 'text_encoders'
  /** The file name written there, matching the profile's suggested name so it is found automatically. */
  file: string
  repo: string
  /** Pinned commit, so the size and hash below always describe the bytes served. */
  revision: string
  path: string
  bytes: number
  sha256: string
  license: string
  licenseUrl: string
}

export const modelDownloads: ReadonlyArray<ModelDownload> = [
  {
    id: 'stable-audio-open-1.0', label: 'Stable Audio Open 1.0', profileId: 'stable-audio-open-1.0', kind: 'checkpoint',
    folder: 'checkpoints', file: 'stable-audio-open-1.0.safetensors',
    repo: 'Comfy-Org/stable-audio-open-1.0', revision: '3eb100708b423cf59fc5bf2a152f5cc1e7718062', path: 'stable-audio-open-1.0.safetensors',
    bytes: 4853889016, sha256: '7b20458a071231aaf32613b6fbc7945f28f34dbba4f295bb49bad56f5f66b57e',
    license: 'Stability AI Community License', licenseUrl: 'https://huggingface.co/Comfy-Org/stable-audio-open-1.0/blob/main/LICENSE.md'
  },
  {
    id: 't5-base', label: 'T5-base text encoder', profileId: 'stable-audio-open-1.0', kind: 'textEncoder',
    folder: 'text_encoders', file: 't5-base.safetensors',
    repo: 'google-t5/t5-base', revision: 'a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1', path: 'model.safetensors',
    bytes: 891646390, sha256: 'a90903540cc02cbeb7ff9f823f1a80eb778c7e22426a0e620b01c77a5ec8f5b4',
    license: 'Apache-2.0', licenseUrl: 'https://huggingface.co/google-t5/t5-base'
  },
  {
    id: 'ace-step-1.5-turbo', label: 'ACE-Step 1.5 Turbo', profileId: 'ace-step-1.5-turbo', kind: 'checkpoint',
    folder: 'checkpoints', file: 'ace_step_1.5_turbo_aio.safetensors',
    repo: 'Comfy-Org/ACE-Step-1.5', revision: '371bb1680f8c88d8c1083f6ffb6330d3d55bff76', path: 'checkpoints/ace_step_1.5_turbo_aio.safetensors',
    bytes: 10025478736, sha256: '67b0f43aa5c51c840bd0228e6a935d8ff416ec87e5df2fc0637da17a561252bc',
    license: 'Apache-2.0', licenseUrl: 'https://huggingface.co/Comfy-Org/ACE-Step-1.5'
  },
  {
    id: 'ace-step-v1-3.5b', label: 'ACE-Step v1 3.5B', profileId: 'ace-step-v1-3.5b', kind: 'checkpoint',
    folder: 'checkpoints', file: 'ace_step_v1_3.5b.safetensors',
    repo: 'Comfy-Org/ACE-Step_ComfyUI_repackaged', revision: 'ea4f3d349e84d5c098cc8e8b904a30fde59fc99a', path: 'all_in_one/ace_step_v1_3.5b.safetensors',
    bytes: 7699743341, sha256: 'f07cad74c4adce52ca14ca1bdf74cf3c14cbafb0823b95eca4459467fa369f40',
    license: 'Apache-2.0', licenseUrl: 'https://huggingface.co/Comfy-Org/ACE-Step_ComfyUI_repackaged'
  }
]

for (const item of modelDownloads) {
  const expected = item.kind === 'checkpoint' ? modelProfiles[item.profileId].checkpoint?.suggested : modelProfiles[item.profileId].textEncoder?.suggested
  if (expected !== item.file) throw new Error(`Download ${item.id} does not match its profile's file name.`)
}

export const modelUrl = (item: ModelDownload) =>
  `https://huggingface.co/${item.repo}/resolve/${item.revision}/${item.path.split('/').map(encodeURIComponent).join('/')}`

export const formatBytes = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`

/** The downloadable files a profile still needs, judged from what ComfyUI actually reported. */
export function missingDownloads(profileId: ModelProfileId, readiness: Readiness, connected: boolean): ModelDownload[] {
  if (!connected) return []
  return modelDownloads.filter(item => item.profileId === profileId
    && (item.kind === 'checkpoint' ? !readiness.checkpoint : !readiness.textEncoder))
}

export const totalBytes = (items: ReadonlyArray<ModelDownload>) => items.reduce((sum, item) => sum + item.bytes, 0)

/** "A", "A and B", or "A, B, and C". */
export const listLabels = (items: ReadonlyArray<ModelDownload>) => new Intl.ListFormat('en', { type: 'conjunction' }).format(items.map(item => item.label))

export type DownloadPhase = 'idle' | 'downloading' | 'completed' | 'failed' | 'cancelled'

export interface DownloadStatus {
  phase: DownloadPhase
  /** Labels of the files in the current or last batch. */
  files: string[]
  /** The file being downloaded now. */
  current: string
  received: number
  total: number
  message: string
}

export const idleDownload: DownloadStatus = { phase: 'idle', files: [], current: '', received: 0, total: 0, message: '' }

export function validateDownloadIds(value: unknown): ModelDownload[] {
  if (!Array.isArray(value) || !value.length || value.length > modelDownloads.length) throw new Error('Choose models to download.')
  const items = value.map(id => {
    const item = modelDownloads.find(candidate => candidate.id === id)
    if (!item) throw new Error('Unknown model download.')
    return item
  })
  return [...new Set(items)]
}
