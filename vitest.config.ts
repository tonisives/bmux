import { defineConfig } from 'vitest/config'
let config = defineConfig({ test: { include: ['tests/**/*.unit.test.ts'] } })
export { config as default }
