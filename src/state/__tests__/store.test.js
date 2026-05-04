import { describe, it, expect, vi } from 'vitest'
import { createStore } from '../store.js'

describe('createStore — basic API', () => {
  it('returns the initial state from get()', () => {
    const s = createStore({ count: 0 })
    expect(s.get().count).toBe(0)
  })

  it('shallow-merges an object patch', () => {
    const s = createStore({ count: 0, name: 'a' })
    s.update({ count: 1 })
    expect(s.get()).toEqual({ count: 1, name: 'a' })
  })

  it('accepts a functional patch', () => {
    const s = createStore({ count: 0 })
    s.update((cur) => ({ count: cur.count + 5 }))
    expect(s.get().count).toBe(5)
  })

  it('select() reads through a projection', () => {
    const s = createStore({ a: { b: 'hi' } })
    expect(s.select((x) => x.a.b)).toBe('hi')
  })
})

describe('createStore — subscribe semantics', () => {
  it('fires the listener immediately with the current value', () => {
    const s = createStore({ count: 7 })
    const seen = []
    s.subscribe((x) => x.count, (n) => seen.push(n))
    expect(seen).toEqual([7])
  })

  it('fires again on change', () => {
    const s = createStore({ count: 0 })
    const seen = []
    s.subscribe((x) => x.count, (n) => seen.push(n))
    s.update({ count: 1 })
    s.update({ count: 2 })
    expect(seen).toEqual([0, 1, 2])
  })

  it('does NOT fire when the selected slice is unchanged', () => {
    const s = createStore({ count: 0, other: 'a' })
    const fn = vi.fn()
    s.subscribe((x) => x.count, fn)
    fn.mockClear()
    s.update({ other: 'b' })   // unrelated change
    expect(fn).not.toHaveBeenCalled()
  })

  it('unsubscribe stops further listener calls', () => {
    const s = createStore({ count: 0 })
    const fn = vi.fn()
    const off = s.subscribe((x) => x.count, fn)
    fn.mockClear()
    s.update({ count: 1 })
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    s.update({ count: 2 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('multiple selectors fire independently', () => {
    const s = createStore({ a: 1, b: 2 })
    const seenA = [], seenB = []
    s.subscribe((x) => x.a, (v) => seenA.push(v))
    s.subscribe((x) => x.b, (v) => seenB.push(v))
    s.update({ a: 10 })
    expect(seenA).toEqual([1, 10])
    expect(seenB).toEqual([2])
  })
})
