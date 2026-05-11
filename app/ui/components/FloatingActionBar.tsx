"use client"

import { Children, useState, type ReactNode } from "react"
import { AnimatePresence, LayoutGroup, motion } from "framer-motion"
import { X } from "lucide-react"
import { cn } from "~/ui/utils"

export interface ActionBarAction {
  icon: ReactNode
  label: string
  onClick: () => void
  variant?: "default" | "ai"
  disabled?: boolean
}

export interface FloatingActionBarProps {
  title: string
  titleAction?: { label: string; onClick: () => void }
  titleDetail?: ReactNode
  actions: readonly ActionBarAction[]
  onClose: () => void
}

const springTransition = { type: "spring" as const, stiffness: 500, damping: 28 }

export function ActionBarButton({
  icon,
  label,
  onClick,
  variant = "default",
  disabled,
}: ActionBarAction) {
  const isAi = variant === "ai"

  return (
    <button
      className={cn(
        "group/action flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors",
        disabled
          ? "cursor-default opacity-40"
          : cn(
              "cursor-pointer",
              isAi
                ? "border border-solid border-brand-600 hover:border-brand-300 bg-transparent hover:bg-brand-900/40"
                : "border-none bg-transparent hover:bg-neutral-700/60"
            ),
        !disabled && !isAi && "border-none bg-transparent"
      )}
      onClick={disabled ? undefined : onClick}
      type="button"
      disabled={disabled}
    >
      <span
        className={cn(
          "flex items-center [&>svg]:h-3.5 [&>svg]:w-3.5 transition-colors",
          isAi ? "text-brand-400" : "text-neutral-400",
          !disabled && !isAi && "group-hover/action:text-neutral-100"
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "text-caption-bold font-caption-bold transition-colors",
          isAi ? "text-brand-300" : "text-neutral-400",
          !disabled && !isAi && "group-hover/action:text-neutral-100"
        )}
      >
        {label}
      </span>
    </button>
  )
}

const detailTransition = { type: "spring" as const, stiffness: 400, damping: 30 }

export function FloatingActionBar({
  title,
  titleAction,
  titleDetail,
  actions,
  onClose,
}: FloatingActionBarProps) {
  const [showDetail, setShowDetail] = useState(false)
  const detailCount = Children.count(titleDetail)
  const detailGridCols = detailCount <= 6 ? "grid-cols-[auto_auto]" : "grid-cols-[auto_auto_auto]"

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
      onMouseLeave={titleDetail ? () => setShowDetail(false) : undefined}
    >
      <LayoutGroup>
        <AnimatePresence>
          {showDetail && titleDetail && (
            <motion.div
              className="absolute bottom-full left-1/2 -translate-x-1/2 min-w-full w-max pb-3"
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 8, opacity: 0 }}
              transition={detailTransition}
            >
              <motion.div
                layout
                className={cn(
                  "grid gap-x-4 gap-y-0 rounded-xl bg-sidebar px-4 py-3 shadow-lg text-xs overflow-hidden",
                  detailGridCols
                )}
                style={{ originX: 0.5, originY: 1 }}
                transition={springTransition}
              >
                {titleDetail}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div
          layout
          className="flex flex-col items-center gap-2.5 rounded-2xl bg-neutral-900 px-5 py-3.5 shadow-lg whitespace-nowrap"
          initial={{ y: 24, scale: 0.95, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          exit={{ y: 24, scale: 0.95, opacity: 0 }}
          transition={springTransition}
        >
          <div className="flex w-full items-center justify-between gap-4">
            <div
              className="flex flex-1 items-center gap-2"
              onMouseEnter={titleDetail ? () => setShowDetail(true) : undefined}
            >
              <span className="text-body-bold font-body-bold text-white cursor-default">
                {title}
              </span>
              {titleAction && (
                <button
                  className="cursor-pointer border-none bg-transparent text-caption font-caption text-neutral-400 hover:text-brand-400"
                  onClick={titleAction.onClick}
                  type="button"
                >
                  · {titleAction.label}
                </button>
              )}
            </div>
            <button
              className="flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-full border-none bg-neutral-700 hover:bg-neutral-600"
              onClick={onClose}
              onMouseEnter={() => setShowDetail(false)}
              type="button"
            >
              <X className="h-3 w-3 text-neutral-400" />
            </button>
          </div>
          <div className="flex h-px w-full flex-none bg-neutral-700" />
          <div className="flex items-center gap-3" onMouseEnter={() => setShowDetail(false)}>
            {actions.map((action) => (
              <ActionBarButton key={action.label} {...action} />
            ))}
          </div>
        </motion.div>
      </LayoutGroup>
    </div>
  )
}
