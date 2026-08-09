"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
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

export interface SelectionState {
  top: number
  centerX: number
  hasRange: boolean
  showAbove: boolean
}

const isSelectionBackward = (sel: Selection): boolean => {
  if (sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return false
  const position = sel.anchorNode.compareDocumentPosition(sel.focusNode)
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return false
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return true
  return sel.anchorOffset > sel.focusOffset
}

const getNativeSelectionRect = (
  container: HTMLElement,
  selectionOnly: boolean
): { rect: DOMRect; hasRange: boolean; isBackward: boolean } | null => {
  const domSel = window.getSelection()
  if (!domSel || domSel.rangeCount === 0) return null
  const hasRange = !domSel.isCollapsed
  if (selectionOnly && !hasRange) return null
  const range = domSel.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return { rect, hasRange, isBackward: isSelectionBackward(domSel) }
}

const clampCenterX = (x: number, containerWidth: number): number =>
  Math.max(VIEWPORT_MARGIN, Math.min(x, containerWidth - VIEWPORT_MARGIN))

const computePlacement = (rect: DOMRect, isBackward: boolean): boolean => {
  if (isBackward) return false
  return rect.top > MIN_TOP_SPACE
}

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

export const AnnotationPill = ({
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

export const SelectionToolbarOverlay = ({
  selection,
  codes,
  onCodeClick,
}: {
  selection: SelectionState
  codes: readonly Code[]
  onCodeClick: (codeId: string) => void
}) => (
  <div
    className="flex items-center gap-2"
    style={{
      position: "absolute",
      left: `${selection.centerX}px`,
      top: `${selection.top}px`,
      transform: selection.showAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)",
      zIndex: 9999,
    }}
  >
    <EditorToolbar groups={TOOLBAR_GROUPS} />
    {selection.hasRange && <AnnotationPill codes={codes} onCodeClick={onCodeClick} />}
  </div>
)

const generateAnnotationId = (): string => `annotation-${generateShortId()}`

export const FloatingToolbar = ({ children }: FloatingToolbarProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const placementRef = useRef<boolean | null>(null)
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
    const raw = getNativeSelectionRect(container, selectionOnly)
    if (!raw) {
      placementRef.current = null
      setSelection(null)
      return
    }
    const containerRect = container.getBoundingClientRect()
    const showAbove = placementRef.current ?? computePlacement(raw.rect, raw.isBackward)
    placementRef.current = showAbove
    const top = showAbove
      ? raw.rect.top - containerRect.top - TOOLBAR_GAP
      : raw.rect.bottom - containerRect.top + TOOLBAR_GAP
    const centerX = clampCenterX(
      raw.rect.left - containerRect.left + raw.rect.width / 2,
      containerRect.width
    )
    setSelection({ top, centerX, hasRange: raw.hasRange, showAbove })
  }, [selectionOnly])

  const scheduleUpdate = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      placementRef.current = null
      updateSelection()
    })
  }, [updateSelection])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (toolbarRef.current?.contains(e.target as Node)) return
      placementRef.current = null
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

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimerRef.current = setTimeout(() => setHovered(false), 200)
  }, [cancelHide])

  useEffect(() => () => cancelHide(), [cancelHide])

  const handleContainerEnter = useCallback(() => {
    cancelHide()
    setHovered(true)
    updateSelection()
  }, [cancelHide, updateSelection])

  const handleContainerLeave = useCallback(() => {
    scheduleHide()
  }, [scheduleHide])

  const visible = selection && hovered

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleContainerEnter}
      onMouseLeave={handleContainerLeave}
    >
      {children}
      {visible && (
        <div
          ref={toolbarRef}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <SelectionToolbarOverlay
            selection={selection}
            codes={selectedCodes}
            onCodeClick={handleCodeClick}
          />
        </div>
      )}
    </div>
  )
}
