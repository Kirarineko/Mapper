import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/large-image.test.ts'],
    maxWorkers: 1,
    testTimeout: 300_000,
  },
})
