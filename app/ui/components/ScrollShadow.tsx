"use client"

import { useEffect, useState, type ReactNode, type RefObject } from "react"
import { cn } from "~/ui/utils"

interface ScrollShadowProps {
  scrollRef: RefObject<HTMLDivElement | null>
  children: ReactNode
  className?: string
  edges?: { top?: boolean; bottom?: boolean }
}

interface ScrollEdges {
  top: boolean
  bottom: boolean
}

const TOP_SHADOW = "inset 0 10px 8px -10px rgba(0, 0, 0, 0.08)"
const BOTTOM_SHADOW = "inset 0 -10px 8px -10px rgba(0, 0, 0, 0.08)"
const EDGE_TOLERANCE = 1

const buildBoxShadow = ({ top, bottom }: ScrollEdges): string => {
  const parts = [top ? TOP_SHADOW : null, bottom ? BOTTOM_SHADOW : null].filter(Boolean)
  return parts.length ? parts.join(", ") : "none"
}

const sameEdges = (a: ScrollEdges, b: ScrollEdges): boolean =>
  a.top === b.top && a.bottom === b.bottom

export const ScrollShadow = ({ scrollRef, children, className, edges }: ScrollShadowProps) => {
  const enableTop = edges?.top ?? true
  const enableBottom = edges?.bottom ?? true
  const [visible, setVisible] = useState<ScrollEdges>({ top: false, bottom: false })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const update = () => {
      const next: ScrollEdges = {
        top: enableTop && el.scrollTop > EDGE_TOLERANCE,
        bottom: enableBottom && el.scrollTop + el.clientHeight < el.scrollHeight - EDGE_TOLERANCE,
      }
      setVisible((prev) => (sameEdges(prev, next) ? prev : next))
    }

    update()
    el.addEventListener("scroll", update, { passive: true })
    const sizeObserver = new ResizeObserver(update)
    sizeObserver.observe(el)
    const childObserver = new MutationObserver(update)
    childObserver.observe(el, { childList: true, subtree: true, characterData: true })

    return () => {
      el.removeEventListener("scroll", update)
      sizeObserver.disconnect()
      childObserver.disconnect()
    }
  }, [scrollRef, enableTop, enableBottom])

  return (
    <div
      ref={scrollRef}
      className={cn(
        "flex grow shrink basis-0 overflow-auto transition-shadow duration-200",
        className
      )}
      style={{ boxShadow: buildBoxShadow(visible) }}
    >
      {children}
    </div>
  )
}
