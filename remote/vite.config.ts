import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
let config = defineConfig({ root: 'remote/web', plugins: [react()], build: { outDir: '../dist', emptyOutDir: true } })
export { config as default }
