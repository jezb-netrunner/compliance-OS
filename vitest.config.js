import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include:   ['src/**/*.test.js', 'src/**/__tests__/*.test.js'],
    // Engine tests are pure Node; UI tests need a DOM. Per-file
    // override: any test under src/ui/ runs in jsdom, the rest in
    // node (faster, no DOM bootstrap).
    environment: 'node',
    environmentMatchGlobs: [['src/ui/**', 'jsdom']],
    reporters: ['default'],
    coverage: {
      include: ['src/engine/**/*.js', 'src/ui/**/*.js'],
      exclude: ['**/__tests__/**'],
    },
  },
})
