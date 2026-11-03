import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { allowedDownloadUrl, downloadModel, ModelDownloader, type Fetcher } from '../src/main/modelDownload'
import { modelProfiles, type Readiness } from '../src/shared/generation'
import { missingDownloads, modelDownloads, modelUrl, totalBytes, validateDownloadIds, type DownloadStatus, type ModelDownload } from '../src/shared/modelDownloads'

const missing: Readiness = { ready: false, remote: false, checkpoint: null, textEncoder: null, issues: [] }

test('each download lands under the file name its profile looks for', () => {
  for (const item of modelDownloads) {
    const profile = modelProfiles[item.profileId]
    assert.equal(item.kind === 'checkpoint' ? profile.checkpoint?.suggested : profile.textEncoder?.suggested, item.file)
    assert.match(item.revision, /^[0-9a-f]{40}$/, 'pinned to a commit')
    assert.match(item.sha256, /^[0-9a-f]{64}$/)
    assert.doesNotThrow(() => allowedDownloadUrl(modelUrl(item)))
  }
  assert.equal(modelUrl(modelDownloads.find(item => item.id === 'ace-step-1.5-turbo')!),
    'https://huggingface.co/Comfy-Org/ACE-Step-1.5/resolve/371bb1680f8c88d8c1083f6ffb6330d3d55bff76/checkpoints/ace_step_1.5_turbo_aio.safetensors')
})

test('only the files ComfyUI does not have are offered, and only once connected', () => {
  assert.deepEqual(missingDownloads('stable-audio-open-1.0', missing, true).map(item => item.id), ['stable-audio-open-1.0', 't5-base'])
  assert.deepEqual(missingDownloads('stable-audio-open-1.0', { ...missing, checkpoint: 'stable-audio-open-1.0.safetensors' }, true).map(item => item.id), ['t5-base'])
  assert.deepEqual(missingDownloads('stable-audio-open-1.0', missing, false), [])
  assert.deepEqual(missingDownloads('custom-workflow', missing, true), [])
  assert.deepEqual(missingDownloads('ace-step-1.5-turbo', missing, true).map(item => item.id), ['ace-step-1.5-turbo'])
})

test('the renderer can only request known catalog ids', () => {
  assert.deepEqual(validateDownloadIds(['t5-base', 't5-base']).map(item => item.id), ['t5-base'])
  assert.throws(() => validateDownloadIds([]), /Choose models/)
  assert.throws(() => validateDownloadIds('t5-base'), /Choose models/)
  assert.throws(() => validateDownloadIds(['../../evil']), /Unknown model/)
})

test('downloads are limited to HTTPS Hugging Face hosts', () => {
  assert.equal(allowedDownloadUrl('https://us.aws.cdn.hf.co/xet-bridge-us/abc').hostname, 'us.aws.cdn.hf.co')
  assert.equal(allowedDownloadUrl('https://cdn-lfs.huggingface.co/x').hostname, 'cdn-lfs.huggingface.co')
  for (const bad of ['http://huggingface.co/x', 'https://evil.example/x', 'https://huggingface.co.evil.example/x', 'https://user:pw@huggingface.co/x', 'https://nothf.co/x']) {
    assert.throws(() => allowedDownloadUrl(bad), /Refusing/, bad)
  }
})

const bytes = Buffer.from('fake model bytes for tests')
const fake = (patch: Partial<ModelDownload> = {}): ModelDownload => ({
  ...modelDownloads[1], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...patch
})
/** Answers like Hugging Face: a redirect to the CDN, then the bytes. */
const fetcher = (options: { body?: Buffer; cdn?: string } = {}): { fetch: Fetcher; urls: string[] } => {
  const urls: string[] = []
  return {
    urls,
    fetch: async url => {
      urls.push(url)
      if (url.startsWith('https://huggingface.co/')) return new Response(null, { status: 302, headers: { location: options.cdn ?? 'https://us.aws.cdn.hf.co/xet-bridge-us/blob' } })
      return new Response(new Uint8Array(options.body ?? bytes), { status: 200 })
    }
  }
}

async function withModels(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'sound-studio-models-'))
  try { await run(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

test('a verified download is published under its final name with no partial left behind', () => withModels(async dir => {
  const item = fake()
  const source = fetcher()
  let counted = 0
  assert.equal(await downloadModel(item, dir, { signal: new AbortController().signal, fetcher: source.fetch, onBytes: count => { counted += count } }), 'downloaded')
  assert.deepEqual(await readFile(join(dir, 'text_encoders', 't5-base.safetensors')), bytes)
  assert.deepEqual(await readdir(join(dir, 'text_encoders')), ['t5-base.safetensors'])
  assert.equal(counted, bytes.length)
  assert.equal(source.urls.length, 2)
  assert.equal(await downloadModel(item, dir, { signal: new AbortController().signal, fetcher: source.fetch, onBytes: () => undefined }), 'present')
}))

test('a tampered file, a redirect off Hugging Face or an existing different file are refused', () => withModels(async dir => {
  const signal = new AbortController().signal
  await assert.rejects(downloadModel(fake(), dir, { signal, onBytes: () => undefined, fetcher: fetcher({ body: Buffer.from(bytes).reverse() }).fetch }), /SHA-256/)
  await assert.rejects(downloadModel(fake(), dir, { signal, onBytes: () => undefined, fetcher: fetcher({ body: Buffer.concat([bytes, bytes]) }).fetch }), /larger than expected/)
  await assert.rejects(downloadModel(fake(), dir, { signal, onBytes: () => undefined, fetcher: fetcher({ cdn: 'https://evil.example/blob' }).fetch }), /Refusing/)
  assert.deepEqual(await readdir(join(dir, 'text_encoders')), [], 'nothing partial is kept')

  await writeFile(join(dir, 'text_encoders', 't5-base.safetensors'), 'my own encoder')
  await assert.rejects(downloadModel(fake(), dir, { signal, onBytes: () => undefined, fetcher: fetcher().fetch }), /will not overwrite/)
  assert.equal(await readFile(join(dir, 'text_encoders', 't5-base.safetensors'), 'utf8'), 'my own encoder')
}))

test('the downloader waits for confirmation and reports the outcome', () => withModels(async dir => {
  const updates: DownloadStatus[] = []
  const item = fake()
  let answer = false
  const asked: string[][] = []
  const downloader = new ModelDownloader(status => updates.push(status), async () => dir, async items => { asked.push(items.map(entry => entry.id)); return answer }, fetcher().fetch)

  assert.equal((await downloader.start([item])).phase, 'idle', 'declining changes nothing')
  assert.deepEqual(asked, [['t5-base']])
  await mkdir(join(dir, 'text_encoders'), { recursive: true })
  assert.deepEqual(await readdir(join(dir, 'text_encoders')), [])

  answer = true
  assert.equal((await downloader.start([item])).phase, 'downloading')
  await assert.rejects(downloader.start([item]), /already running/)
  for (let i = 0; i < 100 && downloader.get().phase === 'downloading'; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(downloader.get().phase, 'completed')
  assert.equal(downloader.get().received, totalBytes([item]))
  assert.match(downloader.get().message, /SHA-256/)
  assert.ok(updates.some(update => update.phase === 'downloading'))

  assert.equal((await downloader.start([item])).message, 'These models are already downloaded. Refresh to load them.')
  assert.equal(asked.length, 2, 'files already present are not offered again')
}))
