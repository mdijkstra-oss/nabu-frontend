"use client"

import { Children, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { cn } from "~/ui/utils"
import { NabuGate } from "~/ui/components/nabu/NabuGate"
import { ConfirmButton } from "~/ui/components/ConfirmButton"

export interface ActionBarAction {
  icon: ReactNode
  label: string
  onClick: () => void
  variant?: "default" | "ai" | "confirm"
  disabled?: boolean
}

export interface ActionBarProps {
  title: string
  detail?: ReactNode
  titleAction?: { label: string; onClick: () => void }
  actions: readonly ActionBarAction[]
  onTitleHover?: (hovering: boolean) => void
}

const springTransition = { type: "spring" as const, stiffness: 500, damping: 28 }
const detailTransition = { type: "spring" as const, stiffness: 400, damping: 30 }

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
                ? "border border-solid border-brand-600 bg-transparent hover:border-transparent hover:bg-brand-50"
                : "border-none bg-transparent hover:bg-brand-50"
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
          disabled ? "text-neutral-400" : "text-subtext-color",
          !disabled && "group-hover/action:text-brand-700"
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "text-caption-bold font-caption-bold transition-colors",
          disabled ? "text-neutral-400" : "text-subtext-color",
          !disabled && "group-hover/action:text-default-font"
        )}
      >
        {label}
      </span>
    </button>
  )
}

export function ActionBar({ title, detail, titleAction, actions, onTitleHover }: ActionBarProps) {
  const [showDetail, setShowDetail] = useState(false)
  const [detailHovered, setDetailHovered] = useState(false)
  const [frozenGrid, setFrozenGrid] = useState<{
    cols: string
    rows: number
    height: number
  } | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const detailCount = Children.count(detail)
  const detailCols = detailCount <= 6 ? 2 : 3
  const detailRows = Math.ceil(detailCount / detailCols)

  return (
    <div className="relative" onMouseLeave={() => setShowDetail(false)}>
      <AnimatePresence>
        {showDetail && detail && (
          <motion.div
            className="absolute bottom-full left-0 w-full pb-2"
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={detailTransition}
          >
            <motion.div
              ref={detailRef}
              layout={!detailHovered}
              className="grid grid-flow-col content-start gap-x-4 gap-y-0 rounded-xl bg-sidebar px-4 py-3 shadow-lg text-xs overflow-hidden"
              style={{
                originX: 0.5,
                originY: 1,
                gridTemplateRows: `repeat(${frozenGrid?.rows ?? detailRows}, auto)`,
                ...(frozenGrid
                  ? { gridTemplateColumns: frozenGrid.cols, height: frozenGrid.height }
                  : {}),
              }}
              transition={springTransition}
              onMouseEnter={() => {
                setDetailHovered(true)
                if (detailRef.current) {
                  const style = getComputedStyle(detailRef.current)
                  setFrozenGrid({
                    cols: style.gridTemplateColumns,
                    rows: detailRows,
                    height: detailRef.current.getBoundingClientRect().height,
                  })
                }
              }}
              onMouseLeave={() => {
                setDetailHovered(false)
                setFrozenGrid(null)
              }}
            >
              {detail}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        className="flex w-full items-center gap-4 rounded-xl border border-solid border-neutral-border bg-sidebar px-5 py-2.5 whitespace-nowrap"
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 8, opacity: 0 }}
        transition={springTransition}
      >
        <div
          className="flex items-center gap-2"
          onMouseEnter={detail ? () => setShowDetail(true) : undefined}
        >
          <span
            className={cn(
              "-mx-2 -my-1 rounded-full px-2 py-1 text-caption-bold font-caption-bold text-default-font transition-colors",
              onTitleHover
                ? "cursor-pointer hover:bg-brand-50 hover:text-brand-700"
                : "cursor-default"
            )}
            onMouseEnter={onTitleHover ? () => onTitleHover(true) : undefined}
            onMouseLeave={onTitleHover ? () => onTitleHover(false) : undefined}
          >
            {title}
          </span>
          {titleAction && (
            <button
              className="cursor-pointer border-none bg-transparent text-caption font-caption text-subtext-color hover:text-brand-700"
              onClick={titleAction.onClick}
              type="button"
            >
              · {titleAction.label}
            </button>
          )}
        </div>
        <div className="h-4 w-px flex-none bg-neutral-border" />
        <div className="flex items-center gap-3">
          {actions.map((action, i) => {
            if (action.variant === "confirm")
              return (
                <ConfirmButton
                  key={i}
                  icon={action.icon}
                  label={action.label}
                  onConfirm={action.onClick}
                  disabled={action.disabled}
                />
              )
            const button = <ActionBarButton {...action} />
            return action.variant === "ai" ? (
              <NabuGate key={i}>{button}</NabuGate>
            ) : (
              <ActionBarButton key={i} {...action} />
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}
