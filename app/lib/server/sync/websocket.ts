import { getWsUrl } from "../env"
import { calculateBackoff } from "~/lib/utils/backoff"
import type { Command } from "./types"

interface WebSocketCallbacks {
  onCommand: (command: Command) => void
  onConnect?: () => void
  onDisconnect?: () => void
  onError?: (error: Event) => void
}

interface WebSocketConnection {
  close: () => void
}

const MAX_RECONNECT_DELAY = 30000

export const createWebSocket = (
  projectId: string,
  callbacks: WebSocketCallbacks
): WebSocketConnection => {
  let ws: WebSocket | null = null
  let reconnectAttempt = 0
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const connect = () => {
    if (closed) return

    const url = getWsUrl(`/ws/${projectId}`)
    ws = new WebSocket(url)

    ws.onopen = () => {
      reconnectAttempt = 0
      callbacks.onConnect?.()
    }

    ws.onmessage = (event) => {
      try {
        const command = JSON.parse(event.data) as Command
        callbacks.onCommand(command)
      } catch {
        void 0
      }
    }

    ws.onclose = () => {
      if (closed) return
      callbacks.onDisconnect?.()
      scheduleReconnect()
    }

    ws.onerror = (event) => {
      callbacks.onError?.(event)
    }
  }

  const scheduleReconnect = () => {
    if (closed) return

    const delay = calculateBackoff(reconnectAttempt, { maxDelay: MAX_RECONNECT_DELAY })
    reconnectAttempt++

    reconnectTimeout = setTimeout(connect, delay)
  }

  const close = () => {
    closed = true
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
  }

  connect()

  return { close }
}
