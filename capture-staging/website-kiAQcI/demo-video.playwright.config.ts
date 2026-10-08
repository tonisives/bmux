import { defineConfig } from '@playwright/test'

export default defineConfig({ testDir: '.', testMatch: 'demo-video.test.ts', timeout: 420_000, workers: 1, reporter: 'list' })
