"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
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
  BookMarked,
  Highlighter,
} from "lucide-react"
import { EditorToolbar } from "./EditorToolbar"
import { IconButton } from "~/ui/components/IconButton"
import { useFiles } from "~/ui/hooks/useFiles"
import { getResolvedSelectedCodes, type Code } from "~/domain/data-blocks/callout/codes/selectors"
import { getStoredAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import { solidBackground, elementBackground } from "~/ui/theme/radix"
import { useIsReadOnly } from "./ReadOnlyContext"
import { resolveEditorSelection } from "~/lib/editor/selection-context"
import { buildAnnotationPatchOps } from "~/lib/editor/annotations/merge"
import { executeUxAction } from "~/lib/data-blocks/file-action"
import { getFileRaw } from "~/lib/files/store"
import { generateShortId } from "~/lib/data-blocks/uuid"

interface FloatingToolbarProps {
  children: ReactNode
}

const TOOLBAR_GAP = 8
const VIEWPORT_MARGIN = 12
const MIN_TOP_SPACE = 80
const ANNOTATIONS_LANGUAGE = "json-annotations"

interface SelectionState {
  rect: DOMRect
  hasRange: boolean
}

const getNativeSelectionState = (
  container: HTMLElement,
  selectionOnly: boolean
): SelectionState | null => {
  const domSel = window.getSelection()
  if (!domSel || domSel.rangeCount === 0) return null
  const hasRange = !domSel.isCollapsed
  if (selectionOnly && !hasRange) return null
  const range = domSel.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return { rect, hasRange }
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

const SpotlightCodebookIcon = () => (
  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-400">
    <BookMarked className="h-3 w-3 text-white" />
  </div>
)

const MarkerHighlightIcon = () => (
  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-300">
    <Highlighter className="h-3 w-3 text-amber-800" />
  </div>
)

const POPUP_MAX_HEIGHT = 110

const CodeEntry = ({ name, color, onClick }: Code & { onClick: () => void }) => (
  <div
    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors hover:bg-[var(--code-hover-bg)]"
    style={{ "--code-hover-bg": elementBackground(color) } as React.CSSProperties}
    onClick={onClick}
  >
    <div
      className="h-3 w-3 flex-none rounded-full"
      style={{ backgroundColor: solidBackground(color) }}
    />
    <span className="text-caption font-caption text-default-font truncate">{name}</span>
  </div>
)

const AnnotationPill = ({
  codes,
  onCodeClick,
}: {
  codes: readonly Code[]
  onCodeClick: (codeId: string) => void
}) => {
  const triggerRef = useRef<HTMLDivElement>(null)
  const [popupPosition, setPopupPosition] = useState<"above" | "below" | null>(null)
  const hasCodes = codes.length > 0

  const handleShowPopup = useCallback(() => {
    if (!triggerRef.current) return
    const bottom = triggerRef.current.getBoundingClientRect().bottom
    const hasSpaceBelow = bottom + POPUP_MAX_HEIGHT < window.innerHeight
    setPopupPosition(hasSpaceBelow ? "below" : "above")
  }, [])

  const handleHidePopup = useCallback(() => setPopupPosition(null), [])

  const popupPositionClass = popupPosition === "below" ? "top-full pt-4" : "bottom-full pb-4"

  return (
    <div className="flex items-start gap-1 rounded-xl border border-solid border-neutral-border bg-default-background px-2 py-2 shadow-md">
      <div
        ref={triggerRef}
        className="relative"
        onMouseEnter={hasCodes ? handleShowPopup : undefined}
        onMouseLeave={handleHidePopup}
      >
        <IconButton
          size="small"
          icon={<SpotlightCodebookIcon />}
          variant="neutral-tertiary"
          disabled={!hasCodes}
          title={hasCodes ? undefined : "First select codebook entry from sidebar"}
        />
        {popupPosition && (
          <div className={`absolute left-1/2 -translate-x-1/2 ${popupPositionClass}`}>
            <div className="min-w-[180px] max-h-[102px] overflow-hidden overflow-y-auto rounded-xl bg-default-background border border-solid border-neutral-border shadow-lg">
              {codes.map((code) => (
                <CodeEntry key={code.id} {...code} onClick={() => onCodeClick(code.id)} />
              ))}
            </div>
          </div>
        )}
      </div>
      <IconButton size="small" icon={<MarkerHighlightIcon />} variant="neutral-tertiary" disabled />
    </div>
  )
}

const isLeavingTo = (e: React.MouseEvent, ref: React.RefObject<HTMLDivElement | null>): boolean =>
  ref.current?.contains(e.relatedTarget as Node) ?? false

const generateAnnotationId = (): string => `annotation-${generateShortId()}`

export const FloatingToolbar = ({ children }: FloatingToolbarProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const selectionOnly = useIsReadOnly()
  const { files } = useFiles()
  const selectedCodes = useMemo(() => getResolvedSelectedCodes(files), [files])
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [hovered, setHovered] = useState(true)

  const handleCodeClick = useCallback((codeId: string) => {
    const resolved = resolveEditorSelection()
    if (!resolved) return

    const fileContent = getFileRaw(resolved.filePath)
    if (!fileContent) return

    const annotationsForCode = getStoredAnnotations(fileContent).filter((a) => a.code === codeId)

    const { ops } = buildAnnotationPatchOps(
      { start: resolved.fullWords.startOffset, end: resolved.fullWords.endOffset },
      fileContent,
      annotationsForCode,
      codeId,
      generateAnnotationId()
    )

    executeUxAction([
      { path: resolved.filePath, language: ANNOTATIONS_LANGUAGE, ops, exactText: true },
    ])
  }, [])

  const updateSelection = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    setSelection(getNativeSelectionState(container, selectionOnly))
  }, [selectionOnly])

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
      setSelection(null)
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

  const rect = selection?.rect ?? null
  const hasRange = selection?.hasRange ?? false
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
            className="flex items-center gap-2"
            style={{
              position: "fixed",
              left: `${centerX}px`,
              top: `${top}px`,
              transform,
              zIndex: 9999,
            }}
          >
            <EditorToolbar groups={TOOLBAR_GROUPS} />
            {hasRange && <AnnotationPill codes={selectedCodes} onCodeClick={handleCodeClick} />}
          </div>,
          document.body
        )}
    </div>
  )
}
