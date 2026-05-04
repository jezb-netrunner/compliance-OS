// Tests for the lit-html render facade. Uses happy-dom (zero-config
// for vitest's environment override) to give lit-html a real DOM to
// render against — same rendering pipeline as the browser.

// Uses the jsdom environment configured in vitest.config.js.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, html, statusBadge, loadingLine, emptyState, errorLine } from '../render.js'

let container

beforeEach(() => {
  container = document.createElement('div')
  document.body.replaceChildren(container)
})

describe('render facade', () => {
  it('renders a simple template into a container', () => {
    render(html`<p>hello</p>`, container)
    expect(container.querySelector('p')?.textContent).toBe('hello')
  })

  it('escapes interpolated values', () => {
    const malicious = '<script>alert(1)</script>'
    render(html`<div>${malicious}</div>`, container)
    expect(container.innerHTML).not.toContain('<script>')
    expect(container.textContent).toBe(malicious)
  })

  it('binds @click handlers on re-render', () => {
    let clicks = 0
    const tpl = () => html`<button @click=${() => clicks++}>x</button>`
    render(tpl(), container)
    container.querySelector('button').click()
    render(tpl(), container)  // re-render
    container.querySelector('button').click()
    expect(clicks).toBe(2)
  })
})

describe('statusBadge', () => {
  it('maps each status to the right CSS class', () => {
    for (const [status, cls] of [
      ['done',         'badge-green'],
      ['overdue',      'badge-red'],
      ['trrc-missing', 'badge-amber'],
      ['unpaid',       'badge-blue'],
      ['pending',      'badge-dim'],
    ]) {
      render(statusBadge(status, status), container)
      expect(container.querySelector('span').className).toBe(cls)
    }
  })

  it('falls back to badge-dim for unknown statuses', () => {
    render(statusBadge('weird-state', 'Weird'), container)
    expect(container.querySelector('span').className).toBe('badge-dim')
  })
})

describe('emptyState', () => {
  it('renders message-only', () => {
    render(emptyState('Nothing here'), container)
    expect(container.querySelector('.empty-state')?.textContent).toContain('Nothing here')
    expect(container.querySelector('button')).toBeFalsy()
  })

  it('renders CTA button bound to onClick', () => {
    let clicks = 0
    render(emptyState('No clients', { label: 'Add', onClick: () => clicks++ }), container)
    container.querySelector('button').click()
    expect(clicks).toBe(1)
  })
})

describe('loadingLine + errorLine', () => {
  it('loadingLine defaults to "Loading…"', () => {
    render(loadingLine(), container)
    expect(container.textContent).toContain('Loading…')
  })

  it('errorLine renders text in danger color', () => {
    render(errorLine('boom'), container)
    expect(container.textContent).toContain('boom')
    expect(container.querySelector('p').getAttribute('style')).toContain('var(--red)')
  })
})
