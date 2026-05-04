import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Vite builds the two HTML entry points into dist/, with hashed
// asset filenames and the canonical engine module bundled in.
//
// Deploy by serving dist/ as a static site. Until the deploy
// pipeline cuts over, the source index.html / enroll.html still
// load src/engine/obligations.js via a relative type=module
// import, so they stay deployable as-is.
export default defineConfig({
  root: '.',
  build: {
    outDir:    'dist',
    emptyOutDir: true,
    target:    'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        main:   resolve(__dirname, 'index.html'),
        enroll: resolve(__dirname, 'enroll.html'),
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
})
