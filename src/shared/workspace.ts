export type Workspace = 'effects' | 'music' | 'decomposer'
export type Step = 'brief' | 'generate' | 'review' | 'export'

export const workspaces: ReadonlyArray<{ id: Workspace; label: string }> = [
  { id: 'effects', label: 'Effects' },
  { id: 'music', label: 'Music' },
  { id: 'decomposer', label: 'Decomposer' }
]

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

export interface Draft {
  title: string
  prompt: string
  category: string
  mood: string
  duration: string
  tempo: string
  seed: string
  loop: boolean
  instrumental: boolean
  step: Step
}

export interface StudioState {
  version: 1
  workspace: Workspace
  drafts: Record<Workspace, Draft>
}

export function createInitialState(): StudioState {
  const common = { title: '', prompt: '', mood: 'Atmospheric', tempo: '90', seed: '', loop: false, instrumental: true, step: 'brief' as const }
  return {
    version: 1,
    workspace: 'effects',
    drafts: {
      effects: { ...common, category: 'General', duration: '5' },
      music: { ...common, category: 'Cinematic', duration: '30' },
      decomposer: { ...common, category: 'Full breakdown', duration: '30', loop: true, instrumental: false }
    }
  }
}

export const examples: Record<Workspace, ReadonlyArray<{ title: string; detail: string; prompt: string; category: string }>> = {
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
  const stemMode = draft.loop ? 'Preserve separated stem roles (drums, bass, accompaniment).' : 'Focus on full-mix arrangement.'
  const vocalMode = draft.instrumental ? 'Instrumental variation without vocals.' : 'Include vocal phrasing and lyric structure.'
  const header = `${draft.category} (${draft.mood}, ${draft.tempo || '90'} BPM)`
  const body = draft.prompt.trim() || 'Create a musical variation inspired by the analyzed reference track.'
  const composedPrompt = `${header}: ${body}\n\n${stemMode} ${vocalMode}`.slice(0, 4000)
  return {
    title: draft.title ? `${draft.title} (variation)`.slice(0, 120) : '',
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

function isDraft(value: unknown, workspace: Workspace): value is Draft {
  if (!isRecord(value)) return false
  const strings = ['title', 'prompt', 'category', 'mood', 'duration', 'tempo', 'seed'] as const
  const categories = workspace === 'effects' ? effectCategories : workspace === 'music' ? musicGenres : decomposerFocuses
  return strings.every(key => typeof value[key] === 'string' && value[key].length <= 4000)
    && typeof value.title === 'string' && value.title.length <= 120
    && typeof value.category === 'string'
    && [...categories].some(category => category === value.category)
    && musicMoods.some(mood => mood === value.mood)
    && typeof value.loop === 'boolean'
    && typeof value.instrumental === 'boolean'
    && steps.some(step => step.id === value.step)
}

export function parseStudioState(serialized: string): StudioState {
  const value: unknown = JSON.parse(serialized)
  if (!isRecord(value) || value.version !== 1 || !workspaces.some(item => item.id === value.workspace)
    || !isRecord(value.drafts) || !isDraft(value.drafts.effects, 'effects') || !isDraft(value.drafts.music, 'music')) {
    throw new Error('The saved draft has an unsupported format.')
  }
  const initial = createInitialState()
  const decomposer = value.drafts.decomposer === undefined ? initial.drafts.decomposer : value.drafts.decomposer
  if (!isDraft(decomposer, 'decomposer')) {
    throw new Error('The saved draft has an unsupported format.')
  }
  return {
    version: 1,
    workspace: value.workspace as Workspace,
    drafts: {
      effects: value.drafts.effects,
      music: value.drafts.music,
      decomposer
    }
  }
}
