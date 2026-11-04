import { z } from 'zod'
import { captionModelSchema, defaultOptions, idSchema, stemSchema } from './decomposer'

/** Workspaces that generate audio. Generation, model, readiness, download and IPC code use only these. */
export type Workspace = 'effects' | 'music'
/** Decomposer analyses existing recordings and never reaches generation paths. */
export type StudioWorkspace = Workspace | 'decomposer'
export type Step = 'brief' | 'generate' | 'review' | 'export'

export const workspaces: ReadonlyArray<{ id: StudioWorkspace; label: string }> = [
  { id: 'effects', label: 'Effects' },
  { id: 'music', label: 'Music' },
  { id: 'decomposer', label: 'Decomposer' }
]

export function isGenerationWorkspace(workspace: StudioWorkspace): workspace is Workspace {
  return workspace === 'effects' || workspace === 'music'
}

export const steps: ReadonlyArray<{ id: Step; label: string }> = [
  { id: 'brief', label: 'Describe' },
  { id: 'generate', label: 'Generate' },
  { id: 'review', label: 'Review & refine' },
  { id: 'export', label: 'Export' }
]

export const effectCategories = ['General', 'Ambience', 'Interface', 'Foley', 'Impact', 'Sci-fi'] as const
export const musicGenres = ['Cinematic', 'Ambient', 'Electronic', 'Orchestral', 'Lo-fi', 'Acoustic'] as const
export const decomposerFocuses = ['Full breakdown', 'Stems & arrangement', 'Tempo & harmony', 'Lyrics & vocals', 'Variation brief'] as const
export const musicMoods = ['Atmospheric', 'Calm', 'Uplifting', 'Tense', 'Melancholic', 'Playful'] as const
const keyRoots = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'] as const
/** Matches ACE-Step 1.5's keyscale options in ComfyUI. */
export const musicKeys: ReadonlyArray<string> = ['major', 'minor'].flatMap(quality => keyRoots.map(root => `${root} ${quality}`))

export interface Draft {
  title: string
  prompt: string
  category: string
  mood: string
  duration: string
  tempo: string
  seed: string
  lyrics: string
  musicKey: string
  loop: boolean
  instrumental: boolean
  step: Step
}

export const studioStateVersion = 4

export interface StudioState {
  version: typeof studioStateVersion
  workspace: StudioWorkspace
  drafts: Record<StudioWorkspace, Draft>
  decomposition: DecompositionDraft
}

const legacyDecompositionDraftSchema = z.object({
  assetId: idSchema.nullable(), analysisId: idSchema.nullable(),
  start: z.number().finite().min(0).max(1800), end: z.number().finite().min(0).max(1800),
  stems: z.array(stemSchema).max(4),
  lyrics: z.enum(['none', 'tiny', 'base']), wordTimestamps: z.boolean(), notes: z.boolean(), captions: z.boolean()
}).strict()
const decompositionDraftSchema = legacyDecompositionDraftSchema.extend({ captionModel: captionModelSchema })
export type DecompositionDraft = z.infer<typeof decompositionDraftSchema>

export function createInitialState(): StudioState {
  const common = { title: '', prompt: '', mood: 'Atmospheric', tempo: '90', seed: '', lyrics: '', musicKey: 'C major', loop: false, instrumental: true, step: 'brief' as const }
  return {
    version: studioStateVersion,
    workspace: 'effects',
    decomposition: { assetId: null, analysisId: null, ...defaultOptions },
    drafts: {
      effects: { ...common, category: 'General', duration: '5' },
      music: { ...common, category: 'Cinematic', duration: '30' },
      decomposer: { ...common, category: 'Full breakdown', duration: '30', loop: true, instrumental: false }
    }
  }
}

export const examples: Record<StudioWorkspace, ReadonlyArray<{ title: string; detail: string; prompt: string; category: string }>> = {
  effects: [
    { title: 'A world in the rain', detail: 'AMBIENCE', prompt: 'Soft rain falling through a forest canopy, distant birds and a gentle breeze. An immersive, seamless background loop without voices.', category: 'Ambience' },
    { title: 'A little level-up', detail: 'INTERFACE', prompt: 'A bright, satisfying level-up chime. Three ascending crystalline notes with a soft shimmer and a clean, short tail.', category: 'Interface' },
    { title: 'Something from space', detail: 'SCI-FI', prompt: 'A heavy science-fiction door sliding open. A low mechanical hum, a pneumatic release, then a solid metallic stop.', category: 'Sci-fi' }
  ],
  music: [
    { title: 'Beyond the horizon', detail: 'CINEMATIC', prompt: 'An expansive instrumental score for exploring a new world. Warm strings, delicate piano and a slow, hopeful build. No vocals.', category: 'Cinematic' },
    { title: 'After-hours thinking', detail: 'LO-FI', prompt: 'A relaxed lo-fi instrumental with dusty drums, soft electric piano and warm bass. Understated and unhurried. No vocals.', category: 'Lo-fi' },
    { title: 'A place to drift', detail: 'AMBIENT', prompt: 'A spacious ambient instrumental with evolving synthesizer pads and delicate, distant textures. Calm and atmospheric. No vocals.', category: 'Ambient' }
  ],
  decomposer: [
    { title: 'Midnight synthwave study', detail: 'STEMS & GROOVE', prompt: 'Isolate drums, analog bassline and lead synth arpeggio. Map the four-on-the-floor groove, gated snare reverb and 8-bar intro-to-chorus transition for a variation brief.', category: 'Stems & arrangement' },
    { title: 'Glass harbor theme', detail: 'HARMONY', prompt: 'Trace the piano chord voicings, felt-piano timbre, tempo rubato and string swell entry points so a variation can preserve the harmonic movement with new instrumentation.', category: 'Tempo & harmony' },
    { title: 'Starlight verse & hook', detail: 'LYRICS & VOCALS', prompt: 'Separate the lead vocal stem, transcribe verse and chorus lyrics with line timestamps, and note breathy delivery, harmony doubles and reverb tail length.', category: 'Lyrics & vocals' }
  ]
}

