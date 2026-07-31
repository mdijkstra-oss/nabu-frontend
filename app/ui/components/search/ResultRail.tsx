"use client"

import { useRef, useState } from "react"
import { ChevronUp, ChevronDown } from "lucide-react"
import type { VisibleBand } from "~/lib/ui/card-layout"

const TRACK = 320

interface ResultRailProps {
  band: VisibleBand
  onScrollTo: (index: number) => void
  onStep: (delta: number) => void
}

export const ResultRail = ({ band, onScrollTo, onStep }: ResultRailProps) => {
  const { current, total } = band
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)

  if (total <= 1) return null

  const y = (p: number): number => (p / (total - 1)) * TRACK

  const indexFromClientY = (clientY: number): number => {
    const el = trackRef.current
    if (!el) return current
    const rect = el.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    return Math.round(fraction * (total - 1))
  }

  const beginDrag = (e: React.PointerEvent) => {
    setDragging(true)
    onScrollTo(indexFromClientY(e.clientY))
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const moveDrag = (e: React.PointerEvent) => {
    if (dragging) onScrollTo(indexFromClientY(e.clientY))
  }
  const endDrag = () => setDragging(false)

  return (
    <div className="flex w-16 flex-none flex-col items-center pt-10 select-none">
      <span className="text-caption font-caption text-subtext-color">01</span>
      <div
        ref={trackRef}
        className="relative my-2 w-4 cursor-pointer"
        style={{ height: TRACK }}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <div className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 rounded bg-neutral-300" />
        <div
          className="absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-900 ring-4 ring-neutral-100"
          style={{ top: y(current) }}
        />
      </div>
      <span className="text-caption font-caption text-subtext-color">
        {String(total).padStart(2, "0")}
      </span>
      <button
        type="button"
        aria-label="Previous"
        onClick={() => onStep(-1)}
        className="mt-4 cursor-pointer text-neutral-400 transition-colors hover:text-neutral-700"
      >
        <ChevronUp className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label="Next"
        onClick={() => onStep(1)}
        className="mt-1 cursor-pointer text-neutral-400 transition-colors hover:text-neutral-700"
      >
        <ChevronDown className="h-5 w-5" />
      </button>
      <span className="mt-2 text-caption font-caption text-subtext-color">
        {current + 1} / {total}
      </span>
    </div>
  )
}
