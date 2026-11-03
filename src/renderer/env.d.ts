import type { DecomposerApi } from '../shared/decomposer'

declare global {
  interface Window {
    soundStudio?: Readonly<{ platform: string; decomposer: DecomposerApi }>
  }
}
