export interface RawLlmCall {
  id: number
  endpoint: string
  requestBody: string
  rawResponse: string | null
  timestamp: number
  duration: number | null
}

let calls: RawLlmCall[] = []
let nextId = 1
let listeners: (() => void)[] = []

const notify = (): void => listeners.forEach((l) => l())

export const startRawCall = (endpoint: string, requestBody: string): number => {
  const id = nextId++
  calls = [
    ...calls,
    { id, endpoint, requestBody, rawResponse: null, timestamp: Date.now(), duration: null },
  ]
  notify()
  return id
}

export const completeRawCall = (id: number, rawResponse: string, duration: number): void => {
  calls = calls.map((c) =>
    c.id === id ? { ...c, rawResponse, duration, timestamp: Date.now() } : c
  )
  notify()
}

export const getRawCalls = (): RawLlmCall[] => calls

export const clearRawCalls = (): void => {
  calls = []
  nextId = 1
  notify()
}

export const subscribeRawCalls = (listener: () => void): (() => void) => {
  listeners = [...listeners, listener]
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}
