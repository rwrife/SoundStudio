import type { AudioInfo } from './audio'
import type { BackendStatus, CloudConfiguration, CloudStatus, ComfyWorkflow, GenerationRequest, JobState, Result, TakeRecord, WorkflowInspection } from './generation'
import type { LauncherStatus } from './launcher'

export interface TakeList { takes: TakeRecord[]; unreadable: number }
export interface TakeAudio { bytes: Uint8Array; mimeType: string; info: AudioInfo }

/** The complete surface the renderer can reach. Main validates every argument. */
export interface SoundStudioBridge {
  platform: string
  checkBackend(endpoint: string): Promise<Result<BackendStatus>>
  getLauncher(): Promise<Result<LauncherStatus>>
  /** Opens a native folder picker in the main process; the renderer never supplies a path. */
  chooseComfyFolder(): Promise<Result<LauncherStatus>>
  startComfy(endpoint: string): Promise<Result<LauncherStatus>>
  stopComfy(): Promise<Result<LauncherStatus>>
  /** Installs Sound Studio's WAV output node into the detected ComfyUI and restarts it if Sound Studio started it. */
  installOutputNode(): Promise<Result<LauncherStatus>>
  showComfyLog(): Promise<Result<void>>
  onLauncherUpdate(listener: (status: LauncherStatus) => void): () => void
  inspectWorkflow(endpoint: string, workflow: ComfyWorkflow): Promise<Result<WorkflowInspection>>
  getCloudStatus(): Promise<Result<CloudStatus>>
  configureCloud(configuration: CloudConfiguration): Promise<Result<CloudStatus>>
  startGeneration(endpoint: string, request: GenerationRequest): Promise<Result<JobState>>
  cancelGeneration(jobId: string): Promise<Result<JobState>>
  listJobs(): Promise<Result<JobState[]>>
  onJobUpdate(listener: (job: JobState) => void): () => void
  listTakes(): Promise<Result<TakeList>>
  readTakeAudio(takeId: string): Promise<Result<TakeAudio>>
  exportTake(takeId: string): Promise<Result<string | null>>
  deleteTake(takeId: string): Promise<Result<boolean>>
}

export const channels = {
  checkBackend: 'backend:check',
  launcherStatus: 'launcher:status',
  launcherFolder: 'launcher:folder',
  launcherStart: 'launcher:start',
  launcherStop: 'launcher:stop',
  launcherNode: 'launcher:node',
  launcherLog: 'launcher:log',
  launcherUpdate: 'launcher:update',
  inspectWorkflow: 'workflow:inspect',
  cloudStatus: 'cloud:status',
  cloudConfigure: 'cloud:configure',
  startGeneration: 'generation:start',
  cancelGeneration: 'generation:cancel',
  listJobs: 'generation:list',
  jobUpdate: 'generation:update',
  listTakes: 'takes:list',
  takeAudio: 'takes:audio',
  exportTake: 'takes:export',
  deleteTake: 'takes:delete'
} as const
