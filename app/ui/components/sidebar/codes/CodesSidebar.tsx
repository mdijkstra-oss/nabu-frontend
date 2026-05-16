"use client"

import { useState, useMemo, useCallback, useSyncExternalStore } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { SidebarHeader } from "~/ui/components/sidebar/SidebarHeader"
import { TooltipWrap } from "~/ui/components/TooltipWrap"
import { CheckableWrap } from "~/ui/components/CheckableWrap"
import { matchesAny } from "~/lib/utils/filter"
import { solidBackground, hoveredElementBorder } from "~/ui/theme/radix"
import type {
  GlobalAnnotationCount,
  RemovalStat,
} from "~/domain/data-blocks/attributes/annotations/selectors"
import { getSelectedCodes, toggleSelectedCode } from "~/domain/data-blocks/ux/selectors"
import { writeSelectedCodes } from "~/domain/actions/select-codes/apply"
import { getFiles, subscribe } from "~/lib/files/store"
import type { Codebook, Code, CodeCategory } from "./types"
import { CodeItem } from "./CodeItem"
import { CodeDetail } from "./CodeDetail"

interface CodesSidebarProps {
  codebook: Codebook
  annotationCounts?: Record<string, number>
  globalAnnotationCounts?: Record<string, GlobalAnnotationCount>
  removalStats?: Record<string, RemovalStat>
  debugRemoval?: boolean
  busy?: boolean
  onEditCode?: (code: Code) => void
  onCodeFile?: (code: Code) => void
  onFileSelect?: (fileId: string) => void
  onSearchCode?: (code: Code) => void
  onSearchUnsure?: (code: Code) => void
}

const formatGlobalTooltip = ({ count, fileCount }: GlobalAnnotationCount): string =>
  `${count} annotation${count === 1 ? "" : "s"} across ${fileCount} file${fileCount === 1 ? "" : "s"}`

const filterCategories = (categories: CodeCategory[], query: string): CodeCategory[] => {
  if (query.length === 0) return categories
  return categories.reduce<CodeCategory[]>((acc, cat) => {
    const codes = cat.codes.filter((code) => matchesAny(query, [code.name, code.detail]))
    if (codes.length > 0) acc.push({ ...cat, codes })
    return acc
  }, [])
}

const EMPTY_COUNT: GlobalAnnotationCount = { count: 0, fileCount: 0 }

const SearchCodeButton = ({
  code,
  globalCount,
  onClick,
}: {
  code: Code
  globalCount?: GlobalAnnotationCount
  onClick: () => void
}) => {
  const [isHovered, setIsHovered] = useState(false)
  const resolvedCount = globalCount ?? EMPTY_COUNT
  const isDisabled = resolvedCount.count === 0
  return (
    <TooltipWrap text={isDisabled ? "No annotations yet" : formatGlobalTooltip(resolvedCount)}>
      <button
        disabled={isDisabled}
        className="ml-auto flex flex-none items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed enabled:cursor-pointer"
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <span
          className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none text-white"
          style={{
            backgroundColor: isHovered
              ? hoveredElementBorder(code.color)
              : solidBackground(code.color),
          }}
        >
          {resolvedCount.count}
        </span>
      </button>
    </TooltipWrap>
  )
}

export const CodesSidebar = ({
  codebook,
  annotationCounts = {},
  globalAnnotationCounts = {},
  removalStats,
  debugRemoval = false,
  onEditCode,
  onFileSelect,
  onSearchCode,
  onSearchUnsure,
}: CodesSidebarProps) => {
  const [searchValue, setSearchValue] = useState("")
  const [hoveredCode, setHoveredCode] = useState<Code | null>(null)

  const files = useSyncExternalStore(subscribe, getFiles)
  const selectedCodes = useMemo(() => getSelectedCodes(files), [files])

  const toggleCode = useCallback(
    (id: string) => {
      const current = [...selectedCodes]
      writeSelectedCodes(toggleSelectedCode(current, id))
    },
    [selectedCodes]
  )

  const filteredCategories = useMemo(
    () => filterCategories(codebook.categories, searchValue),
    [codebook.categories, searchValue]
  )

  return (
    <div className="relative z-10 flex h-full w-64 flex-none flex-col items-start bg-sidebar-nested shadow-lg after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-[#e3ddd8] after:z-30">
      <div className="flex w-full flex-none flex-col" onMouseEnter={() => setHoveredCode(null)}>
        <SidebarHeader
          title="Codes"
          filterPlaceholder="Filter codes..."
          filterValue={searchValue}
          onFilterChange={setSearchValue}
          onNew={() => undefined}
        />
      </div>

      <div className="flex w-full grow shrink-0 basis-0 flex-col items-start gap-4 px-4 py-4 overflow-auto">
        {filteredCategories.map((category) => (
          <div key={category.fileId} className="flex w-full flex-col items-start gap-2">
            <span
              className="text-caption-bold font-caption-bold text-subtext-color px-2 cursor-pointer hover:text-default-font"
              onClick={() => onFileSelect?.(category.fileId)}
            >
              {category.name}
            </span>
            {category.codes.map((code) => (
              <CheckableWrap
                key={code.id}
                color={code.color}
                checked={selectedCodes.has(code.id)}
                onToggle={() => toggleCode(code.id)}
              >
                <CodeItem
                  code={code}
                  count={annotationCounts[code.id]}
                  removalStat={removalStats?.[code.id]}
                  debugRemoval={debugRemoval}
                  highlighted={code.id === hoveredCode?.id}
                  onMouseEnter={() => setHoveredCode(code)}
                  onClick={() => onEditCode?.(code)}
                  onSearchUnsure={() => onSearchUnsure?.(code)}
                />
              </CheckableWrap>
            ))}
          </div>
        ))}
      </div>

      <AnimatePresence>
        {hoveredCode && (
          <motion.div
            key="code-detail-panel"
            initial={{ x: -12, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -12, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
            className="absolute left-full top-0 h-full w-80 flex flex-col items-start border-r border-solid border-r-[#e3ddd8] bg-sidebar-deep [box-shadow:4px_0_6px_-1px_rgb(0_0_0/0.1),4px_0_4px_-2px_rgb(0_0_0/0.1)]"
          >
            <div
              className="flex w-full items-center gap-2 border-b-2 border-solid px-4 py-4"
              style={{
                borderColor: solidBackground(hoveredCode.color),
              }}
            >
              <div
                className="flex h-3 w-3 flex-none rounded-full"
                style={{ backgroundColor: solidBackground(hoveredCode.color) }}
              />
              <span className="text-heading-3 font-heading-3 font-bold text-default-font">
                {hoveredCode.name}
              </span>
              <SearchCodeButton
                code={hoveredCode}
                globalCount={globalAnnotationCounts[hoveredCode.id]}
                onClick={() => onSearchCode?.(hoveredCode)}
              />
            </div>
            <CodeDetail code={hoveredCode} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
