"use client"

import { memo, useEffect, useState, type RefObject } from "react"
import type { GutterMark } from "~/lib/editor/gutter/types"
import { calculateGutterMarks } from "~/lib/editor/gutter/calculate"
import { measureAnnotationSpans } from "~/lib/editor/gutter/measure"
import { solidBackground } from "~/ui/theme/radix"

interface ScrollGutterProps {
  contentRef: RefObject<HTMLElement | null>
  scrollContainerRef: RefObject<HTMLElement | null>
  onScrollTo: (percent: number) => void
}

interface Refs {
  contentRef: RefObject<HTMLElement | null>
  scrollContainerRef: RefObject<HTMLElement | null>
}

const updateGutterMarks = ({ contentRef, scrollContainerRef }: Refs): GutterMark[] => {
  if (!contentRef.current || !scrollContainerRef.current) return []

  const measurements = measureAnnotationSpans(contentRef.current, scrollContainerRef.current)
  const scrollHeight = scrollContainerRef.current.scrollHeight

  return calculateGutterMarks(measurements, scrollHeight)
}

const createMarkBackground = (colors: string[]): string => solidBackground(colors[0] ?? "gray")

const GutterMarkElement = ({ mark }: { mark: GutterMark }) => (
  <div
    style={{
      position: "absolute",
      top: `${mark.topPercent}%`,
      left: "3px",
      right: "3px",
      height: `${mark.heightPercent}%`,
      minHeight: "3px",
      background: createMarkBackground(mark.colors),
      borderRadius: "9999px",
    }}
  />
)

export const ScrollGutter = memo(
  ({ contentRef, scrollContainerRef, onScrollTo }: ScrollGutterProps) => {
    const [marks, setMarks] = useState<GutterMark[]>([])

    useEffect(() => {
      const refreshMarks = () => {
        const newMarks = updateGutterMarks({ contentRef, scrollContainerRef })
        setMarks(newMarks)
      }

      refreshMarks()

      const observer = new MutationObserver(refreshMarks)
      if (contentRef.current) {
        observer.observe(contentRef.current, { childList: true, subtree: true })
      }

      return () => observer.disconnect()
    }, [contentRef, scrollContainerRef])

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const y = e.clientY - rect.top
      const percent = (y / rect.height) * 100
      onScrollTo(percent)
    }

    return (
      <div
        className="w-5 flex-none bg-white cursor-pointer"
        style={{ position: "relative", height: "100%" }}
        onClick={handleClick}
      >
        {marks.map((mark, idx) => (
          <GutterMarkElement key={idx} mark={mark} />
        ))}
      </div>
    )
  }
)
