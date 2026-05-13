import { noop } from "./noop"

export const createKeyedQueue = (): (<T>(key: string, fn: () => Promise<T>) => Promise<T>) => {
  const chains = new Map<string, Promise<unknown>>()
  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = chains.get(key) ?? Promise.resolve()
    const next = prev.catch(noop).then(fn)
    chains.set(key, next)
    next.catch(noop).then(() => {
      if (chains.get(key) === next) chains.delete(key)
    })
    return next
  }
}
