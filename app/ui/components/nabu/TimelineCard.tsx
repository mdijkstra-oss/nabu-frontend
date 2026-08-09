import { useLayoutEffect, useRef, type ReactNode } from "react"

export type TimelineKind = "QUESTION" | "ANSWER" | "PLAN" | string
export type TimelineMarker =
  | "ask"
  | "respond"
  | "plan"
  | "step-pending"
  | "step-active"
  | "step-done"
  | "step-cancelled"
  | "step-checkpoint"
  | "edit"

interface TimelineCardProps {
  kind: TimelineKind | null
  marker: TimelineMarker
  children?: ReactNode
  scrollOnMount?: boolean
  timestamp?: number
  glyph?: ReactNode
  kindClassName?: string
}

export const railClass: Record<TimelineMarker, string> = {
  ask: "bg-brand-700",
  respond: "bg-brand-400",
  plan: "bg-brand-600",
  "step-pending": "bg-neutral-300",
  "step-active": "bg-brand-600",
  "step-done": "bg-success-600",
  "step-cancelled": "bg-neutral-400",
  "step-checkpoint": "bg-brand-700",
  edit: "bg-success-600",
}

const DEFAULT_KIND_CLASS = "text-[11px] font-bold uppercase tracking-[0.08em] text-brand-700"

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
  glyph,
  kindClassName,
}: TimelineCardProps) => {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!scrollOnMount) return
    ref.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [scrollOnMount])
  const showHeader = kind !== null || glyph !== undefined
  const showTime = timestamp !== undefined && showHeader
  return (
    <div ref={ref} className="group relative w-full pl-[30px]">
      <span
        className={`absolute left-[14px] -translate-x-1/2 top-0 bottom-0 w-[3px] rounded-sm ${railClass[marker]}`}
      />
      {showHeader && (
        <div className="mb-2.5 flex items-center gap-2">
          {glyph}
          {kind && <span className={kindClassName ?? DEFAULT_KIND_CLASS}>{kind}</span>}
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
  <div className="relative w-full h-7 flex-none pl-[30px]">
    <span className="absolute left-[14px] -translate-x-1/2 top-0 bottom-0 w-px bg-neutral-200" />
    <span className="absolute left-[30px] right-0 top-1/2 h-px bg-neutral-200" />
  </div>
)
