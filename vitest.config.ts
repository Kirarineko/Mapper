import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/large-image.test.ts'],
    maxWorkers: 3,
    testTimeout: 30_000,
  },
})
