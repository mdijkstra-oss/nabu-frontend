"use client"

import { useCallback, useRef, useEffect, useLayoutEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useInstance } from "@milkdown/react"
import { editorViewCtx } from "@milkdown/kit/core"
import { annotationsMeta } from "~/lib/editor/annotations/plugin"
import type { Annotation } from "~/domain/data-blocks/attributes/annotations/selectors"
import { HighlightTooltip, type HighlightEntry } from "~/ui/components/HighlightTooltip"
import { elementBorder } from "~/ui/theme/radix"
import { getCodeTitle } from "~/domain/data-blocks/callout/codes/selectors"
import { getFiles } from "~/lib/files/store"
import { patchBlock } from "~/lib/data-blocks/patch"

interface HoverState {
  text: string
  element: HTMLElement
  clientX: number
}

interface AnnotationHoverProps {
  annotations: Annotation[]
  filePath?: string
  children: React.ReactNode
}

const TOOLTIP_GAP = 4
const BRIDGE_UPWARD = 30
const VIEWPORT_MARGIN = 24
const ANNOTATIONS_LANGUAGE = "json-annotations"

const isDecoration = (el: HTMLElement): boolean =>
  el.style.background !== "" && el.style.background !== "none"

const isWithinRect = (x: number, y: number, rect: DOMRect): boolean =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom

const findMatchingAnnotations = (annotations: Annotation[], text: string): Annotation[] =>
  annotations.filter((a) => a.text.includes(text))

const removeAnnotationOp = (id: string) => [
  { op: "remove" as const, path: `/annotations[id=${id}]` },
]

const buildDeleteCallback = (filePath: string, id: string) => () => {
  patchBlock(filePath, ANNOTATIONS_LANGUAGE, removeAnnotationOp(id))
}

const annotationToEntry =
  (files: Record<string, string>, filePath?: string) =>
  (annotation: Annotation, index: number): HighlightEntry => {
    const id = annotation.id
    const canMutate = !!filePath && !!id
    return {
      id: id ?? String(index),
      color: elementBorder(annotation.color),
      title: annotation.code ? getCodeTitle(files, annotation.code) : undefined,
      description: annotation.reason,
      onDelete: canMutate ? buildDeleteCallback(filePath, id) : undefined,
    }
  }

const getLastLineRect = (el: HTMLElement): DOMRect => {
  const rects = el.getClientRects()
  return rects.length > 0 ? rects[rects.length - 1] : el.getBoundingClientRect()
}

const getFirstLineRect = (el: HTMLElement): DOMRect => {
  const rects = el.getClientRects()
  return rects.length > 0 ? rects[0] : el.getBoundingClientRect()
}

const clampLeft = (mouseX: number, width: number): number =>
  Math.min(Math.max(VIEWPORT_MARGIN, mouseX), window.innerWidth - width - VIEWPORT_MARGIN)

type GetEditor = ReturnType<typeof useInstance>[1]

const dispatchAnnotations = (getEditor: GetEditor, loading: boolean, list: Annotation[]): void => {
  if (loading) return
  const editor = getEditor()
  if (!editor) return
  try {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setMeta(annotationsMeta, list))
    })
  } catch {
    /* editor may be destroyed */
  }
}

