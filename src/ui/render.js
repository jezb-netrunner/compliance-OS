// src/ui/render.js
//
// Thin facade over lit-html so the inline app script can opt into
// declarative rendering one view at a time without a big-bang rewrite.
//
// Usage from the inline (non-module) script:
//
//   uiRender.render(
//     uiRender.html`<div class="empty-state">${msg}</div>`,
//     document.getElementById('myPanel')
//   )
//
// Templates auto-escape interpolated values (no need for esc()) and
// `@click=${fn}` binds an event listener that survives re-renders
// without leaking. To convert a view, replace its
// `el.innerHTML = '...'` with a render() call; lit-html diffs
// against the previous render so unchanged DOM is preserved.

import { html, render, nothing } from 'lit-html'

export { html, render, nothing }

// ── Tiny library of shared templates ─────────────────────────────
//
// These exist so the eventual view-by-view migration has a stable,
// composable starting point. Keep them pure: no DOM lookups, no
// supabase calls.

/**
 * Status badge as a lit-html template. Caller passes the
 * recordStatus() string (`done` | `overdue` | …) and the label.
 */
const STATUS_CLASS = {
  pending:        'badge-dim',
  overdue:        'badge-red',
  'trrc-missing': 'badge-amber',
  'dat-missing':  'badge-amber',
  unpaid:         'badge-blue',
  done:           'badge-green',
}

export function statusBadge(status, label) {
  const cls = STATUS_CLASS[status] ?? 'badge-dim'
  return html`<span class=${cls}>${label}</span>`
}

/** Inline loading line — used while async data resolves. */
export function loadingLine(text = 'Loading…') {
  return html`<p style="color:var(--mu);font-size:.82rem;padding:.5rem 0">${text}</p>`
}

/** Empty-state block with optional CTA. */
export function emptyState(message, cta) {
  return html`
    <div class="empty-state">
      ${message}
      ${cta ? html`<br><button class="btn-ghost btn-sm" type="button"
                              style="margin-top:.6rem"
                              @click=${cta.onClick}>${cta.label}</button>` : nothing}
    </div>
  `
}

/** Inline error block — used by failed-fetch handlers. */
export function errorLine(message) {
  return html`<p style="color:var(--red);font-size:.82rem">${message}</p>`
}
