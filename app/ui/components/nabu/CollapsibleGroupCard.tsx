"use client"

import { useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronRight } from "lucide-react"
import { cn } from "~/ui/utils"

export interface CardTone {
  surface: string
  summaryText: string
  icon: string
  hover: string
  divider: string
}

export const successTone: CardTone = {
  surface: "bg-success-100",
  summaryText: "text-success-700",
  icon: "text-success-600",
  hover: "hover:bg-success-600/10",
  divider: "border-success-600/20",
}

export const slateTone: CardTone = {
  surface: "bg-slate-100",
  summaryText: "text-slate-700",
  icon: "text-slate-500",
  hover: "hover:bg-slate-500/10",
  divider: "border-slate-500/20",
}

const expandSpring = { type: "spring" as const, stiffness: 500, damping: 38 }

interface CollapsibleGroupCardProps {
  tone: CardTone
  glyph?: ReactNode
  summary: ReactNode
  expandable?: boolean
  defaultExpanded?: boolean
  onSummaryClick?: () => void
  children?: ReactNode
}

export const CollapsibleGroupCard = ({
  tone,
  glyph,
  summary,
  expandable = true,
  defaultExpanded = false,
  onSummaryClick,
  children,
}: CollapsibleGroupCardProps) => {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const onClick = expandable ? () => setExpanded((v) => !v) : onSummaryClick
  return (
    <div className={cn("overflow-hidden rounded-lg", tone.surface)}>
      <button
        onClick={onClick}
        className={cn(
          "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors",
          tone.hover
        )}
      >
        {glyph && <span className={cn("mt-0.5 flex-none", tone.icon)}>{glyph}</span>}
        <span className={cn("grow text-caption font-caption font-medium", tone.summaryText)}>
          {summary}
        </span>
        {expandable && (
          <ChevronRight
            className={cn(
              "mt-0.5 h-3.5 w-3.5 flex-none transition-transform",
              tone.icon,
              expanded && "rotate-90"
            )}
          />
        )}
      </button>
      <AnimatePresence initial={false}>
        {expandable && expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={expandSpring}
            className="overflow-hidden"
          >
            <div className={cn("flex flex-col border-t", tone.divider)}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
