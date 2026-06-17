"use client"

import { useState, useMemo, useRef, useEffect, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Layers, ChevronDown, X } from "lucide-react"
import type { DocumentEntry, DocSortMode } from "~/domain/documents/selectors"
import { sortDocuments } from "~/domain/documents/selectors"
import { previewContent } from "~/domain/documents/preview"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { getSelectedDocs } from "~/domain/data-blocks/ux/selectors"
import { DocumentBubble } from "./DocumentBubble"
import { cn } from "~/ui/utils"

interface DocumentStackProps {
  documents: DocumentEntry[]
  activeId: string | null
  files: Record<string, string>
  tagDefinitions: TagDefinition[]
  sortMode: DocSortMode
  onSelectDocument: (id: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
  front: ReactNode
}

// Two independent knobs:
const OPEN_SCALE = 0.8 // camera zoom-out for the whole deck
const OFFSET = 52 // how much each document rises above the one in front (deck-local px)
const CLOSED_PEEK = 3 // blank shells behind the doc while reading (no content mounted)
const OPEN_BEHIND = 7 // real cards rendered behind the focused one in the carousel
const FULL_PEEKS = 3 // first N peeks at full opacity; the rest fade toward 0 ("there's more")
const DEPTH_SHRINK = 0.03 // each deeper card slightly smaller
const FLY_SCALE = 1.45 // scrolling: leaving card zooms past the viewer ("through the screen")
const fanSpring = { type: "spring" as const, stiffness: 280, damping: 30 }

// Direction-aware enter/exit: forward (dir>0) the front flies through the screen and a new
// card appears at the back; backward (dir<0) it inverts.
const cardVariants = {
  enter: (dir: number) => (dir >= 0 ? { opacity: 0 } : { opacity: 0, scale: FLY_SCALE }),
  exit: (dir: number) => (dir >= 0 ? { opacity: 0 } : { opacity: 0, scale: 0.9 }),
}

const sortLabels: Record<DocSortMode, string> = {
  date: "Newest first",
  name: "A – Z",
}

const stepScale = (depth: number) => 1 - depth * DEPTH_SHRINK

// Each step's offset is scaled by the card size at that level, so deeper
// (smaller) cards sit closer together instead of a flat px gap.
const riseTo = (depth: number): number => {
  let rise = 0
  for (let k = 1; k <= depth; k++) rise += OFFSET * stepScale(k)
  return rise
}

// First FULL_PEEKS solid, then fade per step toward 0 by OPEN_BEHIND.
const cardOpacity = (depth: number): number =>
  depth < FULL_PEEKS
    ? 1
    : Math.max(0, 1 - (depth - FULL_PEEKS + 1) / (OPEN_BEHIND - FULL_PEEKS + 1))

// Blank bubble — same shape/height as a doc, no content mounted (cheap door peek).
const BubbleShell = ({ className }: { className?: string }) => (
  <div
    className={cn(
      "h-full w-full rounded-xl border border-solid border-panel-border bg-default-background",
      className
    )}
  />
)

// Closed: a small bottom-right offset so the deck peeks as the "door".
const closedTransform = (depth: number) => ({ x: depth * 7, y: depth * 7, scale: 1, opacity: 1 })

// Open: rise per depth, centered on the solid fan so faded extras trail off the top.
// depth -1 is the pre-staged "incoming" copy: parked at the front origin, oversized and
// invisible, so scrolling back animates it in from there instead of sliding from the stack.
const openTransform = (depth: number, maxDepth: number) => {
  const center = riseTo(Math.min(maxDepth, FULL_PEEKS)) / 2
  if (depth < 0) return { x: 0, y: center, scale: FLY_SCALE, opacity: 0 }
  return {
    x: 0,
    y: center - riseTo(depth),
    scale: stepScale(depth),
    opacity: cardOpacity(depth),
  }
}

export const DocumentStack = ({
  documents,
  activeId,
  files,
  tagDefinitions,
  sortMode,
  onSelectDocument,
  open,
  onOpenChange,
  className,
  front,
}: DocumentStackProps) => {
  const ordered = useMemo(() => {
    const selected = getSelectedDocs(files)
    const others = sortDocuments(
      documents.filter((d) => d.id !== activeId && selected.has(d.id)),
      sortMode
    )
    const current = documents.find((d) => d.id === activeId)
    return current ? [current, ...others] : others
  }, [documents, files, activeId, sortMode])

  const tagDefMap = useMemo(() => new Map(tagDefinitions.map((d) => [d.id, d])), [tagDefinitions])
  const resolveTags = (ids: string[]): TagDefinition[] =>
    ids.map((id) => tagDefMap.get(id)).filter((d): d is TagDefinition => d !== undefined)

  const [focusedIndex, setFocusedIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const lastWheelRef = useRef(0)

  const step = (delta: number) => {
    setDirection(delta)
    setFocusedIndex((i) => i + delta)
  }

  const total = ordered.length
  const wrap = (i: number) => (total > 0 ? ((i % total) + total) % total : 0)
  const clamped = open ? wrap(focusedIndex) : 0

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
      if (e.key === "ArrowDown" || e.key === "ArrowRight") step(1)
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") step(-1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  const handleWheel = (e: React.WheelEvent) => {
    if (!open) return
    if (e.timeStamp - lastWheelRef.current < 220 || Math.abs(e.deltaY) < 8) return
    lastWheelRef.current = e.timeStamp
    step(e.deltaY > 0 ? 1 : -1)
  }

  const enterCarousel = () => {
    setFocusedIndex(0)
    onOpenChange(true)
  }

  const transport = (id: string) => {
    onOpenChange(false)
    if (id !== activeId) onSelectDocument(id)
  }

  // Build in depth order (front → back) so the keyed list only ever adds/removes at the
  // ends — never reorders at the wrap seam (which made AnimatePresence misfire).
  const visible: { doc: DocumentEntry; depth: number }[] = []
  for (let depth = 0; depth < total; depth++) {
    if (open) {
      // Always leave at least one doc out (depth < total - 1) so the wrapping card has
      // an exit/enter slot — otherwise, when the whole set fits, it slides instead.
      if (cardOpacity(depth) <= 0 || depth >= total - 1) break
      visible.push({ doc: ordered[wrap(clamped + depth)], depth })
    } else {
      if (depth > CLOSED_PEEK || clamped + depth >= total) break
      visible.push({ doc: ordered[clamped + depth], depth })
    }
  }
  const maxDepth = visible.length ? visible[visible.length - 1].depth : 0

  // Pre-stage the backward-incoming doc (the one just off the front) at the front origin so
  // it flies in from the right spot on back-scroll. It's the wrap doc, never in the stack.
  if (open && total > 1 && direction < 0)
    visible.unshift({ doc: ordered[wrap(clamped - 1)], depth: -1 })

  return (
    <div className={cn("relative isolate", className)} onWheel={handleWheel}>
      <motion.div
        className="relative h-full w-full min-h-0 origin-center"
        animate={{ scale: open ? OPEN_SCALE : 1 }}
        transition={fanSpring}
      >
        <AnimatePresence initial={false} custom={direction}>
          {visible.map(({ doc, depth }) => {
            const isCurrent = doc.id === activeId
            const liftable = open && depth > 0
            const staged = depth < 0
            return (
              <motion.div
                key={doc.id}
                className={cn(
                  "absolute inset-0 origin-center",
                  liftable && "group",
                  staged && "pointer-events-none"
                )}
                style={{ zIndex: 100 - depth }}
                custom={direction}
                variants={cardVariants}
                initial="enter"
                animate={open ? openTransform(depth, maxDepth) : closedTransform(depth)}
                exit="exit"
                transition={staged ? { duration: 0 } : fanSpring}
              >
                <div
                  className={cn(
                    "h-full w-full",
                    liftable &&
                      "transition-transform duration-200 ease-out group-hover:-translate-y-[1.5%]"
                  )}
                >
                  {open ? (
                    <DocumentBubble
                      filename={doc.id}
                      content={depth < FULL_PEEKS ? previewContent(files[doc.id] ?? "") : ""}
                      tags={resolveTags(doc.tags)}
                      date={doc.date}
                      readOnly
                      headerOnly={depth >= FULL_PEEKS}
                      headerClassName={isCurrent ? "bg-sidebar" : undefined}
                      className="shadow-lg"
                    />
                  ) : isCurrent ? (
                    front
                  ) : (
                    <BubbleShell className="shadow-lg" />
                  )}
                </div>
                {depth >= 0 && (open || depth > 0) && (
                  <button
                    type="button"
                    aria-label={
                      !open
                        ? "Open document stack"
                        : depth === 0
                          ? `Open ${doc.title}`
                          : `Bring ${doc.title} forward`
                    }
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!open) enterCarousel()
                      else if (depth === 0) transport(doc.id)
                      else {
                        setDirection(1)
                        setFocusedIndex(() => clamped + depth)
                      }
                    }}
                    className="absolute inset-0 z-[1] cursor-pointer"
                  />
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

interface StackToolbarProps {
  count: number
  sortMode: DocSortMode
  onSortChange: (mode: DocSortMode) => void
  onClose: () => void
}

export const StackToolbar = ({ count, sortMode, onSortChange, onClose }: StackToolbarProps) => (
  <motion.div
    initial={{ y: 8, opacity: 0 }}
    animate={{ y: 0, opacity: 1 }}
    exit={{ y: 8, opacity: 0 }}
    transition={{ type: "spring", stiffness: 500, damping: 28 }}
    className="flex w-full items-center gap-4 rounded-xl border border-solid border-neutral-border bg-sidebar px-5 py-2.5 whitespace-nowrap"
  >
    <Layers className="h-3.5 w-3.5 flex-none text-subtext-color" />
    <span className="text-caption-bold font-caption-bold text-default-font">
      {count} doc{count === 1 ? "" : "s"} selected
    </span>
    <div className="grow" />
    <div className="h-4 w-px flex-none bg-neutral-border" />
    <SortDropdown sortMode={sortMode} onSortChange={onSortChange} />
    <button
      type="button"
      aria-label="Close stack"
      onClick={onClose}
      className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-subtext-color transition-colors hover:bg-brand-50 hover:text-brand-700"
    >
      <X className="h-4 w-4" />
    </button>
  </motion.div>
)

const sortOrder: DocSortMode[] = ["date", "name"]

const SortDropdown = ({
  sortMode,
  onSortChange,
}: {
  sortMode: DocSortMode
  onSortChange: (mode: DocSortMode) => void
}) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-solid border-neutral-border bg-default-background px-3 py-1.5 text-caption font-caption text-default-font transition-colors hover:bg-neutral-50"
      >
        {sortLabels[sortMode]}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <button
              type="button"
              aria-hidden
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.12 }}
              className="absolute bottom-full right-0 z-20 mb-1 flex w-40 flex-col overflow-hidden rounded-md border border-solid border-neutral-border bg-default-background shadow-lg"
            >
              {sortOrder.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    onSortChange(mode)
                    setOpen(false)
                  }}
                  className={cn(
                    "px-3 py-2 text-left text-caption font-caption transition-colors hover:bg-neutral-50",
                    mode === sortMode ? "text-brand-600" : "text-default-font"
                  )}
                >
                  {sortLabels[mode]}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
