import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include:    ['src/**/*.test.js', 'src/**/__tests__/*.test.js'],
    environment:'node',
    reporters:  ['default'],
    coverage: {
      include: ['src/engine/**/*.js'],
      exclude: ['**/__tests__/**'],
    },
  },
})