export function buildVariationBrief(draft: Draft): { title: string; prompt: string; tempo: string; mood: string; duration: string; instrumental: boolean } {
  const stemMode = 'No audio has been analysed; instrument and arrangement requests below are intentions only.'
  const vocalMode = draft.instrumental ? 'Requested direction: instrumental.' : 'Requested direction: consider vocal phrasing and lyric structure.'
  const header = `${draft.category} (${draft.mood}, ${draft.tempo || '90'} BPM)`
  const body = draft.prompt || 'No analysis goal supplied.'
  const composedPrompt = `Unanalysed intent\n${header}: ${body}\n\n${stemMode} ${vocalMode}`
  return {
    title: draft.title,
    prompt: composedPrompt,
    tempo: draft.tempo,
    mood: draft.mood,
    duration: draft.duration,
    instrumental: draft.instrumental
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDraft(value: unknown, workspace: StudioWorkspace): value is Draft {
  if (!isRecord(value)) return false
  const strings = ['title', 'prompt', 'category', 'mood', 'duration', 'tempo', 'seed', 'lyrics'] as const
  const categories = workspace === 'effects' ? effectCategories : workspace === 'music' ? musicGenres : decomposerFocuses
  return strings.every(key => typeof value[key] === 'string' && value[key].length <= (key === 'prompt' && workspace === 'music' ? 200000 : 4000))
    && typeof value.title === 'string' && value.title.length <= 120
    && typeof value.category === 'string'
    && [...categories].some(category => category === value.category)
    && musicMoods.some(mood => mood === value.mood)
    && typeof value.musicKey === 'string' && musicKeys.includes(value.musicKey)
    && typeof value.loop === 'boolean'
    && typeof value.instrumental === 'boolean'
    && steps.some(step => step.id === value.step)
}

function migrateDraft(value: unknown, addGenerationFields: boolean) {
  return addGenerationFields && isRecord(value) && !('lyrics' in value) && !('musicKey' in value) ? { ...value, lyrics: '', musicKey: 'C major' } : value
}

export function parseStudioState(serialized: string): StudioState {
  const value: unknown = JSON.parse(serialized)
  if (!isRecord(value) || ![1, 2, 3, studioStateVersion].includes(Number(value.version)) || typeof value.version !== 'number') throw new Error('The saved draft has an unsupported format.')
  const workspace = workspaces.find(item => item.id === value.workspace)?.id
  const initial = createInitialState()
  // Both parallel v2 shapes and v3 retain their original caption-model choice.
  const hasAnalysisDraft = value.decomposition !== undefined
  const addGenerationFields = value.version === 1 || (value.version === 2 && hasAnalysisDraft)
  const drafts = isRecord(value.drafts) ? {
    effects: migrateDraft(value.drafts.effects, addGenerationFields),
    music: migrateDraft(value.drafts.music, addGenerationFields),
    decomposer: value.drafts.decomposer === undefined && value.version <= 2 ? initial.drafts.decomposer : migrateDraft(value.drafts.decomposer, addGenerationFields)
  } : undefined
  if (!workspace || !drafts || !isDraft(drafts.effects, 'effects') || !isDraft(drafts.music, 'music') || !isDraft(drafts.decomposer, 'decomposer')) {
    throw new Error('The saved draft has an unsupported format.')
  }
  const decomposition = hasAnalysisDraft || value.version >= 3
    ? value.version === studioStateVersion
      ? decompositionDraftSchema.parse(value.decomposition)
      : { ...legacyDecompositionDraftSchema.parse(value.decomposition), captionModel: 'captions' as const }
    : value.drafts && isRecord(value.drafts) && value.drafts.decomposer !== undefined ? {
      ...initial.decomposition,
      stems: drafts.decomposer.loop ? ['vocals', 'drums', 'bass', 'other'] as const : [],
      lyrics: drafts.decomposer.instrumental ? 'none' as const : 'tiny' as const,
      end: Number(drafts.decomposer.duration) > 0 && Number(drafts.decomposer.duration) <= 1800 ? Number(drafts.decomposer.duration) : 30
    } : initial.decomposition
  return { version: studioStateVersion, workspace, drafts: { effects: drafts.effects, music: drafts.music, decomposer: drafts.decomposer }, decomposition: decompositionDraftSchema.parse(decomposition) }
}