export const AnnotationHover = ({ annotations, filePath, children }: AnnotationHoverProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const bridgeRef = useRef<HTMLDivElement>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [loading, getEditor] = useInstance()
  const isolatedRef = useRef(false)

  const restoreAnnotations = useCallback(() => {
    if (isolatedRef.current) {
      isolatedRef.current = false
      dispatchAnnotations(getEditor, loading, annotations)
    }
  }, [getEditor, loading, annotations])

  const dismiss = useCallback(() => {
    restoreAnnotations()
    setHover(null)
  }, [restoreAnnotations])

  const cancelDismiss = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  const scheduleDismiss = useCallback(() => {
    cancelDismiss()
    dismissTimerRef.current = setTimeout(dismiss, 50)
  }, [dismiss, cancelDismiss])

  useEffect(() => () => cancelDismiss(), [cancelDismiss])

  const isOnBridge = useCallback((e: MouseEvent) => {
    const bridge = bridgeRef.current
    if (!bridge) return false
    return (
      bridge.contains(e.target as HTMLElement) ||
      isWithinRect(e.clientX, e.clientY, bridge.getBoundingClientRect())
    )
  }, [])

  const handleMouseEnter = useCallback(
    (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!isDecoration(target)) return
      const text = target.textContent ?? ""
      if (!text) return
      cancelDismiss()
      setHover((prev) => {
        const isSameAnnotation = prev !== null && prev.text === text
        return { text, element: target, clientX: isSameAnnotation ? prev.clientX : e.clientX }
      })
    },
    [cancelDismiss]
  )

  const handleMouseLeave = useCallback(
    (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!isDecoration(target)) return
      if (isOnBridge(e)) return
      scheduleDismiss()
    },
    [isOnBridge, scheduleDismiss]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.addEventListener("mouseenter", handleMouseEnter, true)
    container.addEventListener("mouseleave", handleMouseLeave, true)
    return () => {
      container.removeEventListener("mouseenter", handleMouseEnter, true)
      container.removeEventListener("mouseleave", handleMouseLeave, true)
    }
  }, [handleMouseEnter, handleMouseLeave])

  useEffect(() => {
    if (!hover) return

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (isDecoration(target)) return
      if (isOnBridge(e)) return
      scheduleDismiss()
    }

    document.addEventListener("mousemove", handleMouseMove)
    return () => document.removeEventListener("mousemove", handleMouseMove)
  }, [hover, isOnBridge, scheduleDismiss])

  const matchingAnnotations = hover ? findMatchingAnnotations(annotations, hover.text) : []
  const files = getFiles()

  const handleEntryHover = useCallback(
    (entryId: string) => {
      const annotation = matchingAnnotations.find((a) => (a.id ?? "") === entryId)
      if (!annotation) return
      const overlappingIds = new Set(matchingAnnotations.map((a) => a.id ?? ""))
      const nonOverlapping = annotations.filter((a) => !overlappingIds.has(a.id ?? ""))
      isolatedRef.current = true
      dispatchAnnotations(getEditor, loading, [...nonOverlapping, annotation])
    },
    [annotations, matchingAnnotations, getEditor, loading]
  )

  const entries = matchingAnnotations.map(annotationToEntry(files, filePath))

  useLayoutEffect(() => {
    const bridge = bridgeRef.current
    const container = containerRef.current
    if (!bridge || !hover || !container) return

    const lastRect = getLastLineRect(hover.element)
    const firstRect = getFirstLineRect(hover.element)

    const inner = bridge.firstElementChild as HTMLElement
    if (!inner) return
    const tooltipRoot = inner.querySelector("[data-tooltip-root]") as HTMLElement | null
    if (tooltipRoot) tooltipRoot.style.maxHeight = ""
    const contentHeight = inner.offsetHeight
    const contentWidth = inner.offsetWidth

    const spaceBelow = window.innerHeight - lastRect.bottom - TOOLTIP_GAP - VIEWPORT_MARGIN
    const spaceAbove = firstRect.top - TOOLTIP_GAP - VIEWPORT_MARGIN
    const showBelow = spaceBelow >= spaceAbove
    const maxHeight = Math.max(0, showBelow ? spaceBelow : spaceAbove)
    const effectiveHeight = Math.min(contentHeight, maxHeight)

    if (tooltipRoot) tooltipRoot.style.maxHeight = `${maxHeight}px`

    const left = clampLeft(hover.clientX, contentWidth)

    if (showBelow) {
      const bridgeTop = lastRect.bottom - BRIDGE_UPWARD
      bridge.style.left = `${left}px`
      bridge.style.width = `${contentWidth}px`
      bridge.style.top = `${bridgeTop}px`
      bridge.style.paddingTop = `${lastRect.bottom - bridgeTop + TOOLTIP_GAP}px`
      bridge.style.paddingBottom = "0"
      inner.style.marginLeft = "0"
    } else {
      const tooltipTop = firstRect.top - TOOLTIP_GAP - effectiveHeight
      bridge.style.left = `${left}px`
      bridge.style.width = `${contentWidth}px`
      bridge.style.top = `${tooltipTop}px`
      bridge.style.paddingTop = "0"
      bridge.style.paddingBottom = `${firstRect.top + BRIDGE_UPWARD - tooltipTop - effectiveHeight}px`
      inner.style.marginLeft = "0"
    }

    bridge.style.visibility = "visible"
  }, [hover])

  return (
    <div ref={containerRef} className="relative">
      {children}
      {hover &&
        entries.length > 0 &&
        createPortal(
          <div
            ref={bridgeRef}
            style={{
              position: "fixed",
              zIndex: 9999,
              visibility: "hidden",
              pointerEvents: "auto",
              background: "transparent",
            }}
          >
            <div style={{ pointerEvents: "auto" }}>
              <HighlightTooltip
                entries={entries}
                onEntryHover={handleEntryHover}
                onEntryLeave={restoreAnnotations}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
