// Engine module presence + import surface check.
//
// Pre-chunk-9, this file enforced parity between the inline
// engine copy in index.html and src/engine/obligations.js.
// The inline copy has now been deleted (chunk 9). What remains:
//
//   1. index.html still imports the canonical module via
//      <script type="module"> — verify the import line is present
//      so a refactor can't accidentally drop the load and break
//      the runtime.
//   2. The module exports the public surface the rest of the app
//      relies on (generateObligations / _iso / _PH_HOLIDAYS /
//      _nextBusinessDay / _MONTHS).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as engine from '../obligations.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../../..')

describe('engine wiring', () => {
  it('index.html imports the canonical engine module', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    expect(html).toMatch(
      /<script\s+type=["']module["']>[\s\S]*?import\s+\*\s+as\s+engine\s+from\s+['"]\.\/src\/engine\/obligations\.js['"]/m
    )
  })

  it('module exports the full public surface', () => {
    for (const name of [
      '_MONTHS', '_iso', '_PH_HOLIDAYS', '_nextBusinessDay', 'generateObligations',
    ]) {
      expect(engine).toHaveProperty(name)
    }
  })

  it('index.html no longer carries the duplicate inline engine', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    // The inline copy was a top-level "function generateObligations"
    // (no `export`, no indentation). The module is the only place
    // that string should appear now.
    const inlineCount = (html.match(/^function generateObligations\b/gm) || []).length
    expect(inlineCount).toBe(0)
  })
})
