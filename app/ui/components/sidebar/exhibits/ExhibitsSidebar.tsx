"use client"

import { useState, useMemo } from "react"
import { AnimatePresence, motion } from "framer-motion"
import type { ExhibitItem, ExhibitKind } from "~/domain/exhibits/types"
import { groupByKind, type ExhibitGroup } from "~/domain/exhibits/selectors"
import { EXHIBIT_KINDS, resolveExhibitConfig } from "./registry"
import { SidebarHeader } from "~/ui/components/sidebar/SidebarHeader"
import { Badge } from "~/ui/components/Badge"
import { ExhibitItem as ExhibitItemRow } from "./ExhibitItem"
import { matchesAllWords } from "~/lib/utils/filter"
import {
  elementBackground,
  solidBackground,
  lowContrastText,
  highContrastText,
} from "~/ui/theme/radix"

export interface ExhibitsSidebarProps {
  exhibits: ExhibitItem[]
  selectedId?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  onExhibitSelect?: (exhibit: ExhibitItem) => void
  onNew?: () => void
}

const compareByName = (a: ExhibitItem, b: ExhibitItem): number => a.title.localeCompare(b.title)

const sortByName = (groups: ExhibitGroup[]): ExhibitGroup[] =>
  groups.map((g) => ({ ...g, items: [...g.items].sort(compareByName) }))

const filterExhibits = (exhibits: ExhibitItem[], query: string): ExhibitItem[] =>
  [...exhibits]
    .filter((item) => matchesAllWords(query, [item.title, item.documentTitle]))
    .sort(compareByName)

export function ExhibitsSidebar({
  exhibits,
  selectedId,
  searchValue = "",
  onSearchChange,
  onExhibitSelect,
  onNew,
}: ExhibitsSidebarProps) {
  const [hoveredKind, setHoveredKind] = useState<ExhibitKind | null>(null)
  const isFiltering = searchValue.trim().length > 0

  const rawGroups = useMemo(() => groupByKind(exhibits), [exhibits])
  const sortedGroups = useMemo(() => sortByName(rawGroups), [rawGroups])

  const filteredExhibits = useMemo(
    () => (isFiltering ? filterExhibits(exhibits, searchValue) : []),
    [exhibits, searchValue, isFiltering]
  )

  const hoveredGroup =
    !isFiltering && hoveredKind ? sortedGroups.find((g) => g.kind === hoveredKind) : null
  const hoveredConfig = hoveredKind ? EXHIBIT_KINDS[hoveredKind] : null
  const HoveredIcon = hoveredConfig?.icon

  return (
    <motion.div
      className="relative z-10 flex h-full flex-none flex-col items-start bg-sidebar-nested shadow-lg after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-[#e3ddd8] after:z-30"
      animate={{ width: isFiltering ? 288 : 256 }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
    >
      <SidebarHeader
        title="Exhibits"
        filterPlaceholder="Filter exhibits..."
        filterValue={searchValue}
        onFilterChange={(v) => onSearchChange?.(v)}
        onNew={onNew}
      />
      <div className="flex w-full grow shrink-0 basis-0 flex-col items-start py-2 overflow-y-auto">
        {isFiltering
          ? filteredExhibits.map((item) => {
              const itemConfig = resolveExhibitConfig(item.kind, item.subtype)
              return (
                <ExhibitItemRow
                  key={item.id}
                  title={item.title}
                  documentTitle={item.documentTitle}
                  icon={itemConfig.icon}
                  color={itemConfig.color}
                  selected={item.id === selectedId}
                  onClick={() => onExhibitSelect?.(item)}
                />
              )
            })
          : sortedGroups.map(({ kind, items }) => {
              const config = EXHIBIT_KINDS[kind]
              const KindIcon = config.icon
              const isHovered = hoveredKind === kind
              return (
                <div
                  key={kind}
                  className="relative flex w-full cursor-default items-center gap-2 px-4 py-2.5 hover:bg-neutral-50"
                  style={
                    isHovered ? { backgroundColor: elementBackground(config.color) } : undefined
                  }
                  onMouseEnter={() => setHoveredKind(kind)}
                >
                  {isHovered && (
                    <div
                      className="absolute left-0 top-0 bottom-0 w-1"
                      style={{ backgroundColor: solidBackground(config.color) }}
                    />
                  )}
                  <span className="flex-none" style={{ color: lowContrastText(config.color) }}>
                    <KindIcon className="text-body font-body" />
                  </span>
                  <span
                    className="grow shrink-0 basis-0 truncate text-body font-body text-default-font"
                    style={isHovered ? { color: highContrastText(config.color) } : undefined}
                  >
                    {config.display}
                  </span>
                  <Badge variant="neutral" className="flex-none">
                    {items.length}
                  </Badge>
                </div>
              )
            })}
      </div>

      <AnimatePresence>
        {hoveredGroup && hoveredConfig && HoveredIcon && (
          <motion.div
            key="exhibits-panel"
            initial={{ x: -12, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -12, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
            className="absolute left-full top-0 h-full w-72 flex flex-col items-start border-r border-solid border-r-[#e3ddd8] bg-sidebar-deep [box-shadow:4px_0_6px_-1px_rgb(0_0_0/0.1),4px_0_4px_-2px_rgb(0_0_0/0.1)]"
          >
            <div
              className="flex w-full items-center gap-2 border-b-2 border-solid px-4 py-4"
              style={{
                borderColor: solidBackground(hoveredConfig.color),
              }}
            >
              <span className="flex-none" style={{ color: lowContrastText(hoveredConfig.color) }}>
                <HoveredIcon className="text-body font-body" />
              </span>
              <span
                className="text-heading-3 font-heading-3 font-bold"
                style={{ color: highContrastText(hoveredConfig.color) }}
              >
                {hoveredConfig.display}
              </span>
            </div>
            <div className="flex w-full grow shrink-0 basis-0 flex-col items-start overflow-y-auto">
              {hoveredGroup.items.map((item) => {
                const itemConfig = resolveExhibitConfig(item.kind, item.subtype)
                return (
                  <ExhibitItemRow
                    key={item.id}
                    title={item.title}
                    documentTitle={item.documentTitle}
                    icon={itemConfig.icon}
                    color={itemConfig.color}
                    selected={item.id === selectedId}
                    onClick={() => {
                      onExhibitSelect?.(item)
                      setHoveredKind(null)
                    }}
                  />
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
