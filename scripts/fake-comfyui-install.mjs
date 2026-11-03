import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

// Test fixture: a folder shaped like a ComfyUI source checkout (main.py plus a real venv) whose main.py only
// answers /system_stats and /object_info and records its arguments. Like ComfyUI, it reports Sound Studio's WAV output
// node only when that node was installed in custom_nodes before it started. It is not ComfyUI and generates nothing.
const mainPy = `import argparse, json, os, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument('--listen', required=True)
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--disable-auto-launch', action='store_true')
args = parser.parse_args()
here = os.path.dirname(os.path.abspath(__file__))
wav_node = os.path.isfile(os.path.join(here, 'custom_nodes', 'sound_studio_nodes', '__init__.py'))
with open(os.path.join(here, 'launch-args.json'), 'w') as handle:
    json.dump(sys.argv[1:], handle)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/system_stats':
            body = {'system': {'comfyui_version': '0.3.0-launched'}, 'devices': []}
        elif self.path.startswith('/object_info/'):
            name = self.path[len('/object_info/'):]
            body = {name: {'name': name, 'input': {'required': {}}}} if wav_node and name == 'SoundStudioSaveWAV' else {}
        else:
            self.send_response(404)
            self.end_headers()
            return
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass

time.sleep(1.5)
server = ThreadingHTTPServer((args.listen, args.port), Handler)
print('Fake ComfyUI listening on', args.listen, args.port, flush=True)
server.serve_forever()
`

async function findPython() {
  for (const [command, args] of [['python', []], ['python3', []], ['py', ['-3']]]) {
    try {
      await run(command, [...args, '--version'], { windowsHide: true })
      return [command, args]
    } catch { /* Try the next interpreter. */ }
  }
  return null
}

export async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

export async function reachable(endpoint) {
  try {
    const response = await fetch(`${endpoint}/system_stats`, { signal: AbortSignal.timeout(2000) })
    return response.ok
  } catch {
    return false
  }
}

/** Creates <base>/ComfyUI with main.py and a venv, or returns null when Python is unavailable. */
export async function createFakeComfyInstall(base) {
  const python = await findPython()
  if (!python) return null
  const folder = join(base, 'ComfyUI')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'main.py'), mainPy)
  await run(python[0], [...python[1], '-m', 'venv', '--without-pip', join(folder, 'venv')], { windowsHide: true, timeout: 120_000 })
  const port = await freePort()
  return { folder, port: String(port), endpoint: `http://127.0.0.1:${port}` }
}
