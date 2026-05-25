export interface RawLlmCall {
  id: number
  endpoint: string
  requestBody: string
  rawResponse: string | null
  streamingContent: string
  timestamp: number
  duration: number | null
}

let calls: RawLlmCall[] = []
let nextId = 1
let listeners: (() => void)[] = []
let pendingFrame: ReturnType<typeof requestAnimationFrame> | null = null

const notify = (): void => listeners.forEach((l) => l())

const notifyThrottled = (): void => {
  if (pendingFrame !== null) return
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null
    notify()
  })
}

export const startRawCall = (endpoint: string, requestBody: string): number => {
  const id = nextId++
  calls = [
    ...calls,
    {
      id,
      endpoint,
      requestBody,
      rawResponse: null,
      streamingContent: "",
      timestamp: Date.now(),
      duration: null,
    },
  ]
  notify()
  return id
}

export const updateRawCallStream = (id: number, content: string): void => {
  calls = calls.map((c) => (c.id === id ? { ...c, streamingContent: content } : c))
  notifyThrottled()
}

export const completeRawCall = (id: number, rawResponse: string, duration: number): void => {
  calls = calls.map((c) =>
    c.id === id ? { ...c, rawResponse, duration, timestamp: Date.now() } : c
  )
  notify()
}

export const getRawCalls = (): RawLlmCall[] => calls

const CANCELED_RESPONSE = JSON.stringify([{ type: "error", content: "Canceled by user" }])

export const cancelPendingCalls = (): void => {
  const hasPending = calls.some((c) => c.rawResponse === null)
  if (!hasPending) return
  calls = calls.map((c) =>
    c.rawResponse === null ? { ...c, rawResponse: CANCELED_RESPONSE, duration: -1 } : c
  )
  notify()
}

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
