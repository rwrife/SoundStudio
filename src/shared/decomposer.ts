import { z } from 'zod'

export const idSchema = z.uuid()
export const stemSchema = z.enum(['vocals', 'drums', 'bass', 'other'])
export const profileSchema = z.enum(['core', 'stems', 'lyrics-tiny', 'lyrics-base', 'notes', 'captions', 'captions-native'])
export const captionModelSchema = z.enum(['captions', 'captions-native'])
export const captionLabels = {
  captions: 'Qwen2-Audio (unverified)',
  'captions-native': 'Qwen2.5-Omni Q4'
} as const
export type Profile = z.infer<typeof profileSchema>
export type Stem = z.infer<typeof stemSchema>
const seconds = z.number().finite().min(0).max(1800)
const text = z.string().max(20000)
export const timedTextSchema = z.object({ start: seconds, end: seconds, text }).strict()
  .refine(value => value.end >= value.start, 'End must follow start')
const legacyOptionsBase = z.object({
  start: seconds,
  end: seconds,
  stems: z.array(stemSchema).max(4).refine(items => new Set(items).size === items.length),
  lyrics: z.enum(['none', 'tiny', 'base']),
  wordTimestamps: z.boolean(),
  notes: z.boolean(),
  captions: z.boolean()
}).strict()
const validExcerpt = (value: { start: number; end: number }) => value.end > value.start && value.end - value.start <= 600
export const legacyOptionsSchema = legacyOptionsBase.refine(validExcerpt, 'Select an excerpt of up to 10 minutes')
export const optionsSchema = legacyOptionsBase.extend({ captionModel: captionModelSchema })
  .refine(validExcerpt, 'Select an excerpt of up to 10 minutes')
  .refine(value => !value.captions || value.captionModel !== 'captions-native' || value.end - value.start >= 1,
    'Native captions require an excerpt of at least one second')
export type AnalysisOptions = z.infer<typeof optionsSchema>
export const defaultOptions: AnalysisOptions = {
  start: 0, end: 30, stems: [], lyrics: 'none', wordTimestamps: false, notes: false, captions: false, captionModel: 'captions'
}
export const audioMetadataSchema = z.object({
  duration: z.number().finite().positive().max(1800),
  sampleRate: z.number().int().min(8000).max(192000),
  channels: z.number().int().min(1).max(2),
  peaks: z.array(z.number().finite().min(0).max(1)).min(1).max(1600)
}).strict()
export const assetSchema = audioMetadataSchema.extend({
  id: idSchema, name: z.string().min(1).max(255), hash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime()
}).strict()
export type Asset = z.infer<typeof assetSchema>
export const reviewSchema = z.object({
  tempo: z.number().finite().min(1).max(400).nullable(),
  key: z.string().max(120),
  chords: z.array(timedTextSchema).max(2000),
  sections: z.array(timedTextSchema).max(2000),
  descriptions: z.array(timedTextSchema).max(2000),
  lyrics: z.array(timedTextSchema).max(5000)
}).strict()
export type Review = z.infer<typeof reviewSchema>
export const resultSchema = reviewSchema.extend({
  beats: z.array(seconds).max(20000),
  energy: z.array(z.object({ time: seconds, rms: z.number().finite().min(0).max(10) }).strict()).max(6000),
  stems: z.array(stemSchema).max(4),
  midi: z.boolean(),
  warnings: z.array(z.string().max(2000)).max(100),
  provenance: z.array(z.object({
    stage: z.string().max(80), model: z.string().max(200), revision: z.string().max(200),
    seconds: z.number().finite().min(0), details: z.string().max(4000)
  }).strict()).max(30)
}).strict()
export type AnalysisResult = z.infer<typeof resultSchema>
export const jobSchema = z.object({
  id: idSchema, assetId: idSchema, title: z.string().max(120),
  state: z.enum(['queued', 'running', 'failed', 'cancelled', 'completed']),
  progress: z.number().min(0).max(1), stage: z.string().max(300),
  error: z.string().max(4000).nullable(), createdAt: z.iso.datetime(),
  options: optionsSchema, raw: resultSchema.nullable(), reviewed: reviewSchema.nullable(),
  revision: z.number().int().nonnegative()
}).strict()
export type AnalysisJob = z.infer<typeof jobSchema>
export const runtimeSchema = z.object({
  busy: z.boolean(), message: z.string(), error: z.string().nullable(),
  python: z.string().nullable(), platform: z.string(), memoryGiB: z.number(),
  profiles: z.array(z.object({
    id: profileSchema, label: z.string(), ready: z.boolean(), detail: z.string(),
    download: z.string(), license: z.string()
  }).strict())
}).strict()
export type RuntimeStatus = z.infer<typeof runtimeSchema>
export interface LibrarySnapshot { assets: Asset[]; jobs: AnalysisJob[]; errors: string[] }
export type ExportKind = 'json' | 'markdown' | 'lrc' | 'srt' | 'midi' | 'stems' | 'all'
export const exportKindSchema = z.enum(['json', 'markdown', 'lrc', 'srt', 'midi', 'stems', 'all'])
export interface DecomposerApi {
  library(): Promise<LibrarySnapshot>
  importAudio(): Promise<Asset | null>
  start(input: { assetId: string; title: string; options: AnalysisOptions }): Promise<AnalysisJob>
  cancel(id: string): Promise<void>
  review(input: { id: string; revision: number; reviewed: Review }): Promise<AnalysisJob>
  export(input: { id: string; kind: ExportKind }): Promise<string | null>
  runtime(): Promise<RuntimeStatus>
  install(profile: Profile): Promise<void>
  cancelInstall(): Promise<void>
}
export function mediaUrl(id: string, track: 'reference' | Stem): string {
  return `soundstudio://media/${idSchema.parse(id)}/${track}`
}
export function reviewedBrief(job: AnalysisJob): string {
  const review = job.reviewed ?? job.raw
  if (job.state !== 'completed' || !review) throw new Error('No completed analysis to transfer.')
  return [
    `Reference analysis: ${job.title || 'Untitled'} [${job.id}]`,
    `Excerpt ${job.options.start.toFixed(2)}-${job.options.end.toFixed(2)} seconds. Estimates and user edits, not verified musical truth.`,
    `Tempo: ${review.tempo ?? 'unknown'} BPM; key: ${review.key || 'unknown'}.`,
    ...(['chords', 'sections', 'descriptions', 'lyrics'] as const).map(key =>
      `${key}:\n${review[key].map(line => `[${line.start.toFixed(2)}-${line.end.toFixed(2)}] ${line.text}`).join('\n')}`)
  ].join('\n\n')
}
