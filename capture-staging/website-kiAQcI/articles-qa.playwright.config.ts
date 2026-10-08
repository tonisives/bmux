import { defineConfig } from '@playwright/test'

export default defineConfig({ testDir: '.', testMatch: 'articles-qa.test.ts', timeout: 180_000, use: { actionTimeout: 15000 }, workers: 1, reporter: 'list' })
