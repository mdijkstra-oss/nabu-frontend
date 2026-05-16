"use client"

import { AlertTriangle } from "lucide-react"
import { TooltipWrap } from "~/ui/components/TooltipWrap"
import { solidBackground, elementBackground, hoveredElementBorder } from "~/ui/theme/radix"
import type {
  RemovalStat,
  RemovalSeverity,
} from "~/domain/data-blocks/attributes/annotations/selectors"
import type { Code } from "./types"

interface CodeItemProps {
  code: Code
  count?: number
  removalStat?: RemovalStat
  debugRemoval?: boolean
  highlighted?: boolean
  onMouseEnter?: () => void
  onClick?: () => void
  onSearchUnsure?: () => void
}

const formatFileTooltip = (count: number): string =>
  `${count} annotation${count === 1 ? "" : "s"} in this file`

const SEVERITY_TOOLTIPS: Record<RemovalSeverity, string> = {
  normal: "",
  warning: " — above baseline (low sample)",
  danger: " — statistically above baseline",
}

const formatRemovalTooltip = ({ ratio, severity }: RemovalStat): string =>
  `${(ratio * 100).toFixed(0)}% removal dissent${SEVERITY_TOOLTIPS[severity]}`

const stopAndCall = (handler?: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation()
  handler?.()
}

const SEVERITY_CLASSES: Record<RemovalSeverity, string> = {
  normal: "text-emerald-900 bg-emerald-200/70 hover:bg-emerald-300/80",
  warning: "text-amber-900 bg-amber-200/70 hover:bg-amber-300/80",
  danger: "text-red-900 bg-red-200/70 hover:bg-red-300/80",
}

const isDangerVisible = (stat: RemovalStat | undefined): stat is RemovalStat =>
  stat != null && stat.severity === "danger"

const RemovalBadgeDebug = ({
  stat,
  onSearchUnsure,
}: {
  stat: RemovalStat
  onSearchUnsure?: () => void
}) => (
  <TooltipWrap text={formatRemovalTooltip(stat)}>
    <button
      className={`flex h-5 min-w-5 flex-none cursor-pointer items-center justify-center rounded px-1.5 text-[11px] font-bold leading-none transition-colors ${SEVERITY_CLASSES[stat.severity]}`}
      onClick={stopAndCall(onSearchUnsure)}
    >
      {stat.ratio.toFixed(2)}
    </button>
  </TooltipWrap>
)

const RemovalBadgeCompact = ({ onSearchUnsure }: { onSearchUnsure?: () => void }) => (
  <TooltipWrap text="May need sharper boundaries">
    <button
      className="flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded text-amber-700 transition-colors hover:text-amber-900"
      onClick={stopAndCall(onSearchUnsure)}
    >
      <AlertTriangle className="h-3.5 w-3.5" />
    </button>
  </TooltipWrap>
)

export const CodeItem = ({
  code,
  count = 0,
  removalStat,
  debugRemoval = false,
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
    {debugRemoval && removalStat != null && (
      <RemovalBadgeDebug stat={removalStat} onSearchUnsure={onSearchUnsure} />
    )}
    {!debugRemoval && isDangerVisible(removalStat) && (
      <RemovalBadgeCompact onSearchUnsure={onSearchUnsure} />
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
