'use client'

// A value held outside React state: a change re-renders only the components that read it, not the
// component that owns it and everything below. The editor's save state and zoom change on every
// edit or zoom step, so they live here rather than in the editor stage's state.
import { useSyncExternalStore } from 'react'

export interface ValueStore<T> {
  get: () => T
  set: (next: T) => void
  subscribe: (listener: () => void) => () => void
}

export function valueStore<T>(initial: T): ValueStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** The store's value, re-rendering the caller when it changes. */
export const useValue = <T,>(store: ValueStore<T>) => useSyncExternalStore(store.subscribe, store.get, store.get)
