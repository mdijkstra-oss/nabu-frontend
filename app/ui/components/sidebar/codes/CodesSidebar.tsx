"use client"

import { useState, useMemo } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { PenLine, Play, Search } from "lucide-react"
import { SidebarHeader } from "~/ui/components/sidebar/SidebarHeader"
import { TooltipWrap } from "~/ui/components/TooltipWrap"
import { matchesAny } from "~/lib/utils/filter"
import { solidBackground, elementBackground, hoveredElementBorder } from "~/ui/theme/radix"
import type { GlobalAnnotationCount } from "~/domain/data-blocks/attributes/annotations/selectors"
import type { Codebook, Code, CodeCategory } from "./types"
import { CodeItem } from "./CodeItem"
import { CodeDetail } from "./CodeDetail"

interface CodesSidebarProps {
  codebook: Codebook
  annotationCounts?: Record<string, number>
  globalAnnotationCounts?: Record<string, GlobalAnnotationCount>
  busy?: boolean
  onEditCode?: (code: Code) => void
  onCodeFile?: (code: Code) => void
  onRefineCode?: (code: Code) => void
  onFileSelect?: (fileId: string) => void
  onSearchCode?: (code: Code) => void
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
        className="ml-auto flex flex-none items-center gap-1.5 rounded-full border-2 border-solid py-0.5 pl-1.5 pr-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 enabled:cursor-pointer"
        style={{
          color: solidBackground(code.color),
          borderColor: isHovered ? hoveredElementBorder(code.color) : "transparent",
        }}
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Search className="h-4 w-4" />
        <span
          className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none text-white"
          style={{ backgroundColor: solidBackground(code.color) }}
        >
          {resolvedCount.count}
        </span>
      </button>
    </TooltipWrap>
  )
}

const RefineCodeButton = ({
  code,
  disabled,
  onClick,
}: {
  code: Code
  disabled: boolean
  onClick: () => void
}) => {
  const [isHovered, setIsHovered] = useState(false)
  return (
    <TooltipWrap text="Refine this code definition">
      <button
        disabled={disabled}
        className="flex items-center gap-1 rounded-full border-2 border-solid py-0.5 px-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 enabled:cursor-pointer"
        style={{
          color: solidBackground(code.color),
          borderColor: isHovered ? hoveredElementBorder(code.color) : "transparent",
        }}
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <PenLine className="h-3.5 w-3.5" />
        <span className="text-[11px] font-bold leading-none">Refine</span>
      </button>
    </TooltipWrap>
  )
}

interface CodeFileButtonProps {
  code: Code
  disabled: boolean
  onClick: () => void
}

const CodeFileButton = ({ code, disabled, onClick }: CodeFileButtonProps) => (
  <TooltipWrap text="Code this file with only this code">
    <button
      disabled={disabled}
      className="flex flex-none items-center justify-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 enabled:cursor-pointer enabled:hover:bg-neutral-100"
      style={{ color: solidBackground(code.color) }}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <Play className="h-3.5 w-3.5" />
    </button>
  </TooltipWrap>
)

export const CodesSidebar = ({
  codebook,
  annotationCounts = {},
  globalAnnotationCounts = {},
  busy = false,
  onEditCode,
  onCodeFile,
  onRefineCode,
  onFileSelect,
  onSearchCode,
}: CodesSidebarProps) => {
  const [searchValue, setSearchValue] = useState("")
  const [hoveredCode, setHoveredCode] = useState<Code | null>(null)

  const filteredCategories = useMemo(
    () => filterCategories(codebook.categories, searchValue),
    [codebook.categories, searchValue]
  )

  return (
    <div className="relative z-10 flex h-full w-64 flex-none flex-col items-start bg-default-background shadow-lg">
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
              <div key={code.id} className="flex w-full items-center gap-1">
                <CodeFileButton code={code} disabled={busy} onClick={() => onCodeFile?.(code)} />
                <div className="min-w-0 grow">
                  <CodeItem
                    code={code}
                    count={annotationCounts[code.id]}
                    highlighted={code.id === hoveredCode?.id}
                    onMouseEnter={() => setHoveredCode(code)}
                    onClick={() => onEditCode?.(code)}
                  />
                </div>
              </div>
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
            className="absolute left-full top-0 h-full w-80 flex flex-col items-start bg-default-background [box-shadow:4px_0_6px_-1px_rgb(0_0_0/0.1),4px_0_4px_-2px_rgb(0_0_0/0.1)]"
          >
            <div
              className="flex w-full items-center gap-2 border-b-2 border-solid px-4 py-4"
              style={{
                backgroundColor: elementBackground(hoveredCode.color),
                borderColor: solidBackground(hoveredCode.color),
              }}
            >
              <div
                className="flex h-3 w-3 flex-none rounded-full"
                style={{ backgroundColor: solidBackground(hoveredCode.color) }}
              />
              <span className="text-heading-3 font-heading-3 text-default-font">
                {hoveredCode.name}
              </span>
              <RefineCodeButton
                code={hoveredCode}
                disabled={busy}
                onClick={() => onRefineCode?.(hoveredCode)}
              />
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
