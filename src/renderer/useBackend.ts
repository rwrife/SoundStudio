import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  assessReadiness, createDefaultBackendSettings, modelProfiles, normalizeEndpoint, parseBackendSettings,
  type BackendSettings, type BackendStatus, type CloudConfiguration, type CloudStatus, type GenerationRequest,
  type JobState, type ModelChoice, type Readiness, type Result, type TakeRecord, type WorkflowInspection
} from '../shared/generation'
import type { Workspace } from '../shared/workspace'
import type { LauncherStatus } from '../shared/launcher'
import { idleDownload, missingDownloads, type DownloadStatus, type ModelDownload } from '../shared/modelDownloads'

export const backendStorageKey = 'sound-studio.backend.v1'

export type Connection =
  | { state: 'disconnected' }
  | { state: 'checking' }
  | { state: 'connected'; status: BackendStatus }
  | { state: 'error'; error: string }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(result.error)
  return result.value
}

/** Renderer state for the ComfyUI connection, model choices, cloud opt-in, jobs and takes. All work happens in main. */
export function useBackend() {
  const bridge = window.soundStudio
  const [loaded] = useState(() => {
    try {
      const saved = localStorage.getItem(backendStorageKey)
      return { settings: saved ? parseBackendSettings(saved) : createDefaultBackendSettings(), error: '' }
    } catch (error) {
      return { settings: createDefaultBackendSettings(), error: `Could not read your saved model settings (${message(error)}). Defaults are in use; your stored copy is kept until you change a setting.` }
    }
  })
  const [settings, setSettingsState] = useState(loaded.settings)
  const [settingsError, setSettingsError] = useState(loaded.error)
  const dirty = useRef(!loaded.error)
  const [connection, setConnection] = useState<Connection>({ state: 'disconnected' })
  const [cloud, setCloud] = useState<CloudStatus | null>(null)
  const [inspections, setInspections] = useState<Record<Workspace, WorkflowInspection | null>>({ effects: null, music: null })
  const [inspectionErrors, setInspectionErrors] = useState<Record<Workspace, string>>({ effects: '', music: '' })
  const [jobs, setJobs] = useState<JobState[]>([])
  const [takes, setTakes] = useState<TakeRecord[]>([])
  const [unreadableTakes, setUnreadableTakes] = useState(0)
  const [takesError, setTakesError] = useState('')

  const setSettings = useCallback((update: (current: BackendSettings) => BackendSettings) => {
    dirty.current = true
    setSettingsState(update)
  }, [])

  useEffect(() => {
    if (!dirty.current) return
    try {
      localStorage.setItem(backendStorageKey, JSON.stringify(settings))
      setSettingsError('')
    } catch (error) {
      setSettingsError(`Model settings could not be saved. ${message(error)}`)
    }
  }, [settings])

  const refreshTakes = useCallback(async () => {
    if (!bridge) return
    try {
      const list = await unwrap(bridge.listTakes())
      setTakes(list.takes)
      setUnreadableTakes(list.unreadable)
      setTakesError('')
    } catch (error) {
      setTakesError(`Could not load your takes. ${message(error)}`)
    }
  }, [bridge])

  const check = useCallback(async (endpoint: string) => {
    if (!bridge) return
    setConnection({ state: 'checking' })
    try {
      setConnection({ state: 'connected', status: await unwrap(bridge.checkBackend(endpoint)) })
    } catch (error) {
      setConnection({ state: 'error', error: message(error) })
    }
  }, [bridge])

  const connect = useCallback(async (raw: string) => {
    let endpoint: string
    try { endpoint = normalizeEndpoint(raw) } catch (error) {
      setConnection({ state: 'error', error: message(error) })
      return
    }
    setSettings(current => ({ ...current, endpoint, connectOnLaunch: true }))
    await check(endpoint)
  }, [check, setSettings])

  const disconnect = useCallback(() => {
    setSettings(current => ({ ...current, connectOnLaunch: false }))
    setConnection({ state: 'disconnected' })
  }, [setSettings])

  const [launcher, setLauncher] = useState<LauncherStatus | null>(null)
  const [launcherError, setLauncherError] = useState('')
  /** Set by one-click start, so the missing default models are offered once ComfyUI reports what it has. */
  const offerModels = useRef(false)

  /** One click: starts the user's ComfyUI (or finds it already running), then connects to it. */
  const startComfy = useCallback(async (raw: string) => {
    if (!bridge) return
    let endpoint: string
    try { endpoint = normalizeEndpoint(raw) } catch (error) {
      setLauncherError(message(error))
      return
    }
    setLauncherError('')
    try {
      setSettings(current => ({ ...current, endpoint, connectOnLaunch: true }))
      setLauncher(await unwrap(bridge.startComfy(endpoint)))
    } catch (error) {
      setLauncherError(message(error))
      return
    }
    offerModels.current = true
    await check(endpoint)
  }, [bridge, check, setSettings])

  const stopComfy = useCallback(async () => {
    if (!bridge) return
    setLauncherError('')
    try {
      setLauncher(await unwrap(bridge.stopComfy()))
      setConnection({ state: 'disconnected' })
    } catch (error) {
      setLauncherError(message(error))
    }
  }, [bridge])

  const installOutputNode = useCallback(async () => {
    if (!bridge) return
    setLauncherError('')
    try {
      setLauncher(await unwrap(bridge.installOutputNode()))
    } catch (error) {
      setLauncherError(message(error))
      return
    }
    await check(settings.endpoint)
  }, [bridge, check, settings.endpoint])

  const launcherAction = useCallback(async (run: () => Promise<Result<LauncherStatus>>) => {
    setLauncherError('')
    try { setLauncher(await unwrap(run())) } catch (error) { setLauncherError(message(error)) }
  }, [])

  const launchHandled = useRef(false)
  useEffect(() => {
    if (!bridge) return
    const unsubscribe = bridge.onLauncherUpdate(status => {
      setLauncher(status)
      if (status.phase === 'exited') setConnection(current => current.state === 'connected' ? { state: 'error', error: status.message } : current)
    })
    if (!launchHandled.current) {
      launchHandled.current = true
      void bridge.getLauncher().then(async result => {
        if (result.ok) setLauncher(result.value)
        if (loaded.settings.connectOnLaunch) await check(loaded.settings.endpoint)
      })
    }
    return unsubscribe
  }, [bridge, check, loaded.settings])

  useEffect(() => {
    if (!bridge) return
    const unsubscribe = bridge.onJobUpdate(job => {
      setJobs(current => [...current.filter(item => item.id !== job.id), job].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
      if (job.status === 'completed') void refreshTakes()
    })
    void bridge.getCloudStatus().then(result => { if (result.ok) setCloud(result.value) })
    void bridge.listJobs().then(result => { if (result.ok) setJobs(result.value) })
    void refreshTakes()
    return unsubscribe
  }, [bridge, refreshTakes])

  const status = connection.state === 'connected' ? connection.status : null
  const effectsWorkflow = settings.models.effects.profileId === 'custom-workflow' ? settings.models.effects.workflow : null
  const musicWorkflow = settings.models.music.profileId === 'custom-workflow' ? settings.models.music.workflow : null

  useEffect(() => {
    for (const [workspace, workflow] of [['effects', effectsWorkflow], ['music', musicWorkflow]] as const) {
      setInspections(current => ({ ...current, [workspace]: null }))
      setInspectionErrors(current => ({ ...current, [workspace]: '' }))
      if (!bridge || !status || !workflow) continue
      void bridge.inspectWorkflow(status.endpoint, workflow.graph).then(result => {
        if (result.ok) setInspections(current => ({ ...current, [workspace]: result.value }))
        else setInspectionErrors(current => ({ ...current, [workspace]: result.error }))
      })
    }
  }, [bridge, status, effectsWorkflow, musicWorkflow])

  const readiness = useMemo<Record<Workspace, Readiness>>(() => {
    const assess = (workspace: Workspace) => {
      const result = assessReadiness(settings.models[workspace], status, cloud, inspections[workspace])
      if (inspectionErrors[workspace]) return { ...result, ready: false, issues: [...result.issues.filter(issue => !issue.startsWith('Checking')), inspectionErrors[workspace]] }
      return result
    }
    return { effects: assess('effects'), music: assess('music') }
  }, [settings.models, status, cloud, inspections, inspectionErrors])

  const [download, setDownload] = useState<DownloadStatus>(idleDownload)
  const [downloadError, setDownloadError] = useState('')
  const endpointRef = useRef(settings.endpoint)
  endpointRef.current = settings.endpoint

  /** Catalog files the chosen models still need. Offered only when ComfyUI's folder is known, since that is where they go. */
  const missingModels = useMemo<Record<Workspace, ModelDownload[]>>(() => {
    const canSave = !!launcher?.layout
    const missing = (workspace: Workspace) => canSave ? missingDownloads(settings.models[workspace].profileId, readiness[workspace], !!status) : []
    return { effects: missing('effects'), music: missing('music') }
  }, [launcher?.layout, settings.models, readiness, status])

  const downloadModels = useCallback(async (items: ModelDownload[]) => {
    if (!bridge || !items.length) return
    setDownloadError('')
    try { setDownload(await unwrap(bridge.downloadModels([...new Set(items.map(item => item.id))]))) } catch (error) { setDownloadError(message(error)) }
  }, [bridge])

  const cancelDownload = useCallback(async () => {
    if (!bridge) return
    try { setDownload(await unwrap(bridge.cancelDownload())) } catch (error) { setDownloadError(message(error)) }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    const unsubscribe = bridge.onDownloadUpdate(next => {
      setDownload(next)
      // ComfyUI rescans its model folders on each request, so new files appear without a restart.
      if (next.phase === 'completed') void check(endpointRef.current)
    })
    void bridge.getDownload().then(result => { if (result.ok) setDownload(result.value) })
    return unsubscribe
  }, [bridge, check])

  useEffect(() => {
    if (!offerModels.current || !status) return
    offerModels.current = false
    const items = [...missingModels.effects, ...missingModels.music]
    if (items.length && download.phase !== 'downloading') void downloadModels(items)
  }, [status, missingModels, download.phase, downloadModels])

  const chooseModel = useCallback((workspace: Workspace, patch: Partial<ModelChoice>) => {
    setSettings(current => {
      const choice = { ...current.models[workspace], ...patch }
      if (!modelProfiles[choice.profileId].workspaces.includes(workspace)) return current
      return { ...current, models: { ...current.models, [workspace]: choice } }
    })
  }, [setSettings])

  const configureCloud = useCallback(async (configuration: CloudConfiguration) => {
    if (!bridge) throw new Error('Cloud partner models need the desktop app.')
    const next = await unwrap(bridge.configureCloud(configuration))
    setCloud(next)
    return next
  }, [bridge])

  const start = useCallback(async (request: GenerationRequest) => {
    if (!bridge || !status) throw new Error('Connect to ComfyUI first.')
    const job = await unwrap(bridge.startGeneration(status.endpoint, request))
    setJobs(current => current.some(item => item.id === job.id) ? current : [...current, job])
    return job
  }, [bridge, status])

  const cancel = useCallback(async (jobId: string) => {
    if (!bridge) return
    await unwrap(bridge.cancelGeneration(jobId))
  }, [bridge])

  const exportTake = useCallback(async (takeId: string) => {
    if (!bridge) throw new Error('Export needs the desktop app.')
    return unwrap(bridge.exportTake(takeId))
  }, [bridge])

  const deleteTake = useCallback(async (takeId: string) => {
    if (!bridge) throw new Error('Deleting takes needs the desktop app.')
    const deleted = await unwrap(bridge.deleteTake(takeId))
    if (deleted) await refreshTakes()
    return deleted
  }, [bridge, refreshTakes])

  return {
    available: !!bridge, settings, settingsError, connection, status, cloud, readiness, inspections, jobs, takes, unreadableTakes, takesError,
    launcher, launcherError, startComfy, stopComfy, installOutputNode,
    download, downloadError, missingModels, downloadModels, cancelDownload,
    refreshLauncher: () => bridge ? launcherAction(() => bridge.getLauncher()) : Promise.resolve(),
    chooseComfyFolder: () => bridge ? launcherAction(() => bridge.chooseComfyFolder()) : Promise.resolve(),
    showComfyLog: async () => { if (bridge) { const result = await bridge.showComfyLog(); setLauncherError(result.ok ? '' : result.error) } },
    connect, disconnect, recheck: () => check(settings.endpoint), chooseModel, configureCloud, start, cancel, exportTake, deleteTake, refreshTakes
  }
}

export type Backend = ReturnType<typeof useBackend>
