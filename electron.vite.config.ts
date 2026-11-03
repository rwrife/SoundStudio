import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: resolve('src/main/index.ts') } }
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    server: { host: '127.0.0.1' },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
