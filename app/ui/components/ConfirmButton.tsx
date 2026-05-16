"use client"

import { useState, type ReactNode } from "react"
import { motion } from "framer-motion"
import { cn } from "~/ui/utils"

interface ConfirmButtonProps {
  icon: ReactNode
  label: string
  onConfirm: () => void
  disabled?: boolean
  className?: string
}

const layoutTransition = { type: "spring" as const, stiffness: 500, damping: 30 }

export function ConfirmButton({ icon, label, onConfirm, disabled, className }: ConfirmButtonProps) {
  const [phase, setPhase] = useState<"idle" | "armed" | "done">("idle")
  const [prevDisabled, setPrevDisabled] = useState(disabled)
  if (disabled !== prevDisabled) {
    setPrevDisabled(disabled)
    if (disabled) setPhase("idle")
  }
  const effectivePhase = disabled ? "idle" : phase

  const handleClick = () => {
    if (disabled) return
    if (effectivePhase === "armed") {
      setPhase("done")
      onConfirm()
    } else if (effectivePhase === "idle") {
      setPhase("armed")
    }
  }

  const handleMouseLeave = () => {
    if (effectivePhase === "armed") setPhase("idle")
  }

  const isArmed = effectivePhase === "armed"
  const isDone = effectivePhase === "done"
  const activeLabel = isArmed ? "Confirm" : label

  return (
    <motion.button
      layout
      className={cn(
        "group/confirm flex items-center gap-1.5 rounded-full px-2.5 py-1 border-none transition-all duration-200",
        isDone
          ? "cursor-default bg-success-600"
          : disabled
            ? "cursor-default opacity-40 bg-transparent"
            : isArmed
              ? "cursor-pointer bg-error-600 hover:bg-error-500"
              : "cursor-pointer bg-transparent hover:bg-neutral-700/60",
        className
      )}
      onClick={handleClick}
      onMouseLeave={handleMouseLeave}
      type="button"
      disabled={disabled || isDone}
      transition={layoutTransition}
    >
      <span
        className={cn(
          "flex items-center [&>svg]:h-3.5 [&>svg]:w-3.5 transition-colors duration-200",
          isArmed || isDone ? "text-white" : disabled ? "text-neutral-400" : "text-white",
          !disabled && !isArmed && !isDone && "group-hover/confirm:text-neutral-100"
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "text-caption-bold font-caption-bold transition-colors duration-200",
          isArmed || isDone ? "text-white" : disabled ? "text-neutral-400" : "text-white",
          !disabled && !isArmed && !isDone && "group-hover/confirm:text-neutral-100"
        )}
      >
        {activeLabel}
      </span>
    </motion.button>
  )
}
