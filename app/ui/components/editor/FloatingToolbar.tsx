"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useInstance } from "@milkdown/react"
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react"
import { EditorToolbar } from "./EditorToolbar"

interface FloatingToolbarProps {
  children: ReactNode
}

const TOOLBAR_GAP = 8
const VIEWPORT_MARGIN = 12
const MIN_TOP_SPACE = 80

const getNativeSelectionRect = (container: HTMLElement): DOMRect | null => {
  const domSel = window.getSelection()
  if (!domSel || domSel.rangeCount === 0 || domSel.isCollapsed) return null
  const range = domSel.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return rect
}

const clampHorizontal = (x: number): number =>
  Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - VIEWPORT_MARGIN))

const TOOLBAR_GROUPS = [
  [
    { icon: <Heading1 />, disabled: true },
    { icon: <Heading2 />, disabled: true },
    { icon: <Heading3 />, disabled: true },
  ],
  [
    { icon: <Bold />, disabled: true },
    { icon: <Italic />, disabled: true },
    { icon: <Strikethrough />, disabled: true },
  ],
  [
    { icon: <Code2 />, disabled: true },
    { icon: <Quote />, disabled: true },
  ],
  [
    { icon: <List />, disabled: true },
    { icon: <ListOrdered />, disabled: true },
  ],
]

const isLeavingTo = (e: React.MouseEvent, ref: React.RefObject<HTMLDivElement | null>): boolean =>
  ref.current?.contains(e.relatedTarget as Node) ?? false

export const FloatingToolbar = ({ children }: FloatingToolbarProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const [, getEditor] = useInstance()
  void getEditor
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [hovered, setHovered] = useState(true)

  const updateSelection = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    setRect(getNativeSelectionRect(container))
  }, [])

  const scheduleUpdate = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      updateSelection()
    })
  }, [updateSelection])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (portalRef.current?.contains(e.target as Node)) return
      setRect(null)
    }

    document.addEventListener("selectionchange", scheduleUpdate)
    document.addEventListener("mousedown", handleMouseDown)

    return () => {
      document.removeEventListener("selectionchange", scheduleUpdate)
      document.removeEventListener("mousedown", handleMouseDown)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [scheduleUpdate])

  const handleContainerEnter = useCallback(() => {
    setHovered(true)
    updateSelection()
  }, [updateSelection])

  const handleContainerLeave = useCallback((e: React.MouseEvent) => {
    if (isLeavingTo(e, portalRef)) return
    setHovered(false)
  }, [])

  const handlePortalLeave = useCallback((e: React.MouseEvent) => {
    if (isLeavingTo(e, containerRef)) return
    setHovered(false)
  }, [])

  const visible = rect && hovered
  const centerX = rect ? clampHorizontal(rect.left + rect.width / 2) : 0
  const showAbove = rect ? rect.top > MIN_TOP_SPACE : true
  const top = rect ? (showAbove ? rect.top - TOOLBAR_GAP : rect.bottom + TOOLBAR_GAP) : 0
  const transform = showAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)"

  return (
    <div ref={containerRef} onMouseEnter={handleContainerEnter} onMouseLeave={handleContainerLeave}>
      {children}
      {visible &&
        createPortal(
          <div
            ref={portalRef}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={handlePortalLeave}
            style={{
              position: "fixed",
              left: `${centerX}px`,
              top: `${top}px`,
              transform,
              zIndex: 9999,
            }}
          >
            <EditorToolbar groups={TOOLBAR_GROUPS} />
          </div>,
          document.body
        )}
    </div>
  )
}
