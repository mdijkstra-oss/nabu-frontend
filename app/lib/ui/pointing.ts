import { useSyncExternalStore } from "react"

const EMPTY: ReadonlySet<string> = new Set()

let pointed: ReadonlySet<string> = EMPTY
const listeners = new Set<() => void>()

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const notify = (): void => {
  for (const fn of listeners) fn()
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

const getSnapshot = (): ReadonlySet<string> => pointed

export const pointAt = (ids: readonly string[]): void => {
  const next: ReadonlySet<string> = ids.length === 0 ? EMPTY : new Set(ids)
  if (sameSet(pointed, next)) return
  pointed = next
  notify()
}

export const clearPointing = (): void => pointAt([])

export const usePointedAt = (id: string | undefined): boolean => {
  const set = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return id !== undefined && set.has(id)
}
