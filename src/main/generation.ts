import { randomUUID } from 'node:crypto'
import { inspectAudio } from '../shared/audio'
import {
  activeStatuses, buildComfyWorkflow, interpretHistory, modelProfiles, outputNodeClass,
  type ComfyWorkflow, type GenerationRequest, type JobState
} from '../shared/generation'
import type { CloudAccess } from './cloud'
import { ComfyClient } from './comfyui'
import type { TakeStore } from './takes'

const pollMs = 1000
const jobTimeoutMs = 60 * 60 * 1000
const unreachableLimitMs = 60 * 1000
const keepFinished = 30

interface Job {
  state: JobState
  client: ComfyClient
  request: GenerationRequest
  workflow: ComfyWorkflow
  outputNodeId: string
  promptId: string | null
  comfyuiVersion: string | null
  remoteNodes: string[]
  cancelRequested: boolean
  socket: WebSocket | null
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Runs generation jobs against the user's ComfyUI. Only validated audio becomes a take. */
export class GenerationManager {
  private readonly jobs = new Map<string, Job>()

  constructor(private readonly cloud: CloudAccess, private readonly takes: TakeStore, private readonly publish: (job: JobState) => void) {}

  list(): JobState[] {
    return [...this.jobs.values()].map(job => ({ ...job.state }))
  }

  private update(job: Job, patch: Partial<JobState>) {
    job.state = { ...job.state, ...patch }
    if (!activeStatuses.includes(job.state.status)) {
      job.state.finishedAt ??= new Date().toISOString()
      job.socket?.close()
      job.socket = null
    }
    this.publish({ ...job.state })
    this.prune()
  }

  private prune() {
    const finished = [...this.jobs.values()].filter(job => !activeStatuses.includes(job.state.status))
    for (const job of finished.slice(0, Math.max(0, finished.length - keepFinished))) this.jobs.delete(job.state.id)
  }

  async start(endpoint: string, request: GenerationRequest): Promise<JobState> {
    const profile = modelProfiles[request.profileId]
    const client = new ComfyClient(endpoint)
    const comfyuiVersion = await client.version()
    // Prefer the WAV output node when ComfyUI has it: ComfyUI's own audio saving needs PyAV/FFmpeg, which some PCs lack.
    const output = (await client.nodeInfo(outputNodeClass)) ? outputNodeClass : 'SaveAudio'
    const { workflow, outputNodeId } = buildComfyWorkflow(request, output)
    const inspection = await client.inspectNodes(Object.values(workflow).map(node => node.class_type))
    if (inspection.missingNodes.length) {
      throw new Error(`ComfyUI is missing nodes: ${inspection.missingNodes.join(', ')}. Update ComfyUI or install the custom nodes, then check the connection again.`)
    }
    const remoteNodes = profile.execution === 'cloud'
      ? [...new Set([...inspection.apiNodes, ...profile.requiredNodes.filter(node => node !== 'SaveAudio')])]
      : inspection.apiNodes
    let apiKey: string | null = null
    if (remoteNodes.length) {
      apiKey = await this.cloud.apiKey()
      if (!apiKey) throw new Error(`This model sends your prompt off this device (${remoteNodes.join(', ')}). Enable cloud partner models and store a Comfy.org API key in Model Settings first.`)
    }
    const id = randomUUID()
    const job: Job = {
      state: {
        id, workspace: request.workspace, title: request.title || request.prompt.slice(0, 60), profileLabel: request.workflow?.name ?? profile.label,
        remote: remoteNodes.length > 0, status: 'queued', message: 'Sending to ComfyUI...', progress: null,
        createdAt: new Date().toISOString(), finishedAt: null, takeId: null
      },
      client, request, workflow, outputNodeId, promptId: null, comfyuiVersion, remoteNodes, cancelRequested: false, socket: null
    }
    this.jobs.set(id, job)
    this.watchProgress(job)
    try {
      job.promptId = await client.queuePrompt(workflow, id, apiKey)
    } catch (error) {
      this.update(job, { status: 'failed', message: errorText(error) })
      return { ...job.state }
    }
    this.update(job, { message: remoteNodes.length ? `Queued in ComfyUI. Will run on ${profile.provider?.name ?? 'a partner service'}.` : 'Queued in ComfyUI.' })
    if (job.cancelRequested) await this.cancelInComfy(job).catch(() => undefined)
    void this.monitor(job)
    return { ...job.state }
  }

