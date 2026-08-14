"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Strikethrough,
  BookMarked,
} from "lucide-react"
import { editorViewCtx, type CmdKey } from "@milkdown/kit/core"
import {
  liftListItemCommand,
  toggleEmphasisCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark"
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm"
import { lift } from "@milkdown/kit/prose/commands"
import type { Command, EditorState } from "@milkdown/kit/prose/state"
import type { MarkType } from "@milkdown/kit/prose/model"
import { callCommand } from "@milkdown/utils"
import { useInstance } from "@milkdown/react"
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

interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

const intersect = (a: Bounds, b: Bounds): Bounds => ({
  left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom),
})

const getVisibleBounds = (container: HTMLElement): Bounds => {
  let bounds: Bounds = container.getBoundingClientRect()
  for (let node = container.parentElement; node; node = node.parentElement) {
    const { overflow, overflowX, overflowY } = getComputedStyle(node)
    if (/auto|scroll|hidden|clip/.test(overflow + overflowX + overflowY)) {
      bounds = intersect(bounds, node.getBoundingClientRect())
    }
  }
  return intersect(bounds, {
    left: VIEWPORT_MARGIN,
    top: VIEWPORT_MARGIN,
    right: window.innerWidth - VIEWPORT_MARGIN,
    bottom: window.innerHeight - VIEWPORT_MARGIN,
  })
}

const clampShift = (start: number, end: number, min: number, max: number): number => {
  if (end - start > max - min) return min - start
  if (start < min) return min - start
  if (end > max) return max - end
  return 0
}

const computePlacement = (rect: DOMRect, isBackward: boolean): boolean => {
  if (isBackward) return false
  return rect.top > MIN_TOP_SPACE
}

export type RunEditorCommand = <T>(key: CmdKey<T>, payload?: T) => void
export type RunProseCommand = (command: Command) => void

export interface ActiveFormats {
  heading: number
  bold: boolean
  italic: boolean
  strike: boolean
  quote: boolean
  bulletList: boolean
  orderedList: boolean
}

export const INACTIVE_FORMATS: ActiveFormats = {
  heading: 0,
  bold: false,
  italic: false,
  strike: false,
  quote: false,
  bulletList: false,
  orderedList: false,
}

const isMarkActive = (state: EditorState, type: MarkType | undefined): boolean => {
  if (!type) return false
  const { empty, from, to, $from } = state.selection
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks())
  return state.doc.rangeHasMark(from, to, type)
}

export const getActiveFormats = (state: EditorState): ActiveFormats => {
  const { schema } = state
  const { $from } = state.selection
  const active = {
    ...INACTIVE_FORMATS,
    bold: isMarkActive(state, schema.marks.strong),
    italic: isMarkActive(state, schema.marks.emphasis),
    strike: isMarkActive(state, schema.marks.strike_through),
  }
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth)
    if (node.type === schema.nodes.heading) active.heading = node.attrs.level as number
    if (node.type === schema.nodes.blockquote) active.quote = true
    if (node.type === schema.nodes.bullet_list) active.bulletList = true
    if (node.type === schema.nodes.ordered_list) active.orderedList = true
  }
  return active
}

export const buildToolbarGroups = (
  run: RunEditorCommand,
  runProse: RunProseCommand,
  active: ActiveFormats
) => {
  const heading = (level: number, icon: ReactNode) => ({
    icon,
    active: active.heading === level,
    onClick: () =>
      active.heading === level
        ? run(turnIntoTextCommand.key)
        : run(wrapInHeadingCommand.key, level),
  })
  const list = (isActive: boolean, icon: ReactNode, wrap: CmdKey<unknown>) => ({
    icon,
    active: isActive,
    onClick: () => (isActive ? run(liftListItemCommand.key) : run(wrap)),
  })
  return [
    [
      {
        icon: <Pilcrow />,
        active: active.heading === 0,
        onClick: () => run(turnIntoTextCommand.key),
      },
      heading(1, <Heading1 />),
      heading(2, <Heading2 />),
      heading(3, <Heading3 />),
    ],
    [
      { icon: <Bold />, active: active.bold, onClick: () => run(toggleStrongCommand.key) },
      { icon: <Italic />, active: active.italic, onClick: () => run(toggleEmphasisCommand.key) },
      {
        icon: <Strikethrough />,
        active: active.strike,
        onClick: () => run(toggleStrikethroughCommand.key),
      },
    ],
    [
      {
        icon: <Quote />,
        active: active.quote,
        onClick: () => (active.quote ? runProse(lift) : run(wrapInBlockquoteCommand.key)),
      },
    ],
    [
      list(active.bulletList, <List />, wrapInBulletListCommand.key),
      list(active.orderedList, <ListOrdered />, wrapInOrderedListCommand.key),
    ],
  ]
}

