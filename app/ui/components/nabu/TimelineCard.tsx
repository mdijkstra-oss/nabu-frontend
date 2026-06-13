import { useLayoutEffect, useRef, type ReactNode } from "react"

export type TimelineKind = "QUESTION" | "ANSWER" | "PLAN"
export type TimelineMarker = "ask" | "respond"

interface TimelineCardProps {
  kind: TimelineKind | null
  marker: TimelineMarker
  children: ReactNode
  scrollOnMount?: boolean
  timestamp?: number
}

const railClass: Record<TimelineMarker, string> = {
  ask: "bg-brand-700",
  respond: "bg-brand-400",
}

export const formatHourMinute = (ms: number): string => {
  const d = new Date(ms)
  const h = d.getHours().toString().padStart(2, "0")
  const m = d.getMinutes().toString().padStart(2, "0")
  return `${h}:${m}`
}

export const TimelineCard = ({
  kind,
  marker,
  children,
  scrollOnMount = false,
  timestamp,
}: TimelineCardProps) => {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!scrollOnMount) return
    ref.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [scrollOnMount])
  const showTime = timestamp !== undefined
  return (
    <div ref={ref} className="group relative w-full pl-[30px]">
      <span
        className={`absolute left-[14px] -translate-x-1/2 top-0 bottom-0 w-[3px] rounded-sm ${railClass[marker]}`}
      />
      {(kind || showTime) && (
        <div className="mb-2.5 flex items-center gap-2">
          {kind && (
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-brand-700">
              {kind}
            </span>
          )}
          {showTime && (
            <span className="text-[11px] text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100">
              {formatHourMinute(timestamp)}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

export const Connector = () => (
  <div className="relative w-full h-7 pl-[30px]">
    <span className="absolute left-[14px] -translate-x-1/2 top-0 bottom-0 w-px bg-neutral-200" />
    <span className="absolute left-[30px] right-0 top-1/2 h-px bg-neutral-200" />
  </div>
)
