import { useSyncExternalStore } from "react"

let pendingFile: string | null = null
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

export const requestTitleEdit = (filename: string): void => {
  if (pendingFile === filename) return
  pendingFile = filename
  notify()
}

export const consumeTitleEdit = (filename: string): boolean => {
  if (pendingFile !== filename) return false
  pendingFile = null
  notify()
  return true
}

export const useTitleEditRequested = (filename: string): boolean =>
  useSyncExternalStore(
    subscribe,
    () => pendingFile === filename,
    () => false
  )
