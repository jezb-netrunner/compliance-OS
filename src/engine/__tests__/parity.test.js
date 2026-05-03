// Until chunk 6 wires index.html to import the engine via
// <script type="module">, the same engine code lives in two places:
// the canonical src/engine/obligations.js and the inline <script>
// block in index.html. This parity check fails CI when the two
// drift, so a forgotten copy-paste-update can't ship.
//
// The check extracts everything between the `const _MONTHS` line and
// the closing `}` of generateObligations from index.html and
// compares it character-for-character to the body of obligations.js
// (modulo header/footer banners).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../../..')

const SENTINEL_START = 'const _MONTHS = '
const SENTINEL_END   = 'function generateObligations'

function extractEngineFrom(src) {
  const start = src.indexOf(SENTINEL_START)
  if (start < 0) throw new Error(`could not locate "${SENTINEL_START}" sentinel`)

  // Walk forward from generateObligations to find the matching close brace.
  const fnStart = src.indexOf(SENTINEL_END, start)
  if (fnStart < 0) throw new Error('could not locate generateObligations')

  // Find the opening { of generateObligations.
  const openBrace = src.indexOf('{', fnStart)
  let depth = 0
  let i = openBrace
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break } }
  }
  return src.slice(start, i)
}

describe('engine parity: src/engine/obligations.js ⇔ index.html inline copy', () => {
  it('inline engine in index.html matches the canonical module body', () => {
    const inlineSrc = readFileSync(resolve(ROOT, 'index.html'),               'utf8')
    const moduleSrc = readFileSync(resolve(ROOT, 'src/engine/obligations.js'), 'utf8')

    const fromInline = extractEngineFrom(inlineSrc)
    const fromModule = extractEngineFrom(moduleSrc)

    if (fromInline !== fromModule) {
      // Show a small diff hint instead of dumping 600 lines.
      const inlineLines = fromInline.split('\n')
      const moduleLines = fromModule.split('\n')
      const max = Math.max(inlineLines.length, moduleLines.length)
      let firstDiff = -1
      for (let n = 0; n < max; n++) {
        if (inlineLines[n] !== moduleLines[n]) { firstDiff = n; break }
      }
      const inlineLen = inlineLines.length
      const moduleLen = moduleLines.length
      throw new Error(
        `engine drift detected.\n` +
        `  inline (index.html) lines: ${inlineLen}\n` +
        `  module (obligations.js) lines: ${moduleLen}\n` +
        `  first diverging line: ${firstDiff + 1}\n` +
        `    inline: ${(inlineLines[firstDiff] ?? '<eof>').slice(0, 120)}\n` +
        `    module: ${(moduleLines[firstDiff] ?? '<eof>').slice(0, 120)}\n` +
        `Run \`diff <(sed -n '/const _MONTHS/,/^}/p' index.html) <(sed -n '/const _MONTHS/,/^}/p' src/engine/obligations.js)\` for full diff.`
      )
    }
    expect(fromInline).toBe(fromModule)
  })
})
