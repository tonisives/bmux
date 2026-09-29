import { defineConfig } from '@playwright/test'

export default defineConfig({ testDir: '.', testMatch: 'features.test.ts', timeout: 240_000, workers: 1, reporter: 'list' })