const SpotlightCodebookIcon = () => (
  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-400">
    <BookMarked className="h-3 w-3 text-white" />
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
    </div>
  )
}

export const SelectionToolbarOverlay = ({
  selection,
  codes,
  onCodeClick,
  groups,
}: {
  selection: SelectionState
  codes: readonly Code[]
  onCodeClick: (codeId: string) => void
  groups: ReturnType<typeof buildToolbarGroups>
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
    <EditorToolbar groups={groups} />
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
  const [, getEditor] = useInstance()
  const runCommand = useCallback(
    <T,>(key: CmdKey<T>, payload?: T) => getEditor()?.action(callCommand(key, payload)),
    [getEditor]
  )
  const runProse = useCallback(
    (command: Command) =>
      getEditor()?.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        command(view.state, view.dispatch, view)
      }),
    [getEditor]
  )
  const selectedCodes = useMemo(() => getResolvedSelectedCodes(files), [files])
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [hovered, setHovered] = useState(true)
  const toolbarGroups = useMemo(() => {
    let active = INACTIVE_FORMATS
    if (selection) {
      getEditor()?.action((ctx) => {
        active = getActiveFormats(ctx.get(editorViewCtx).state)
      })
    }
    const groups = buildToolbarGroups(runCommand, runProse, active)
    return selectionOnly
      ? groups.map((group) => group.map((item) => ({ ...item, disabled: true })))
      : groups
  }, [runCommand, runProse, selectionOnly, selection, getEditor])

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

  // Moving off the toolbar back onto the text schedules a hide without a
  // compensating container mouseenter; any movement inside restores it.
  const handleContainerMove = useCallback(() => {
    cancelHide()
    setHovered(true)
  }, [cancelHide])

  const visible = selection && hovered

  const [clampOffset, setClampOffset] = useState({ dx: 0, dy: 0 })
  const clampOffsetRef = useRef(clampOffset)

  useLayoutEffect(() => {
    const overlayEl = toolbarRef.current?.firstElementChild as HTMLElement | null
    const container = containerRef.current
    if (!selection || !hovered || !overlayEl || !container) return
    const rect = overlayEl.getBoundingClientRect()
    const prev = clampOffsetRef.current
    const rawLeft = rect.left - prev.dx
    const rawTop = rect.top - prev.dy
    const bounds = getVisibleBounds(container)
    const next = {
      dx: clampShift(rawLeft, rawLeft + rect.width, bounds.left, bounds.right),
      dy: clampShift(rawTop, rawTop + rect.height, bounds.top, bounds.bottom),
    }
    if (next.dx !== prev.dx || next.dy !== prev.dy) {
      clampOffsetRef.current = next
      setClampOffset(next)
    }
  }, [selection, hovered])

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleContainerEnter}
      onMouseMove={handleContainerMove}
      onMouseLeave={handleContainerLeave}
    >
      {children}
      {visible && (
        <div
          ref={toolbarRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate(${clampOffset.dx}px, ${clampOffset.dy}px)`,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <SelectionToolbarOverlay
            selection={selection}
            codes={selectedCodes}
            onCodeClick={handleCodeClick}
            groups={toolbarGroups}
          />
        </div>
      )}
    </div>
  )
}
