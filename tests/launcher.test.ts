import assert from 'node:assert/strict'
import { test } from 'node:test'
import { candidateFolders, detectComfyInstall, findComfyInstall } from '../src/main/comfyInstall'
import { installOutputNode, outputNodeFolder, outputNodeSource, outputNodeState } from '../src/main/outputNode'
import { comfyLaunchArguments } from '../src/shared/launcher'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const files = (...paths: string[]) => {
  const set = new Set(paths.map(path => path.toLowerCase()))
  return (path: string) => set.has(path.toLowerCase())
}

test('recognizes a Windows portable build from its root or its ComfyUI folder', () => {
  const exists = files('C:\\Tools\\ComfyUI_windows_portable\\python_embeded\\python.exe', 'C:\\Tools\\ComfyUI_windows_portable\\ComfyUI\\main.py')
  for (const folder of ['C:\\Tools\\ComfyUI_windows_portable', 'C:\\Tools\\ComfyUI_windows_portable\\', 'C:\\Tools\\ComfyUI_windows_portable\\ComfyUI']) {
    const install = detectComfyInstall(folder, exists, 'win32')
    assert.equal(install.layout, 'portable')
    assert.equal(install.folder, 'C:\\Tools\\ComfyUI_windows_portable')
    assert.equal(install.python, 'C:\\Tools\\ComfyUI_windows_portable\\python_embeded\\python.exe')
    assert.equal(install.mainScript, 'C:\\Tools\\ComfyUI_windows_portable\\ComfyUI\\main.py')
  }
})

test('recognizes a source checkout with venv or .venv on Windows and POSIX', () => {
  const windows = detectComfyInstall('C:\\Users\\me\\AppData\\Local\\ComfyUI', files('C:\\Users\\me\\AppData\\Local\\ComfyUI\\main.py', 'C:\\Users\\me\\AppData\\Local\\ComfyUI\\venv\\Scripts\\python.exe'), 'win32')
  assert.deepEqual(windows, {
    layout: 'venv', folder: 'C:\\Users\\me\\AppData\\Local\\ComfyUI', python: 'C:\\Users\\me\\AppData\\Local\\ComfyUI\\venv\\Scripts\\python.exe',
    mainScript: 'C:\\Users\\me\\AppData\\Local\\ComfyUI\\main.py', workingDirectory: 'C:\\Users\\me\\AppData\\Local\\ComfyUI'
  })
  const posix = detectComfyInstall('/home/me/ComfyUI', files('/home/me/ComfyUI/main.py', '/home/me/ComfyUI/.venv/bin/python'), 'linux')
  assert.equal(posix.python, '/home/me/ComfyUI/.venv/bin/python')
})

test('rejects folders it cannot start safely', () => {
  assert.throws(() => detectComfyInstall('relative\\ComfyUI', files(), 'win32'), /Choose the folder/)
  assert.throws(() => detectComfyInstall('C:\\Empty', files(), 'win32'), /main\.py was not found[\s\S]*Desktop app/)
  assert.throws(() => detectComfyInstall('C:\\ComfyUI', files('C:\\ComfyUI\\main.py'), 'win32'), /not its Python environment/)
  // A portable layout is a Windows-only convention.
  assert.throws(() => detectComfyInstall('/opt/portable', files('/opt/portable/python_embeded/python.exe', '/opt/portable/ComfyUI/main.py'), 'linux'), /main\.py was not found/)
})

test('suggests the first recognized install from common locations', () => {
  const candidates = candidateFolders('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', SystemDrive: 'C:' }, 'C:\\Users\\me')
  assert.equal(candidates[0], 'C:\\Users\\me\\AppData\\Local\\ComfyUI')
  assert.ok(candidates.includes('C:\\Users\\me\\Desktop\\ComfyUI_windows_portable'))
  assert.ok(candidates.includes('C:\\ComfyUI_windows_portable'))
  const exists = files('C:\\ComfyUI_windows_portable\\python_embeded\\python.exe', 'C:\\ComfyUI_windows_portable\\ComfyUI\\main.py')
  assert.equal(findComfyInstall(candidates, exists, 'win32')?.folder, 'C:\\ComfyUI_windows_portable')
  assert.equal(findComfyInstall(candidates, files(), 'win32'), null)
})

test('launches ComfyUI on the loopback address and port of the endpoint only', () => {
  assert.deepEqual(comfyLaunchArguments('venv', 'C:\\ComfyUI\\main.py', 'http://127.0.0.1:8190'),
    ['C:\\ComfyUI\\main.py', '--listen', '127.0.0.1', '--port', '8190', '--disable-auto-launch'])
  assert.deepEqual(comfyLaunchArguments('portable', 'C:\\P\\ComfyUI\\main.py', 'http://localhost:8188'),
    ['-s', 'C:\\P\\ComfyUI\\main.py', '--listen', '127.0.0.1', '--port', '8188', '--disable-auto-launch'])
  assert.deepEqual(comfyLaunchArguments('venv', '/c/main.py', 'http://[::1]:9000').slice(1, 5), ['--listen', '::1', '--port', '9000'])
})

test('installs the WAV output node only into custom_nodes and never overwrites files it did not create', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sound-studio-node-'))
  try {
    const main = join(root, 'main.py')
    await writeFile(main, '')
    assert.equal(await outputNodeState(main), 'missing')
    assert.equal(await installOutputNode(main), true)
    const file = join(root, 'custom_nodes', outputNodeFolder, '__init__.py')
    assert.equal(await readFile(file, 'utf8'), outputNodeSource)
    assert.equal(await outputNodeState(main), 'installed')
    assert.equal(await installOutputNode(main), false, 'an up-to-date node is left alone')
    assert.match(outputNodeSource, /NODE_CLASS_MAPPINGS = \{"SoundStudioSaveWAV"/)

    await writeFile(file, '# Managed by Sound Studio. Version 0.\n')
    assert.equal(await outputNodeState(main), 'outdated')
    assert.equal(await installOutputNode(main), true)
    assert.equal(await readFile(file, 'utf8'), outputNodeSource)

    await writeFile(file, 'print("someone else")\n')
    await assert.rejects(installOutputNode(main), /was not created by Sound Studio/)
    assert.equal(await readFile(file, 'utf8'), 'print("someone else")\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