  private watchProgress(job: Job) {
    if (typeof WebSocket !== 'function') return
    try {
      const socket = new WebSocket(job.client.websocketUrl(job.state.id))
      job.socket = socket
      socket.addEventListener('message', event => {
        if (typeof event.data !== 'string' || !activeStatuses.includes(job.state.status)) return
        try {
          const message = JSON.parse(event.data)
          const data = message?.data
          if (!data || data.prompt_id !== job.promptId) return
          if (message.type === 'progress' && Number.isFinite(data.value) && Number.isFinite(data.max) && data.max > 0) {
            this.update(job, { status: 'running', message: 'Generating...', progress: { value: Math.min(data.value, data.max), max: data.max } })
          } else if (message.type === 'execution_start' && job.state.status === 'queued') {
            this.update(job, { status: 'running', message: 'Generating...' })
          }
        } catch { /* Progress is best effort; polling decides the outcome. */ }
      })
      socket.addEventListener('error', () => { job.socket = null })
    } catch { job.socket = null }
  }

  private async monitor(job: Job) {
    const started = Date.now()
    let lastContact = Date.now()
    let absentPolls = 0
    while (activeStatuses.includes(job.state.status)) {
      await new Promise(resolve => setTimeout(resolve, pollMs))
      if (Date.now() - started > jobTimeoutMs) {
        await this.cancelInComfy(job).catch(() => undefined)
        this.update(job, { status: 'failed', message: 'Generation took longer than an hour and was stopped.' })
        return
      }
      try {
        const outcome = interpretHistory(await job.client.history(job.promptId!), job.outputNodeId)
        lastContact = Date.now()
        if (outcome.kind === 'interrupted') {
          this.update(job, job.cancelRequested ? { status: 'cancelled', message: 'Cancelled.' } : { status: 'failed', message: 'ComfyUI interrupted this job.' })
          return
        }
        if (outcome.kind === 'error') { this.update(job, { status: 'failed', message: outcome.message }); return }
        if (outcome.kind === 'success') { await this.finish(job, outcome.file); return }
        const place = await job.client.queueState(job.promptId!)
        if (place === 'absent') {
          absentPolls += 1
          if (absentPolls >= 3) {
            this.update(job, job.cancelRequested
              ? { status: 'cancelled', message: 'Cancelled before it started.' }
              : { status: 'failed', message: 'ComfyUI no longer has this job. It may have restarted.' })
            return
          }
        } else {
          absentPolls = 0
          if (place === 'running' && job.state.status === 'queued') this.update(job, { status: 'running', message: 'Generating...' })
        }
      } catch (error) {
        if (Date.now() - lastContact > unreachableLimitMs) {
          this.update(job, { status: 'failed', message: `Lost contact with ComfyUI. ${errorText(error)}` })
          return
        }
      }
    }
  }

  private async finish(job: Job, file: { filename: string; subfolder: string; type: string }) {
    this.update(job, { message: 'Checking the generated audio...' })
    try {
      const bytes = await job.client.download(file)
      inspectAudio(bytes)
      const profile = modelProfiles[job.request.profileId]
      const record = await this.takes.save(bytes, (id, fileName) => ({
        version: 1, id, createdAt: new Date().toISOString(), workspace: job.request.workspace, title: job.request.title,
        audio: { ...inspectAudio(bytes), fileName },
        request: job.request,
        model: {
          profileId: profile.id, label: profile.label, execution: profile.execution,
          checkpoint: job.request.checkpoint || null, textEncoder: job.request.textEncoder || null,
          workflowName: job.request.workflow?.name ?? null, provider: job.remoteNodes.length ? profile.provider?.name ?? 'Comfy.org partner node' : null
        },
        backend: { type: 'comfyui', endpoint: job.client.endpoint, promptId: job.promptId!, comfyuiVersion: job.comfyuiVersion, output: { ...file, type: 'output' }, remoteNodes: job.remoteNodes },
        workflow: job.workflow
      }))
      this.update(job, {
        status: 'completed', takeId: record.id, progress: null,
        message: job.cancelRequested ? 'Finished before cancellation took effect. The take was kept.' : 'Take ready.'
      })
    } catch (error) {
      this.update(job, { status: 'failed', message: `ComfyUI finished, but the audio could not be used. ${errorText(error)}` })
    }
  }

  private async cancelInComfy(job: Job) {
    if (!job.promptId) return
    const place = await job.client.queueState(job.promptId)
    if (place === 'pending') await job.client.deleteQueued(job.promptId)
    else if (place === 'running') await job.client.interrupt(job.promptId)
  }

  async cancel(id: string): Promise<JobState> {
    const job = this.jobs.get(id)
    if (!job) throw new Error('That job is no longer tracked.')
    if (!activeStatuses.includes(job.state.status)) return { ...job.state }
    job.cancelRequested = true
    this.update(job, { message: 'Cancelling...' })
    await this.cancelInComfy(job)
    return { ...job.state }
  }
}
