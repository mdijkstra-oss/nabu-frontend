"use client"

import { AlertTriangle } from "lucide-react"
import { TooltipWrap } from "~/ui/components/TooltipWrap"
import {
  solidBackground,
  elementBackground,
  hoveredElementBackground,
  hoveredElementBorder,
} from "~/ui/theme/radix"
import type {
  ReviewStat,
  ReviewSeverity,
} from "~/domain/data-blocks/attributes/annotations/selectors"
import type { Code } from "./types"

interface CodeItemProps {
  code: Code
  count?: number
  reviewStat?: ReviewStat
  debugReview?: boolean
  highlighted?: boolean
  onMouseEnter?: () => void
  onClick?: () => void
  onCountClick?: () => void
  onSearchUnsure?: () => void
}

const formatFileTooltip = (count: number): string =>
  `${count} annotation${count === 1 ? "" : "s"} in this file`

const SEVERITY_TOOLTIPS: Record<ReviewSeverity, string> = {
  normal: "",
  warning: " — above baseline (low sample)",
  danger: " — statistically above baseline",
}

const formatReviewTooltip = ({ ratio, severity }: ReviewStat): string =>
  `${(ratio * 100).toFixed(0)}% flagged for review${SEVERITY_TOOLTIPS[severity]}`

const stopAndCall = (handler?: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation()
  handler?.()
}

const SEVERITY_CLASSES: Record<ReviewSeverity, string> = {
  normal: "text-emerald-900 bg-emerald-200/70 hover:bg-emerald-300/80",
  warning: "text-amber-900 bg-amber-200/70 hover:bg-amber-300/80",
  danger: "text-red-900 bg-red-200/70 hover:bg-red-300/80",
}

type ElevatedStat = ReviewStat & { severity: "warning" | "danger" }

const isReviewVisible = (stat: ReviewStat | undefined): stat is ElevatedStat =>
  stat != null && stat.severity !== "normal"

const ReviewBadgeDebug = ({
  stat,
  onSearchUnsure,
}: {
  stat: ReviewStat
  onSearchUnsure?: () => void
}) => (
  <TooltipWrap text={formatReviewTooltip(stat)}>
    <button
      className={`flex h-5 min-w-5 flex-none cursor-pointer items-center justify-center rounded px-1.5 text-[11px] font-bold leading-none transition-colors ${SEVERITY_CLASSES[stat.severity]}`}
      onClick={stopAndCall(onSearchUnsure)}
    >
      {stat.ratio.toFixed(2)}
    </button>
  </TooltipWrap>
)

const COMPACT_CLASSES: Record<"warning" | "danger", string> = {
  warning: "text-amber-600 hover:text-amber-800",
  danger: "text-red-600 hover:text-red-800",
}

const ReviewBadgeCompact = ({
  severity,
  color,
  onSearchUnsure,
}: {
  severity: "warning" | "danger"
  color: string
  onSearchUnsure?: () => void
}) => (
  <TooltipWrap
    text={
      severity === "danger" ? "Probably needs sharper boundaries" : "May need sharper boundaries"
    }
  >
    <button
      className={`flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-full transition-colors ${COMPACT_CLASSES[severity]}`}
      onClick={stopAndCall(onSearchUnsure)}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = hoveredElementBackground(color)
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent"
      }}
    >
      <AlertTriangle className="h-3.5 w-3.5" />
    </button>
  </TooltipWrap>
)

export const CodeItem = ({
  code,
  count = 0,
  reviewStat,
  debugReview = false,
  highlighted = false,
  onMouseEnter,
  onClick,
  onCountClick,
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
    {debugReview && reviewStat != null && (
      <ReviewBadgeDebug stat={reviewStat} onSearchUnsure={onSearchUnsure} />
    )}
    {!debugReview && isReviewVisible(reviewStat) && (
      <ReviewBadgeCompact
        severity={reviewStat.severity}
        color={code.color}
        onSearchUnsure={onSearchUnsure}
      />
    )}
    {count > 0 && (
      <TooltipWrap text={formatFileTooltip(count)}>
        <button
          className="flex h-5 min-w-5 flex-none cursor-pointer items-center justify-center rounded-full border-none px-1.5 text-[11px] font-bold leading-none text-white"
          style={{ backgroundColor: solidBackground(code.color) }}
          onClick={stopAndCall(onCountClick)}
        >
          {count}
        </button>
      </TooltipWrap>
    )}
  </div>
)
