import { defineConfig } from 'vitest/config'
import { pageVimPlugin } from './page-vim-build'
let config = defineConfig({ plugins: [pageVimPlugin()], test: { include: ['tests/**/*.unit.test.ts'] } })
export { config as default }
