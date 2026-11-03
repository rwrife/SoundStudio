// Test fixture: a minimal stand-in for the ComfyUI HTTP and WebSocket API, used only by the desktop smoke test.
// It returns a synthesized test tone, not model output, so Sound Studio's job, validation and take handling
// can be exercised without a GPU or downloaded models.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const gb = 1024 ** 3
const nodes = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [['stable-audio-open-1.0.safetensors', 'ace_step_1.5_turbo_aio.safetensors', 'sd_xl_base_1.0.safetensors']] } } },
  CLIPLoader: { input: { required: { clip_name: [['t5-base.safetensors']], type: ['COMBO', { options: ['stable_diffusion', 'stable_audio', 'ace'] }] } } },
  CLIPTextEncode: {}, ConditioningStableAudio: {}, EmptyLatentAudio: {}, KSampler: {}, VAEDecodeAudio: {}, SaveAudio: {},
  ModelSamplingAuraFlow: {}, 'TextEncodeAceStepAudio1.5': {}, ConditioningZeroOut: {}, 'EmptyAceStep1.5LatentAudio': {},
  MusicgenGenerate: {},
  MireloTextToSFX: { api_node: true }, ByteDanceSeedAudio: { api_node: true }
}

export function testTone(seconds = 1, sampleRate = 44100) {
  const frames = Math.round(seconds * sampleRate)
  const view = new DataView(new ArrayBuffer(44 + frames * 2))
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, frames * 2, true)
  for (let frame = 0; frame < frames; frame += 1) {
    const envelope = Math.min(1, frame / 2000, (frames - frame) / 2000)
    view.setInt16(44 + frame * 2, Math.round(Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 0.4 * envelope * 32767), true)
  }
  return Buffer.from(view.buffer)
}

function frame(text) {
  const payload = Buffer.from(text)
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
  return Buffer.concat([header, payload])
}

/**
 * Prompts containing FAIL report an execution error, SLOW runs until interrupted, and anything else finishes
 * after a few progress steps. `prompts` records every accepted /prompt body for assertions.
 */
