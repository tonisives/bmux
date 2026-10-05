import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/windows', testMatch: '**/*.windows.test.ts', timeout: 120_000,
  workers: 1, retries: 0, reporter: 'list',
})
