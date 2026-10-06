import { defineConfig } from 'vitest/config'

export default defineConfig({ test: {
  include: ['tests/ipc.unit.test.ts', 'tests/runtime-paths.unit.test.ts', 'tests/config.unit.test.ts', 'tests/plugins.unit.test.ts'],
  maxWorkers: 4,
} })
