"use client"

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"
import { motion } from "framer-motion"
import {
  LAYOUT,
  fanSpring,
  stackCap,
  stackCenter,
  stackedPosition,
  cumulativeTop,
  reconcileAnchor,
  visibleBand,
  magnet,
  type LayoutMode,
  type VisibleBand,
} from "~/lib/ui/card-layout"
import { groupKey, type RunGroup } from "./cards"
import { cn } from "~/ui/utils"

export interface CardLayoutHandle {
  scrollToIndex: (index: number) => void
  scrollByCards: (n: number) => void
  scrollToFile: (file: string) => void
}

interface CardLayoutEngineProps {
  groups: RunGroup[]
  mode: LayoutMode
  renderCard: (group: RunGroup) => ReactNode
  onBandChange?: (band: VisibleBand) => void
  onNearEnd?: () => void
  className?: string
}

const FlatCard = ({
  index,
  onHeight,
  children,
}: {
  index: number
  onHeight: (index: number, height: number) => void
  children: ReactNode
}) => {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => onHeight(index, el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [index, onHeight])
  return (
    <div ref={ref} className="w-full pb-6">
      {children}
    </div>
  )
}

export const CardLayoutEngine = forwardRef<CardLayoutHandle, CardLayoutEngineProps>(
  ({ groups, mode, renderCard, onBandChange, onNearEnd, className }, ref) => {
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const [stageH, setStageH] = useState(0)
    const [scrollTop, setScrollTop] = useState(0)
    const [scrolling, setScrolling] = useState(false)
    const [heights, setHeights] = useState<number[]>([])
    const ignoreScroll = useRef(false)
    const scrollEnd = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    const total = groups.length
    const progress = scrollTop / LAYOUT.step
    const cap = stackCap(total)
    const center = stackCenter(cap)

    const band =
      mode === "stacked"
        ? visibleBand({ mode, progress, cap, total })
        : visibleBand({ mode, heights, scrollTop, viewport: stageH })
    const { from, to, current } = band

    const bandRef = useRef(band)
    const heightsRef = useRef(heights)
    useEffect(() => {
      bandRef.current = band
      heightsRef.current = heights
    })

    useEffect(() => {
      onBandChange?.({ from, to, current, total })
    }, [from, to, current, total, onBandChange])

    const updateHeight = useCallback((index: number, height: number) => {
      setHeights((prev) => {
        if (prev[index] === height) return prev
        const next = [...prev]
        next[index] = height
        return next
      })
    }, [])

    const onScroll = () => {
      const el = scrollRef.current
      if (!el) return
      setScrollTop(el.scrollTop)
      const nearEnd =
        mode === "flat"
          ? el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight
          : el.scrollTop / LAYOUT.step > total - 2
      if (nearEnd) onNearEnd?.()
      if (ignoreScroll.current) return
      setScrolling(true)
      clearTimeout(scrollEnd.current)
      scrollEnd.current = setTimeout(() => setScrolling(false), 80)
    }

    const scrollToIndex = useCallback(
      (index: number) => {
        const clamped = Math.min(Math.max(index, 0), Math.max(0, groups.length - 1))
        const top = mode === "stacked" ? clamped * LAYOUT.step : cumulativeTop(heights, clamped)
        scrollRef.current?.scrollTo({ top, behavior: "smooth" })
      },
      [mode, groups, heights]
    )

    useImperativeHandle(
      ref,
      () => ({
        scrollToIndex,
        scrollByCards: (n: number) => scrollToIndex(current + n),
        scrollToFile: (file: string) => {
          const index = groups.findIndex((g) => g.file === file)
          if (index >= 0) scrollToIndex(index)
        },
      }),
      [scrollToIndex, current, groups]
    )

    useEffect(() => {
      const el = scrollRef.current
      if (!el) return
      const ro = new ResizeObserver(() => setStageH(el.clientHeight))
      ro.observe(el)
      return () => ro.disconnect()
    }, [])

    useEffect(() => {
      const el = scrollRef.current
      if (!el) return
      const frontIndex = bandRef.current.current
      ignoreScroll.current = true
      el.scrollTop = reconcileAnchor(mode, frontIndex, heightsRef.current)
      setScrollTop(el.scrollTop)
      const id = requestAnimationFrame(() => {
        ignoreScroll.current = false
      })
      return () => cancelAnimationFrame(id)
    }, [mode])

    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "ArrowDown" || e.key === "ArrowRight")
          scrollToIndex(bandRef.current.current + 1)
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") scrollToIndex(bandRef.current.current - 1)
      }
      window.addEventListener("keydown", onKey)
      return () => window.removeEventListener("keydown", onKey)
    }, [scrollToIndex])

    if (mode === "flat") {
      return (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={cn("relative h-full w-full overflow-y-auto", className)}
        >
          <div className="flex w-full flex-col items-start">
            {groups.map((group, index) => (
              <FlatCard key={groupKey(group)} index={index} onHeight={updateHeight}>
                {renderCard(group)}
              </FlatCard>
            ))}
          </div>
        </div>
      )
    }

    const p = magnet(progress)
    const lo = Math.max(0, Math.ceil(p - 1))
    const hi = Math.min(total - 1, Math.floor(p + cap))
    const cards: { group: RunGroup; depth: number }[] = []
    for (let i = lo; i <= hi; i++) cards.push({ group: groups[i], depth: i - p })

    const fanTransition = scrolling ? { duration: 0 } : fanSpring

    return (
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={cn(
          "relative h-full w-full overflow-x-hidden overflow-y-scroll snap-y snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          className
        )}
      >
        <div className="sticky top-0 z-10 h-0 w-full">
          <motion.div
            className="absolute left-0 top-0 w-full origin-center"
            style={{ height: stageH }}
            initial={false}
            animate={{ scale: LAYOUT.openScale }}
            transition={fanSpring}
          >
            {cards.map(({ group, depth }) => {
              const pos = stackedPosition(depth, center)
              return (
                <motion.div
                  key={groupKey(group)}
                  className="absolute inset-0 origin-center overflow-hidden"
                  style={{ zIndex: pos.zIndex }}
                  initial={false}
                  animate={{ y: pos.y, scale: pos.scale, opacity: pos.opacity }}
                  transition={fanTransition}
                >
                  {renderCard(group)}
                </motion.div>
              )
            })}
          </motion.div>
        </div>
        {groups.map((group) => (
          <div
            key={groupKey(group)}
            aria-hidden
            className="snap-start"
            style={{ height: LAYOUT.step }}
          />
        ))}
        <div aria-hidden style={{ height: Math.max(0, stageH - LAYOUT.step) }} />
      </div>
    )
  }
)

CardLayoutEngine.displayName = "CardLayoutEngine"
