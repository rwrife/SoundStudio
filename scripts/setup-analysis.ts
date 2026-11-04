import { resolve } from 'node:path'
import { LocalRuntime } from '../src/main/runtime'
import { profileSchema } from '../src/shared/decomposer'

const rootIndex = process.argv.indexOf('--root')
const profileIndex = process.argv.indexOf('--profile')
if (rootIndex < 0 || !process.argv[rootIndex + 1]) throw new Error('Provide --root <isolated runtime directory>. This command explicitly downloads the selected runtime/model profile.')
const profile = profileSchema.parse(profileIndex < 0 ? 'core' : process.argv[profileIndex + 1])
const runtime = new LocalRuntime(resolve(process.argv[rootIndex + 1]), resolve('scripts\\analysis'))
await runtime.diagnose()
await runtime.install(profile)
let last = ''
while (runtime.snapshot().busy) {
  const message = runtime.snapshot().message
  if (message !== last) { console.log(message); last = message }
  await new Promise(resolve => setTimeout(resolve, 1000))
}
const status = await runtime.diagnose()
console.log(JSON.stringify(status, null, 2))
if (status.error || !status.profiles.find(item => item.id === profile)?.ready) process.exitCode = 1
