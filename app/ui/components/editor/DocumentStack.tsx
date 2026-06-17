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
const fanSpring = { type: "spring" as const, stiffness: 280, damping: 30 }

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
const openTransform = (depth: number, maxDepth: number) => ({
  x: 0,
  y: riseTo(Math.min(maxDepth, FULL_PEEKS)) / 2 - riseTo(depth),
  scale: stepScale(depth),
  opacity: cardOpacity(depth),
})

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
  const lastWheelRef = useRef(0)

  const total = ordered.length
  const wrap = (i: number) => (total > 0 ? ((i % total) + total) % total : 0)
  const clamped = open ? wrap(focusedIndex) : 0

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
      if (e.key === "ArrowDown" || e.key === "ArrowRight") setFocusedIndex((i) => i + 1)
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") setFocusedIndex((i) => i - 1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  const handleWheel = (e: React.WheelEvent) => {
    if (!open) return
    if (e.timeStamp - lastWheelRef.current < 220 || Math.abs(e.deltaY) < 8) return
    lastWheelRef.current = e.timeStamp
    setFocusedIndex((i) => i + (e.deltaY > 0 ? 1 : -1))
  }

  const enterCarousel = () => {
    setFocusedIndex(0)
    onOpenChange(true)
  }

  const transport = (id: string) => {
    onOpenChange(false)
    if (id !== activeId) onSelectDocument(id)
  }

  const visible = ordered
    .map((doc, i) => ({ doc, depth: open ? wrap(i - clamped) : i - clamped }))
    .filter(({ depth }) => depth >= 0 && (open ? cardOpacity(depth) > 0 : depth <= CLOSED_PEEK))
  const maxDepth = visible.reduce((m, v) => Math.max(m, v.depth), 0)

  return (
    <div className={cn("relative isolate", className)} onWheel={handleWheel}>
      <motion.div
        className="relative h-full w-full min-h-0 origin-center"
        animate={{ scale: open ? OPEN_SCALE : 1 }}
        transition={fanSpring}
      >
        <AnimatePresence initial={false}>
          {visible.map(({ doc, depth }) => {
            const isCurrent = doc.id === activeId
            const liftable = open && depth > 0
            return (
              <motion.div
                key={doc.id}
                className={cn("absolute inset-0 origin-center", liftable && "group")}
                style={{ zIndex: 100 - depth }}
                initial={false}
                animate={open ? openTransform(depth, maxDepth) : closedTransform(depth)}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={fanSpring}
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
                {(open || depth > 0) && (
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
                      else setFocusedIndex(() => clamped + depth)
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
