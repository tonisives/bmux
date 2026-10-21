import { defineConfig } from '@playwright/test'
process.env.BMUX_RECORD_DEMO = '1'
export default defineConfig({ testDir: '../tests', testMatch: 'extensions-mouse.electron.test.ts', timeout: 120_000, workers: 1, reporter: 'list' })
