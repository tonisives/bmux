import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

let config = defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: 'src/main/index.ts', 'filter-worker': 'src/main/filter-worker.ts', 'remote-capture': 'src/main/remote-capture.ts' } } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: 'src/preload/index.ts', remote: 'src/preload/remote.ts' }, output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
  renderer: { plugins: [react()], build: { rollupOptions: { input: { index: 'src/renderer/index.html', 'remote-peer': 'src/renderer/remote-peer.html' } } } },
})
export { config as default }
