"use client"

import { useState, useMemo, useRef, useEffect, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Layers, ChevronDown, X } from "lucide-react"
import type { DocumentEntry, DocSortMode } from "~/domain/documents/selectors"
import { sortDocuments } from "~/domain/documents/selectors"
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
  onSortChange: (mode: DocSortMode) => void
  onSelectDocument: (id: string) => void
  className?: string
  front: ReactNode
}

const MAX_DEPTH = 5
const fanSpring = { type: "spring" as const, stiffness: 280, damping: 30 }

const sortLabels: Record<DocSortMode, string> = {
  date: "Newest first",
  name: "A – Z",
}

const closedTransform = (depth: number) => ({
  x: depth * 7,
  y: depth * 5,
  scale: 1 - depth * 0.015,
  opacity: 1,
})

const openTransform = (depth: number) => ({
  x: 0,
  y: -depth * 36,
  scale: 1 - depth * 0.05,
  opacity: Math.max(1 - depth * 0.16, 0.15),
})

export const DocumentStack = ({
  documents,
  activeId,
  files,
  tagDefinitions,
  sortMode,
  onSortChange,
  onSelectDocument,
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

  const selectedCount = useMemo(() => getSelectedDocs(files).size, [files])
  const tagDefMap = useMemo(() => new Map(tagDefinitions.map((d) => [d.id, d])), [tagDefinitions])
  const resolveTags = (ids: string[]): TagDefinition[] =>
    ids.map((id) => tagDefMap.get(id)).filter((d): d is TagDefinition => d !== undefined)

  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const lastWheelRef = useRef(0)

  const clamped = open ? Math.min(Math.max(focusedIndex, 0), Math.max(ordered.length - 1, 0)) : 0

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
      if (e.key === "ArrowDown" || e.key === "ArrowRight")
        setFocusedIndex((i) => Math.min(i + 1, ordered.length - 1))
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") setFocusedIndex((i) => Math.max(i - 1, 0))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, ordered.length])

  const handleWheel = (e: React.WheelEvent) => {
    if (!open) return
    if (e.timeStamp - lastWheelRef.current < 220 || Math.abs(e.deltaY) < 8) return
    lastWheelRef.current = e.timeStamp
    const step = e.deltaY > 0 ? 1 : -1
    setFocusedIndex((i) => Math.min(Math.max(i + step, 0), ordered.length - 1))
  }

  const enterCarousel = () => {
    setFocusedIndex(0)
    setOpen(true)
  }

  const transport = (id: string) => {
    setOpen(false)
    if (id !== activeId) onSelectDocument(id)
  }

  const visible = ordered
    .map((doc, i) => ({ doc, depth: i - clamped }))
    .filter(({ depth }) => depth >= 0 && depth <= MAX_DEPTH)

  return (
    <div className={cn("relative isolate flex flex-col", className)} onWheel={handleWheel}>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative z-[120] flex-none overflow-hidden"
          >
            <div className="mb-4 flex w-full items-center gap-4 rounded-xl border border-solid border-neutral-border bg-sidebar px-5 py-2.5 whitespace-nowrap">
              <Layers className="h-3.5 w-3.5 flex-none text-subtext-color" />
              <span className="text-caption-bold font-caption-bold text-default-font">
                {selectedCount} doc{selectedCount === 1 ? "" : "s"} selected
              </span>
              <div className="grow" />
              <div className="h-4 w-px flex-none bg-neutral-border" />
              <SortDropdown sortMode={sortMode} onSortChange={onSortChange} />
              <button
                type="button"
                aria-label="Close stack"
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-subtext-color transition-colors hover:bg-brand-50 hover:text-brand-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="relative grow w-full min-h-0"
        style={open ? { perspective: 2000 } : undefined}
      >
        <AnimatePresence initial={false}>
          {visible.map(({ doc, depth }) => {
            const isCurrent = doc.id === activeId
            return (
              <motion.div
                key={doc.id}
                className="absolute inset-0 origin-top"
                style={{ zIndex: 100 - depth }}
                initial={{ opacity: 0 }}
                animate={open ? openTransform(depth) : closedTransform(depth)}
                exit={{ opacity: 0, y: 70, scale: 1.04 }}
                transition={fanSpring}
              >
                {isCurrent ? (
                  front
                ) : (
                  <DocumentBubble
                    filename={doc.id}
                    content={files[doc.id] ?? ""}
                    tags={resolveTags(doc.tags)}
                    date={doc.date}
                    readOnly
                    className="shadow-lg"
                  />
                )}
                {(open || depth > 0) && (
                  <button
                    type="button"
                    aria-label={open ? `Open ${doc.title}` : "Open document stack"}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (open) transport(doc.id)
                      else enterCarousel()
                    }}
                    className="absolute inset-0 z-[1]"
                  />
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}

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
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute right-0 top-full z-20 mt-1 flex w-40 flex-col overflow-hidden rounded-md border border-solid border-neutral-border bg-default-background shadow-lg"
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
