"use client"

import { useState, useMemo } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Bookmark, Trash2 } from "lucide-react"
import type { SearchEntry } from "~/domain/search/types"
import { IconButton } from "~/ui/components/IconButton"
import { SidebarHeader } from "~/ui/components/sidebar/SidebarHeader"
import { matchesAny } from "~/lib/utils/filter"
import { cn } from "~/ui/utils"

interface SearchSidebarProps {
  recentSearches: SearchEntry[]
  savedSearches: SearchEntry[]
  selectedId?: string
  onSave: (id: string) => void
  onRemove: (id: string) => void
  onSelect: (id: string) => void
}

const SearchItemBookmark = ({
  saved,
  onSave,
  onRemove,
}: {
  saved: boolean
  onSave: () => void
  onRemove: () => void
}) => {
  const [hovered, setHovered] = useState(false)
  const showTrash = saved && hovered
  const unsavedColor = hovered ? "text-success-700" : "text-neutral-400"

  return saved ? (
    <IconButton
      variant="neutral-tertiary"
      size="small"
      icon={
        showTrash ? (
          <Trash2 className="text-error-600" />
        ) : (
          <Bookmark className="text-success-600 [&_path]:fill-current" />
        )
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation()
        onRemove()
      }}
    />
  ) : (
    <button
      type="button"
      className={cn(
        "flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-none bg-transparent",
        unsavedColor
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation()
        onSave()
      }}
    >
      <Bookmark className="text-body" />
    </button>
  )
}

const SearchItem = ({
  entry,
  selected,
  highlighted,
  onSave,
  onRemove,
  onSelect,
  onMouseEnter,
}: {
  entry: SearchEntry
  selected: boolean
  highlighted: boolean
  onSave: () => void
  onRemove: () => void
  onSelect: () => void
  onMouseEnter: () => void
}) => (
  <div
    className={cn(
      "flex w-full cursor-pointer items-center justify-between py-3",
      selected ? "border-l-4 border-solid border-slate-950 px-5" : "px-6",
      highlighted && "bg-list-hover"
    )}
    onClick={onSelect}
    onMouseEnter={onMouseEnter}
  >
    <div className="flex min-w-0 flex-col items-start gap-1">
      <div className="flex items-center gap-3">
        <SearchItemBookmark saved={entry.saved} onSave={onSave} onRemove={onRemove} />
        <span className="text-body font-body text-default-font">{entry.title}</span>
      </div>
      <span className="text-caption font-caption pl-10 text-subtext-color">
        {entry.description}
      </span>
    </div>
  </div>
)

const SectionHeader = ({ label }: { label: string }) => (
  <div className="flex w-full items-center justify-between px-6 py-2">
    <span className="text-caption-bold font-caption-bold text-subtext-color">{label}</span>
  </div>
)

const SavedSearchesEmpty = () => (
  <div className="flex w-full items-center gap-2 px-6 py-4">
    <Bookmark className="flex-none text-caption text-neutral-400" />
    <span className="text-caption font-caption text-subtext-color">
      Click the bookmark icon on a search to save it
    </span>
  </div>
)

const matchesSearch = (entry: SearchEntry, query: string): boolean =>
  matchesAny(query, [entry.title, entry.description])

const filterEntries = (entries: SearchEntry[], query: string): SearchEntry[] =>
  query.length === 0 ? entries : entries.filter((e) => matchesSearch(e, query))

const hasEntries = (entries: SearchEntry[]): boolean => entries.length > 0

const isHighlighted = (entryId: string, hoveredId: string | null, selectedId?: string): boolean =>
  hoveredId === null ? entryId === selectedId : entryId === hoveredId

const itemExit = { opacity: 0, height: 0 }
const itemAnimate = { opacity: 1, height: "auto" as const }
const itemTransition = { type: "spring" as const, stiffness: 500, damping: 35 }

export function SearchSidebar({
  recentSearches,
  savedSearches,
  selectedId,
  onSave,
  onRemove,
  onSelect,
}: SearchSidebarProps) {
  const [filterValue, setFilterValue] = useState("")
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const filteredRecent = useMemo(
    () => filterEntries(recentSearches, filterValue),
    [recentSearches, filterValue]
  )
  const filteredSaved = useMemo(
    () => filterEntries(savedSearches, filterValue),
    [savedSearches, filterValue]
  )

  return (
    <div className="flex h-full w-80 flex-none flex-col items-start border-r border-solid border-r-[#e3ddd8] bg-sidebar-nested shadow-lg">
      <SidebarHeader
        title="Search"
        filterPlaceholder="Filter results..."
        filterValue={filterValue}
        onFilterChange={setFilterValue}
        onNew={() => undefined}
      />
      <div
        className="flex w-full grow shrink-0 basis-0 flex-col items-start pt-2 overflow-y-auto"
        onMouseLeave={() => setHoveredId(null)}
      >
        {hasEntries(filteredRecent) && (
          <>
            <SectionHeader label="RECENT SEARCHES" />
            <AnimatePresence initial={false}>
              {filteredRecent.map((entry) => (
                <motion.div
                  key={entry.id}
                  layout
                  initial={itemExit}
                  animate={itemAnimate}
                  exit={itemExit}
                  transition={itemTransition}
                  className="w-full opacity-60"
                >
                  <SearchItem
                    entry={entry}
                    selected={entry.id === selectedId}
                    highlighted={isHighlighted(entry.id, hoveredId, selectedId)}
                    onSave={() => onSave(entry.id)}
                    onRemove={() => onRemove(entry.id)}
                    onSelect={() => onSelect(entry.id)}
                    onMouseEnter={() => setHoveredId(entry.id)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </>
        )}
        {(hasEntries(filteredRecent) || hasEntries(filteredSaved)) && (
          <>
            <SectionHeader label="SAVED SEARCHES" />
            {hasEntries(filteredSaved) ? (
              <AnimatePresence initial={false}>
                {filteredSaved.map((entry) => (
                  <motion.div
                    key={entry.id}
                    layout
                    initial={itemExit}
                    animate={itemAnimate}
                    exit={itemExit}
                    transition={itemTransition}
                    className="w-full"
                  >
                    <SearchItem
                      entry={entry}
                      selected={entry.id === selectedId}
                      highlighted={isHighlighted(entry.id, hoveredId, selectedId)}
                      onSave={() => onSave(entry.id)}
                      onRemove={() => onRemove(entry.id)}
                      onSelect={() => onSelect(entry.id)}
                      onMouseEnter={() => setHoveredId(entry.id)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            ) : (
              <SavedSearchesEmpty />
            )}
          </>
        )}
        {!hasEntries(filteredRecent) && !hasEntries(filteredSaved) && (
          <div className="flex w-full items-center justify-center px-6 py-8">
            <span className="text-body font-body text-subtext-color">No searches yet</span>
          </div>
        )}
      </div>
    </div>
  )
}
