"use client"

import type { ReactNode } from "react"
import { X } from "lucide-react"

interface DismissableWrapProps {
  onDismiss: () => void
  children: ReactNode
}

export const DismissableWrap = ({ onDismiss, children }: DismissableWrapProps) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDismiss()
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        className="flex h-4 w-4 flex-none cursor-pointer items-center justify-center rounded-full border-none bg-neutral-400/10 hover:bg-neutral-400/35 transition-colors"
        onClick={handleClick}
      >
        <X className="h-2 w-2 text-neutral-400" strokeWidth={3} />
      </button>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
