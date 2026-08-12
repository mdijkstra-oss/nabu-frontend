// The one place the app-wide ceiling on in-flight model calls exists. FIFO, so
// no site needs to compute a product of nested pools to reason about load.

export const MODEL_CALL_LIMIT = 10

export interface Limiter {
  run: <T>(fn: () => Promise<T>) => Promise<T>
}

export const createLimiter = (capacity: number): Limiter => {
  let active = 0
  const waiting: (() => void)[] = []

  const acquire = (): Promise<void> => {
    if (active < capacity) {
      active++
      return Promise.resolve()
    }
    return new Promise((admit) => waiting.push(admit))
  }

  const release = (): void => {
    const admit = waiting.shift()
    if (admit) {
      admit()
    } else {
      active--
    }
  }

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    await acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }

  return { run }
}
