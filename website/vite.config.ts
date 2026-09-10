import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4317, strictPort: true, watch: { usePolling: true } },
  build: { outDir: 'dist/client', emptyOutDir: true },
})
