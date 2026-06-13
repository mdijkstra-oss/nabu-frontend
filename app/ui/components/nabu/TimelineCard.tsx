import { useLayoutEffect, useRef, type ReactNode } from "react"

export type TimelineKind = "QUESTION" | "ANSWER" | "PLAN"
export type TimelineMarker = "ask" | "respond"

interface TimelineCardProps {
  kind: TimelineKind | null
  marker: TimelineMarker
  children: ReactNode
  scrollOnMount?: boolean
}

const railClass: Record<TimelineMarker, string> = {
  ask: "bg-brand-700",
  respond: "bg-brand-400",
}

const SparkleMarker = () => (
  <span className="absolute left-[14px] -translate-x-1/2 top-[-1px] z-10 flex h-4 w-4 items-center justify-center">
    <span className="absolute inset-0 rounded-full bg-brand-400/50 blur-sm" />
    <svg
      width="16"
      height="16"
      viewBox="-3 -3 20 20"
      fill="none"
      className="relative"
      style={{ overflow: "visible" }}
    >
      <path
        d="M7 0L8.5 5.5L14 7L8.5 8.5L7 14L5.5 8.5L0 7L5.5 5.5L7 0Z"
        className="fill-brand-400"
      />
    </svg>
  </span>
)

export const TimelineCard = ({
  kind,
  marker,
  children,
  scrollOnMount = false,
}: TimelineCardProps) => {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!scrollOnMount) return
    ref.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [scrollOnMount])
  return (
    <div ref={ref} className="relative w-full pl-[30px]">
      <span
        className={`absolute left-[14px] -translate-x-1/2 top-0 bottom-0 w-[3px] rounded-sm ${railClass[marker]}`}
      />
      {marker === "respond" && <SparkleMarker />}
      {kind && (
        <div className="mb-2.5 flex items-center">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-brand-700">
            {kind}
          </span>
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
