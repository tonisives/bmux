import { defineConfig } from '@playwright/test'
let config = defineConfig({ testDir: './tests', testMatch: '**/*.electron.test.ts', timeout: 120_000, workers: 1, reporter: 'list' })
export { config as default }
