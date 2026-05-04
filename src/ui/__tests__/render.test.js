// Tests for the lit-html render facade. Uses happy-dom (zero-config
// for vitest's environment override) to give lit-html a real DOM to
// render against — same rendering pipeline as the browser.

// Uses the jsdom environment configured in vitest.config.js.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  render, html,
  statusBadge, loadingLine, emptyState, errorLine,
  dashboardRow, dashboardList,
} from '../render.js'

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

describe('dashboardRow', () => {
  const baseRow = {
    r: { id: 'r1', form: 'BIR Form 1701Q', period: 'CY 2026 Q1', due_date: '2026-05-15' },
    clientName: 'Acme Corp',
    badge: 'pending',
  }

  it('renders client / form / due / badge', () => {
    render(dashboardRow({ ...baseRow, onOpen: () => {} }), container)
    expect(container.querySelector('.db-row-client').textContent).toBe('Acme Corp')
    expect(container.querySelector('.badge').className).toContain('badge-dim')
    expect(container.textContent).toContain('BIR Form 1701Q')
    expect(container.textContent).toContain('May 15')
  })

  it('action ✓ button stops propagation and fires onAction (not onOpen)', () => {
    let opens = 0, actions = 0
    render(dashboardRow({
      ...baseRow,
      onOpen:   () => opens++,
      onAction: () => actions++,
    }), container)
    container.querySelector('.db-row-act').click()
    expect(opens).toBe(0)
    expect(actions).toBe(1)
  })

  it('clicking the row body fires onOpen', () => {
    let opens = 0
    render(dashboardRow({
      ...baseRow, onOpen: () => opens++,
    }), container)
    container.querySelector('.db-row').click()
    expect(opens).toBe(1)
  })

  it('escapes form/period (no XSS via record.form)', () => {
    const malicious = { ...baseRow.r, form: '<img onerror=alert(1)>' }
    render(dashboardRow({ ...baseRow, r: malicious, onOpen: () => {} }), container)
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('dashboardList', () => {
  const props = {
    badge: 'overdue',
    emptyText: 'Nothing overdue ✓',
    resolveClientName: (r) => `Client ${r.client_id}`,
    onOpen:   () => {},
  }

  it('renders empty-state when list is empty', () => {
    render(dashboardList({ rows: [], ...props }), container)
    expect(container.querySelector('.db-empty')?.textContent).toBe('Nothing overdue ✓')
  })

  it('renders one row per record', () => {
    const rows = [
      { id: 'a', client_id: 'c1', form: '1701Q', period: 'CY 2026 Q1', due_date: '2026-05-15' },
      { id: 'b', client_id: 'c2', form: '2550Q', period: 'CY 2026 Q1', due_date: '2026-05-25' },
    ]
    render(dashboardList({ rows, ...props }), container)
    expect(container.querySelectorAll('.db-row').length).toBe(2)
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
