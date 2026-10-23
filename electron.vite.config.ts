import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { pageVimPlugin } from './page-vim-build'
import { execFileSync } from 'node:child_process'

let revision = process.env.BMUX_BUILD_REVISION || 'dev'
try {
  revision = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) revision += '-dirty'
} catch { /* Source archives can supply BMUX_BUILD_REVISION. */ }
let buildInfo = { revision, builtAt: new Date().toISOString() }

let config = defineConfig({
  main: { define: { __BMUX_BUILD_INFO__: JSON.stringify(buildInfo) }, plugins: [externalizeDepsPlugin(), pageVimPlugin()], build: { rollupOptions: { input: { index: 'src/main/index.ts', 'filter-worker': 'src/main/filter-worker.ts', 'remote-capture': 'src/main/remote-capture.ts' } } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: 'src/preload/index.ts', remote: 'src/preload/remote.ts', 'remote-client': 'src/preload/remote-client.ts' }, output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
  renderer: { plugins: [react()], build: { rollupOptions: { input: { index: 'src/renderer/index.html', 'remote-peer': 'src/renderer/remote-peer.html', 'remote-client': 'src/renderer/remote-client.html' } } } },
})
export { config as default }
