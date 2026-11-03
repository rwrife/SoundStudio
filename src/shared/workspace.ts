export type Workspace = 'effects' | 'music'
export type Step = 'brief' | 'generate' | 'review' | 'export'

export const steps: ReadonlyArray<{ id: Step; label: string }> = [
  { id: 'brief', label: 'Describe' },
  { id: 'generate', label: 'Generate' },
  { id: 'review', label: 'Review & refine' },
  { id: 'export', label: 'Export' }
]

export const effectCategories = ['General', 'Ambience', 'Interface', 'Foley', 'Impact', 'Sci-fi'] as const
export const musicGenres = ['Cinematic', 'Ambient', 'Electronic', 'Orchestral', 'Lo-fi', 'Acoustic'] as const
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
      music: { ...common, category: 'Cinematic', duration: '30' }
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
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDraft(value: unknown, workspace: Workspace): value is Draft {
  if (!isRecord(value)) return false
  const strings = ['title', 'prompt', 'category', 'mood', 'duration', 'tempo', 'seed'] as const
  return strings.every(key => typeof value[key] === 'string' && value[key].length <= 4000)
    && typeof value.title === 'string' && value.title.length <= 120
    && typeof value.category === 'string'
    && (workspace === 'effects' ? [...effectCategories] : [...musicGenres]).some(category => category === value.category)
    && musicMoods.some(mood => mood === value.mood)
    && typeof value.loop === 'boolean'
    && typeof value.instrumental === 'boolean'
    && steps.some(step => step.id === value.step)
}

export function parseStudioState(serialized: string): StudioState {
  const value: unknown = JSON.parse(serialized)
  if (!isRecord(value) || value.version !== 1 || (value.workspace !== 'effects' && value.workspace !== 'music')
    || !isRecord(value.drafts) || !isDraft(value.drafts.effects, 'effects') || !isDraft(value.drafts.music, 'music')) {
    throw new Error('The saved draft has an unsupported format.')
  }
  return { version: 1, workspace: value.workspace, drafts: { effects: value.drafts.effects, music: value.drafts.music } }
}
