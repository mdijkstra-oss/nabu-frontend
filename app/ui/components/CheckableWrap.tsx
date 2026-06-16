"use client"

import { useState, type ReactNode } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Check, Minus } from "lucide-react"
import { solidBackground, hoveredElementBorder } from "~/ui/theme/radix"

interface CheckableWrapProps {
  color: string
  checked: boolean
  partial?: boolean
  bodyTogglesSelection?: boolean
  onToggle: () => void
  children: ReactNode
}

const CHECKBOX_SIZE = 18
const GAP = 10

const springTransition = { type: "spring" as const, stiffness: 500, damping: 35 }

export const CheckableWrap = ({
  color,
  checked,
  partial = false,
  bodyTogglesSelection = false,
  onToggle,
  children,
}: CheckableWrapProps) => {
  const [rowHovered, setRowHovered] = useState(false)
  const [boxHovered, setBoxHovered] = useState(false)
  const isVisible = rowHovered || checked || partial
  const showPreview = boxHovered && !checked && !partial
  const isFilled = checked || partial || showPreview
  const showDash = partial && !checked && !showPreview

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggle()
  }

  return (
    <div
      className="flex w-full items-center"
      onMouseEnter={() => setRowHovered(true)}
      onMouseLeave={() => setRowHovered(false)}
    >
      <motion.div
        className="flex flex-none items-center justify-center overflow-hidden"
        animate={{
          width: isVisible ? CHECKBOX_SIZE + GAP : 0,
          opacity: isVisible ? 1 : 0,
        }}
        transition={springTransition}
      >
        <button
          className="flex items-center justify-center rounded-full border-2 border-solid transition-all cursor-pointer"
          style={{
            width: CHECKBOX_SIZE,
            height: CHECKBOX_SIZE,
            minWidth: CHECKBOX_SIZE,
            borderColor: isFilled ? solidBackground(color) : hoveredElementBorder(color),
            backgroundColor: isFilled ? solidBackground(color) : "transparent",
            opacity: showPreview ? 0.4 : (checked || partial) && boxHovered ? 0.7 : 1,
          }}
          onClick={toggle}
          onMouseEnter={() => setBoxHovered(true)}
          onMouseLeave={() => setBoxHovered(false)}
        >
          <AnimatePresence>
            {isFilled && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={springTransition}
                className="flex items-center justify-center"
              >
                {showDash ? (
                  <Minus className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                ) : (
                  <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                )}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </motion.div>
      <div
        className={`min-w-0 grow ${bodyTogglesSelection ? "cursor-pointer" : ""}`}
        onClick={bodyTogglesSelection ? toggle : undefined}
      >
        {children}
      </div>
    </div>
  )
}
