import type { BackendDevice, BackendStatus, ComfyOutputFile, ComfyWorkflow, WorkflowInspection } from '../shared/generation'
import { builtInRequiredNodes, formatPromptError, normalizeEndpoint } from '../shared/generation'
import { parseBackendDevices } from '../shared/hardware'

const jsonLimit = 32 * 1024 * 1024
export const audioLimit = 1024 * 1024 * 1024

export class ComfyError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readLimited(response: Response, limit: number) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) throw new ComfyError('ComfyUI returned more data than expected.')
  if (!response.body) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength
    if (size > limit) throw new ComfyError('ComfyUI returned more data than expected.')
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

/** Minimal client for a ComfyUI server on this device. The endpoint is always re-validated as loopback. */
export class ComfyClient {
  readonly endpoint: string

  constructor(endpoint: unknown) {
    this.endpoint = normalizeEndpoint(endpoint)
  }

  private async fetch(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}) {
    try {
      return await fetch(`${this.endpoint}${path}`, {
        method: init.method ?? 'GET',
        headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: 'error',
        signal: AbortSignal.timeout(init.timeoutMs ?? 10_000)
      })
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'did not respond in time' : 'is not reachable'
      throw new ComfyError(`ComfyUI at ${this.endpoint} ${reason}. Start ComfyUI and check the address.`)
    }
  }

  private async json(path: string, init?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<unknown> {
    const response = await this.fetch(path, init)
    const bytes = await readLimited(response, jsonLimit)
    let body: unknown = null
    try { body = bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : null } catch { body = null }
    if (!response.ok) throw new ComfyError(path === '/prompt' ? formatPromptError(body, response.status) : `ComfyUI returned HTTP ${response.status} for ${path}.`)
    return body
  }

  async nodeInfo(classType: string): Promise<Record<string, unknown> | null> {
    const body = await this.json(`/object_info/${encodeURIComponent(classType)}`)
    return isRecord(body) && isRecord(body[classType]) ? body[classType] : null
  }

  static comboOptions(info: Record<string, unknown> | null, input: string): string[] {
    const required = info && isRecord(info.input) && isRecord(info.input.required) ? info.input.required : {}
    const spec = required[input]
    if (!Array.isArray(spec)) return []
    const list = Array.isArray(spec[0]) ? spec[0] : spec[0] === 'COMBO' && isRecord(spec[1]) && Array.isArray(spec[1].options) ? spec[1].options : []
    return list.filter((item): item is string => typeof item === 'string')
  }

  /** Looks up node classes. Partner nodes are reported by ComfyUI with api_node: true. */
  async inspectNodes(classTypes: Iterable<string>): Promise<WorkflowInspection & { infos: Map<string, Record<string, unknown>> }> {
    const unique = [...new Set(classTypes)]
    const infos = new Map<string, Record<string, unknown>>()
    const results = await Promise.all(unique.map(async name => [name, await this.nodeInfo(name)] as const))
    for (const [name, info] of results) if (info) infos.set(name, info)
    return {
      infos,
      missingNodes: unique.filter(name => !infos.has(name)),
      apiNodes: unique.filter(name => infos.get(name)?.api_node === true)
    }
  }

  async status(): Promise<BackendStatus> {
    const stats = await this.json('/system_stats')
    if (!isRecord(stats) || !isRecord(stats.system)) throw new ComfyError(`The server at ${this.endpoint} did not answer like ComfyUI.`)
    const devices: BackendDevice[] = parseBackendDevices(stats.devices)
    const { infos, apiNodes } = await this.inspectNodes(builtInRequiredNodes)
    return {
      endpoint: this.endpoint,
      comfyuiVersion: typeof stats.system.comfyui_version === 'string' ? stats.system.comfyui_version : null,
      devices,
      checkpoints: ComfyClient.comboOptions(infos.get('CheckpointLoaderSimple') ?? null, 'ckpt_name'),
      textEncoders: ComfyClient.comboOptions(infos.get('CLIPLoader') ?? null, 'clip_name'),
      clipTypes: ComfyClient.comboOptions(infos.get('CLIPLoader') ?? null, 'type'),
      availableNodes: [...infos.keys()],
      apiNodes,
      checkedAt: new Date().toISOString()
    }
  }

  async version(): Promise<string | null> {
    const stats = await this.json('/system_stats')
    if (!isRecord(stats) || !isRecord(stats.system)) throw new ComfyError(`The server at ${this.endpoint} did not answer like ComfyUI.`)
    return typeof stats.system.comfyui_version === 'string' ? stats.system.comfyui_version : null
  }

  async queuePrompt(workflow: ComfyWorkflow, clientId: string, apiKey: string | null) {
    const body = await this.json('/prompt', {
      method: 'POST', timeoutMs: 30_000,
      body: { prompt: workflow, client_id: clientId, ...(apiKey ? { extra_data: { api_key_comfy_org: apiKey } } : {}) }
    })
    if (!isRecord(body) || typeof body.prompt_id !== 'string' || !body.prompt_id) throw new ComfyError('ComfyUI did not accept the workflow.')
    if (isRecord(body.node_errors) && Object.keys(body.node_errors).length) throw new ComfyError(formatPromptError(body, 400))
    return body.prompt_id
  }

  async history(promptId: string): Promise<unknown> {
    const body = await this.json(`/history/${encodeURIComponent(promptId)}`)
    return isRecord(body) ? body[promptId] : undefined
  }

  async queueState(promptId: string): Promise<'running' | 'pending' | 'absent'> {
    const body = await this.json('/queue')
    const has = (list: unknown) => Array.isArray(list) && list.some(item => Array.isArray(item) && item[1] === promptId)
    if (!isRecord(body)) return 'absent'
    return has(body.queue_running) ? 'running' : has(body.queue_pending) ? 'pending' : 'absent'
  }

  async deleteQueued(promptId: string) {
    await this.json('/queue', { method: 'POST', body: { delete: [promptId] } })
  }

  async interrupt(promptId: string) {
    await this.json('/interrupt', { method: 'POST', body: { prompt_id: promptId } })
  }

  async download(file: ComfyOutputFile) {
    const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: 'output' })
    const response = await this.fetch(`/view?${query}`, { timeoutMs: 120_000 })
    if (!response.ok) throw new ComfyError(`ComfyUI could not provide the generated audio (HTTP ${response.status}).`)
    return readLimited(response, audioLimit)
  }

  websocketUrl(clientId: string) {
    return `${this.endpoint.replace(/^http:/, 'ws:')}/ws?clientId=${encodeURIComponent(clientId)}`
  }
}
