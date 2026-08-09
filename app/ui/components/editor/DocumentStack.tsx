"use client"

import { useMemo, type ReactNode } from "react"
import { motion } from "framer-motion"
import { getSelectedDocs } from "~/domain/data-blocks/ux/selectors"
import { fanSpring } from "~/lib/ui/card-layout"
import { cn } from "~/ui/utils"

interface DocumentStackProps {
  files: Record<string, string>
  activeId: string | null
  front: ReactNode
  onUnderlyingClick: () => void
  className?: string
}

const CLOSED_PEEK = 2

const closedOffset = (depth: number) => ({ x: depth * 7, y: depth * 7 })

const BubbleShell = ({ className }: { className?: string }) => (
  <div
    className={cn(
      "h-full w-full rounded-xl border border-solid border-panel-border bg-default-background",
      className
    )}
  />
)

interface DocumentStackViewProps {
  underlyingCount: number
  front: ReactNode
  onUnderlyingClick: () => void
  className?: string
}

export const DocumentStackView = ({
  underlyingCount,
  front,
  onUnderlyingClick,
  className,
}: DocumentStackViewProps) => {
  const peekCount = Math.min(CLOSED_PEEK, underlyingCount)
  const shells = Array.from({ length: peekCount }, (_, k) => peekCount - k)

  return (
    <div className={cn("relative isolate", className)}>
      {shells.map((depth) => (
        <motion.div
          key={depth}
          className="absolute inset-0"
          style={{ zIndex: 100 - depth }}
          initial={false}
          animate={closedOffset(depth)}
          transition={fanSpring}
        >
          <button
            type="button"
            aria-label="Open selected documents"
            onClick={onUnderlyingClick}
            className="absolute inset-0 cursor-pointer"
          >
            <BubbleShell className="shadow-lg" />
          </button>
        </motion.div>
      ))}
      <div className="absolute inset-0" style={{ zIndex: 100 }}>
        {front}
      </div>
    </div>
  )
}

export const DocumentStack = ({
  files,
  activeId,
  front,
  onUnderlyingClick,
  className,
}: DocumentStackProps) => {
  const underlyingCount = useMemo(() => {
    const selected = getSelectedDocs(files)
    return [...selected].filter((id) => id !== activeId).length
  }, [files, activeId])

  return (
    <DocumentStackView
      underlyingCount={underlyingCount}
      front={front}
      onUnderlyingClick={onUnderlyingClick}
      className={className}
    />
  )
}
