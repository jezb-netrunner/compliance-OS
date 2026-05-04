// src/state/store.js
//
// Tiny pub/sub store. Replaces the audit's "14 unprefixed mutable
// globals" pattern (HI-10) without forcing a Redux/Pinia/Zustand
// dependency. The inline app script reaches it via window.appStore.
//
// Usage:
//
//   import { createStore } from './state/store.js'
//
//   export const store = createStore({
//     practitioner: null,
//     activeClientId: null,
//     roster: { filter: 'all', search: '', page: 0 },
//   })
//
//   // read
//   store.get().roster.filter
//   store.select((s) => s.roster.filter)
//
//   // write — patch is shallow-merged at the top level; nested
//   // objects must be replaced wholesale to fire correctly.
//   store.update({ activeClientId: 'abc' })
//   store.update((s) => ({ roster: { ...s.roster, page: s.roster.page + 1 } }))
//
//   // subscribe — fired whenever the selected slice changes.
//   const unsub = store.subscribe(
//     (s) => s.activeClientId,
//     (id) => { … },
//   )
//
// Selectors are compared with Object.is, so functions / arrays /
// objects must be returned by reference. For derived values, return
// the same instance when nothing changed (e.g. via a memoised pick).

/** @template S */
export function createStore(initialState) {
  let state = initialState
  const subs = new Set()

  function get() {
    return state
  }

  /**
   * @param {Partial<S> | ((s: S) => Partial<S>)} patch
   */
  function update(patch) {
    const next = (typeof patch === 'function') ? patch(state) : patch
    if (!next) return
    const prev = state
    state = { ...state, ...next }
    if (prev === state) return
    for (const sub of subs) sub(state, prev)
  }

  /**
   * Subscribe to a slice. The listener fires immediately with the
   * current value, then again on every change where Object.is(prev,
   * next) is false. Returns an unsubscribe function.
   */
  function subscribe(selector, listener) {
    let last = selector(state)
    listener(last, undefined)
    const wrapped = (next) => {
      const value = selector(next)
      if (Object.is(value, last)) return
      const prev = last
      last = value
      listener(value, prev)
    }
    subs.add(wrapped)
    return () => subs.delete(wrapped)
  }

  /** Read-only one-shot equivalent of subscribe(). */
  function select(selector) {
    return selector(state)
  }

  return { get, update, subscribe, select }
}