export async function startMockComfyUI() {
  const prompts = []
  const history = new Map()
  const queue = []
  const sockets = new Map()
  let counter = 0

  const send = (clientId, message) => { for (const socket of sockets.get(clientId) ?? []) socket.write(frame(JSON.stringify(message))) }

  function run(job) {
    job.state = 'running'
    send(job.clientId, { type: 'execution_start', data: { prompt_id: job.id } })
    if (job.mode === 'slow') return
    let step = 0
    const tick = () => {
      if (job.state !== 'running') return
      step += 1
      send(job.clientId, { type: 'progress', data: { value: step, max: 4, prompt_id: job.id, node: '1' } })
      if (step < 4) { job.timer = setTimeout(tick, 250); return }
      finish(job, job.mode === 'fail'
        ? { status: { status_str: 'error', completed: false, messages: [['execution_start', {}], ['execution_error', { node_type: 'KSampler', exception_message: 'Mock failure requested by the test prompt.' }]] }, outputs: {} }
        : { status: { status_str: 'success', completed: true, messages: [['execution_start', {}], ['execution_success', {}]] },
          outputs: { [job.outputNodeId]: { audio: [{ filename: `mock_${job.id.slice(0, 8)}.wav`, subfolder: 'sound-studio', type: 'output' }] } } })
    }
    job.timer = setTimeout(tick, 250)
  }

  function finish(job, entry) {
    clearTimeout(job.timer)
    job.state = 'done'
    history.set(job.id, { prompt: [job.number, job.id, job.workflow, {}, [job.outputNodeId]], ...entry })
    queue.splice(queue.indexOf(job), 1)
    const next = queue.find(item => item.state === 'pending')
    if (next) run(next)
  }

  const json = (response, status, body) => {
    const text = JSON.stringify(body)
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
    response.end(text)
  }
  const body = request => new Promise(resolve => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || 'null')) } catch { resolve(null) } })
  })

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/system_stats') {
      return json(response, 200, { system: { os: 'mock', comfyui_version: '0.3.0-mock', python_version: '3.12' }, devices: [{ name: 'Mock GPU', type: 'cuda', index: 0, vram_total: 16 * gb, vram_free: 14 * gb }] })
    }
    if (request.method === 'GET' && url.pathname.startsWith('/object_info/')) {
      const name = decodeURIComponent(url.pathname.slice('/object_info/'.length))
      return json(response, 200, nodes[name] ? { [name]: { name, input: { required: {} }, ...nodes[name] } } : {})
    }
    if (request.method === 'POST' && url.pathname === '/prompt') {
      const data = await body(request)
      const graph = data?.prompt
      if (!graph || typeof graph !== 'object') return json(response, 400, { error: { message: 'No prompt provided' }, node_errors: {} })
      const unknown = Object.entries(graph).filter(([, node]) => !nodes[node.class_type])
      if (unknown.length) {
        return json(response, 400, { error: { message: 'Prompt outputs failed validation' }, node_errors: Object.fromEntries(unknown.map(([id, node]) => [id, { class_type: node.class_type, errors: [{ message: 'Node not found' }] }])) })
      }
      const outputNodeId = Object.keys(graph).find(id => graph[id].class_type === 'SaveAudio')
      const text = JSON.stringify(graph)
      const id = crypto.randomUUID()
      const job = { id, number: counter++, clientId: data.client_id, workflow: graph, outputNodeId, state: 'pending', mode: text.includes('FAIL') ? 'fail' : text.includes('SLOW') ? 'slow' : 'ok' }
      prompts.push({ id, body: data })
      queue.push(job)
      if (!queue.some(item => item.state === 'running')) run(job)
      return json(response, 200, { prompt_id: id, number: job.number, node_errors: {} })
    }
    if (request.method === 'GET' && url.pathname === '/queue') {
      const entry = job => [job.number, job.id, job.workflow, {}, [job.outputNodeId]]
      return json(response, 200, { queue_running: queue.filter(job => job.state === 'running').map(entry), queue_pending: queue.filter(job => job.state === 'pending').map(entry) })
    }
    if (request.method === 'POST' && url.pathname === '/queue') {
      const data = await body(request)
      for (const id of data?.delete ?? []) {
        const job = queue.find(item => item.id === id && item.state === 'pending')
        if (job) queue.splice(queue.indexOf(job), 1)
      }
      return json(response, 200, {})
    }
    if (request.method === 'POST' && url.pathname === '/interrupt') {
      const data = await body(request)
      const job = queue.find(item => item.state === 'running' && (!data?.prompt_id || item.id === data.prompt_id))
      if (job) finish(job, { status: { status_str: 'error', completed: false, messages: [['execution_start', {}], ['execution_interrupted', { prompt_id: job.id }]] }, outputs: {} })
      return json(response, 200, {})
    }
    if (request.method === 'GET' && url.pathname.startsWith('/history/')) {
      const id = decodeURIComponent(url.pathname.slice('/history/'.length))
      return json(response, 200, history.has(id) ? { [id]: history.get(id) } : {})
    }
    if (request.method === 'GET' && url.pathname === '/view') {
      if (url.searchParams.get('type') !== 'output' || !/^mock_[0-9a-f]{8}\.wav$/.test(url.searchParams.get('filename') ?? '')) return json(response, 404, {})
      const audio = testTone()
      response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': audio.length })
      return response.end(audio)
    }
    json(response, 404, { error: 'not found' })
  })

  server.on('upgrade', (request, socket) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const key = request.headers['sec-websocket-key']
    if (url.pathname !== '/ws' || !key) { socket.destroy(); return }
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    const clientId = url.searchParams.get('clientId') ?? ''
    sockets.set(clientId, [...(sockets.get(clientId) ?? []), socket])
    socket.write(frame(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: queue.length } }, sid: clientId } })))
    socket.on('data', data => { if ((data[0] & 0x0f) === 0x8) socket.end() })
    socket.on('error', () => undefined)
    socket.on('close', () => sockets.set(clientId, (sockets.get(clientId) ?? []).filter(item => item !== socket)))
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    prompts,
    close: () => new Promise(resolve => {
      for (const job of queue) clearTimeout(job.timer)
      for (const list of sockets.values()) for (const socket of list) socket.destroy()
      server.closeAllConnections?.()
      server.close(() => resolve())
    })
  }
}
