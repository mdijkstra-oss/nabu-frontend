import { useEffect, useRef } from "react"
import { subscribeBlocks, getAllBlocks } from "~/lib/agent/client/store"
import { type NotificationEvent, detectBlockEvents, isTextEvent } from "~/lib/agent/notifications"

const ensurePermission = (): void => {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission()
  }
}

const isPermitted = (): boolean =>
  typeof Notification !== "undefined" && Notification.permission === "granted"

const fireNotification = (title: string, body: string): void => {
  if (!document.hidden && document.hasFocus()) return
  if (!isPermitted()) {
    ensurePermission()
    return
  }
  const n = new Notification(title, { body })
  n.onclick = () => {
    window.focus()
    n.close()
  }
}

const TEXT_DEBOUNCE_MS = 2000

export const useNotifications = (): void => {
  const prevBlockCount = useRef(getAllBlocks().length)
  const textTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingText = useRef<NotificationEvent | null>(null)

  useEffect(() => {
    const flushText = () => {
      if (pendingText.current) {
        fireNotification(pendingText.current.title, pendingText.current.body)
        pendingText.current = null
      }
    }

    const scheduleText = (event: NotificationEvent) => {
      pendingText.current = event
      if (textTimer.current) clearTimeout(textTimer.current)
      textTimer.current = setTimeout(flushText, TEXT_DEBOUNCE_MS)
    }

    const onBlocksChange = () => {
      const allBlocks = getAllBlocks()
      const prev = prevBlockCount.current
      prevBlockCount.current = allBlocks.length
      if (allBlocks.length <= prev) return
      const newBlocks = allBlocks.slice(prev)
      for (const event of detectBlockEvents(newBlocks, allBlocks)) {
        if (isTextEvent(event)) {
          scheduleText(event)
        } else {
          fireNotification(event.title, event.body)
        }
      }
    }

    const unsubBlocks = subscribeBlocks(onBlocksChange)
    return () => {
      unsubBlocks()
      if (textTimer.current) clearTimeout(textTimer.current)
    }
  }, [])
}
