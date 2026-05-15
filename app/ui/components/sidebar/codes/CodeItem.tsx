"use client"

import { TooltipWrap } from "~/ui/components/TooltipWrap"
import { solidBackground, elementBackground, hoveredElementBorder } from "~/ui/theme/radix"
import type { Code } from "./types"

interface CodeItemProps {
  code: Code
  count?: number
  removalCount?: number
  highlighted?: boolean
  onMouseEnter?: () => void
  onClick?: () => void
  onSearchUnsure?: () => void
}

const formatFileTooltip = (count: number): string =>
  `${count} annotation${count === 1 ? "" : "s"} in this file`

const formatRemovalTooltip = (count: number): string =>
  `${count} unsure annotation${count === 1 ? "" : "s"} across all files`

const stopAndCall = (handler?: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation()
  handler?.()
}

export const CodeItem = ({
  code,
  count = 0,
  removalCount,
  highlighted = false,
  onMouseEnter,
  onClick,
  onSearchUnsure,
}: CodeItemProps) => (
  <div
    className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-solid px-3 py-2"
    style={{
      backgroundColor: elementBackground(code.color),
      borderColor: highlighted ? hoveredElementBorder(code.color) : "transparent",
    }}
    onMouseEnter={onMouseEnter}
    onClick={onClick}
  >
    <div
      className="flex h-2 w-2 flex-none rounded-full"
      style={{ backgroundColor: solidBackground(code.color) }}
    />
    <span className="grow truncate text-body font-body text-default-font">{code.name}</span>
    {removalCount != null && removalCount > 0 && (
      <TooltipWrap text={formatRemovalTooltip(removalCount)}>
        <button
          className="flex h-5 min-w-5 flex-none cursor-pointer items-center justify-center rounded px-1.5 text-[11px] font-bold leading-none text-amber-900 bg-amber-200/70 hover:bg-amber-300/80 transition-colors"
          onClick={stopAndCall(onSearchUnsure)}
        >
          {removalCount}
        </button>
      </TooltipWrap>
    )}
    {count > 0 && (
      <TooltipWrap text={formatFileTooltip(count)}>
        <span
          className="flex h-5 min-w-5 flex-none items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none text-white"
          style={{ backgroundColor: solidBackground(code.color) }}
        >
          {count}
        </span>
      </TooltipWrap>
    )}
  </div>
)
