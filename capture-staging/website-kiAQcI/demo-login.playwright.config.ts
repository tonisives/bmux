import { defineConfig } from '@playwright/test'

export default defineConfig({ testDir: '.', testMatch: 'demo-login.test.ts', timeout: 0, workers: 1, reporter: 'list', use: { trace: 'off', screenshot: 'off', video: 'off' } })
