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
const OFFSET = 64 // how much each document rises above the one in front (deck-local px)
const CLOSED_PEEK = 2 // blank shells behind the doc while reading (no content mounted)
const OPEN_BEHIND = 7 // real cards rendered behind the focused one in the carousel
const FULL_PEEKS = 3 // first N peeks at full opacity; the rest fade toward 0 ("there's more")
const DEPTH_SHRINK = 0.03 // each deeper card slightly smaller
const FALL = 1400 // front card's vertical travel as it drops off the bottom / swoops back up (deck-local px)
const STEP = 120 // px of native scroll per document — the scroll-snap interval (higher = slower flip)
const REST = 0.05 // fraction of each step the front doc sits still before the flip — a "page" you can stop on
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

// Ease scroll progress so each doc rests at the front for REST of the step, then flips quickly in
// the remainder — turns every doc into a plateau you can comfortably stop on instead of everything
// being perpetually mid-motion.
const magnet = (p: number): number => {
  const i = Math.floor(p)
  const f = p - i
  const edge = REST / 2
  if (f <= edge) return i
  if (f >= 1 - edge) return i + 1
  const t = (f - edge) / (1 - REST)
  return i + t * t * (3 - 2 * t)
}

// Continuous rise, so fractional depths (mid-scroll) interpolate smoothly.
const riseAt = (depth: number): number => {
  if (depth <= 0) return 0
  const lo = Math.floor(depth)
  return riseTo(lo) + (riseTo(lo + 1) - riseTo(lo)) * (depth - lo)
}

// Open: depth >= 0 rises into the fan (centered so faded extras trail off the top); depth in
// [-1, 0] is the front card mid-fall — dropping off the bottom and fading as it goes.
const openTransform = (depth: number, center: number) =>
  depth <= 0
    ? { x: 0, y: center - depth * FALL, scale: 1, opacity: 1 }
    : { x: 0, y: center - riseAt(depth), scale: stepScale(depth), opacity: cardOpacity(depth) }

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

  // `progress` is continuous (scrollTop / STEP): an integer centers a doc at the front, a
  // fraction is mid-transition. The native scroll position is the single source of truth.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [stageH, setStageH] = useState(0)
  const [progress, setProgress] = useState(0)
  const [scrolling, setScrolling] = useState(false)
  const scrollEnd = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const ignoreScroll = useRef(false)

  const total = ordered.length

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setProgress(el.scrollTop / STEP)
    if (ignoreScroll.current) return // programmatic (open jump) — don't count it as a gesture
    setScrolling(true)
    clearTimeout(scrollEnd.current)
    scrollEnd.current = setTimeout(() => setScrolling(false), 80)
  }
  const scrollToSlot = (slot: number) =>
    scrollRef.current?.scrollTo({ top: slot * STEP, behavior: "smooth" })
  const scrollByDocs = (n: number) =>
    scrollRef.current?.scrollBy({ top: n * STEP, behavior: "smooth" })

  // Measure the stage height — the sticky parent is zero-height, so the absolute fan needs one.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStageH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // On open, jump (instantly, not counted as a gesture) to the first doc.
  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      ignoreScroll.current = true
      el.scrollTop = 0
      setProgress(0)
      requestAnimationFrame(() => {
        ignoreScroll.current = false
      })
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
      if (e.key === "ArrowDown" || e.key === "ArrowRight") scrollByDocs(1)
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") scrollByDocs(-1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  const enterCarousel = () => onOpenChange(true)

  const transport = (id: string) => {
    onOpenChange(false)
    if (id !== activeId) onSelectDocument(id)
  }

  // Open: a window of the fan around the current scroll slot — depths -1..cap, each doc looked up
  // through wrap() so the track loops endlessly. Closed: the small "door" peek (live doc + a couple
  // of blank shells). Same doc-keyed cards in both, so the open/close scale morphs between them.
  const cap = Math.min(total - 1, OPEN_BEHIND)
  const center = riseAt(Math.min(Math.max(cap, 0), FULL_PEEKS)) / 2

  const cards: { doc: DocumentEntry; depth: number; slot: number }[] = []
  if (open) {
    const p = magnet(progress)
    const lo = Math.max(0, Math.ceil(p - 1))
    const hi = Math.min(total - 1, Math.floor(p + cap))
    for (let i = lo; i <= hi; i++) cards.push({ doc: ordered[i], depth: i - p, slot: i })
  } else {
    for (let depth = 0; depth <= CLOSED_PEEK && depth < total; depth++)
      cards.push({ doc: ordered[depth], depth, slot: depth })
  }

  const fanTransition = scrolling ? { duration: 0 } : fanSpring

  return (
    <div className={cn("relative isolate", className)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={cn(
          "relative h-full w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          open ? "overflow-x-hidden overflow-y-scroll snap-y snap-mandatory" : "overflow-visible"
        )}
      >
        {/* Pinned stage — zero-height so it adds no scroll length; stays at the top while the snap
            track scrolls beneath it. Holds the visual fan and all click targets. */}
        <div className="sticky top-0 z-10 h-0 w-full">
          <motion.div
            className="absolute left-0 top-0 w-full origin-center"
            style={{ height: stageH }}
            initial={false}
            animate={{ scale: open ? OPEN_SCALE : 1 }}
            transition={fanSpring}
          >
            {cards.map(({ doc, depth, slot }) => {
              const isCurrent = doc.id === activeId
              const atFront = Math.round(depth) === 0
              const liftable = open && depth > 0.5
              return (
                <motion.div
                  key={doc.id}
                  className={cn("absolute inset-0 origin-center", liftable && "group")}
                  style={{ zIndex: open ? Math.round(500 - depth * 10) : 100 - depth }}
                  initial={false}
                  animate={open ? openTransform(depth, center) : closedTransform(depth)}
                  transition={fanTransition}
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
                          : atFront
                            ? `Open ${doc.title}`
                            : `Bring ${doc.title} forward`
                      }
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!open) enterCarousel()
                        else if (atFront) transport(doc.id)
                        else scrollToSlot(slot)
                      }}
                      className="absolute inset-0 z-[1] cursor-pointer"
                    />
                  )}
                </motion.div>
              )
            })}
          </motion.div>
        </div>
        {open && (
          <>
            {ordered.map((doc) => (
              <div key={doc.id} aria-hidden className="snap-start" style={{ height: STEP }} />
            ))}
            <div aria-hidden style={{ height: Math.max(0, stageH - STEP) }} />
          </>
        )}
      </div>
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
    className="relative z-10 flex w-full items-center gap-4 rounded-xl border border-solid border-neutral-border bg-sidebar px-5 py-2.5 whitespace-nowrap"
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
