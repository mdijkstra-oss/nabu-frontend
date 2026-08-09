"use client"

import { Trash2 } from "lucide-react"
import type { RenderableChart } from "~/lib/chart/types"
import { IconButton } from "~/ui/components/IconButton"
import { ChartRenderer } from "./renderers/dispatch"
import type { ChartTooltipContext } from "./renderers/ChartTooltip"
import { CHART_HEIGHT } from "./renderers/shared"
import { QueryResultsTable } from "./QueryResultsTable"

export interface ChartQueryResults {
  rows: Record<string, unknown>[]
  query: string
}

export type ChartCardState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | {
      status: "ready"
      renderable: RenderableChart
      tooltipContext: ChartTooltipContext
      queryResults?: ChartQueryResults
    }

export interface ChartCardProps {
  state: ChartCardState
  caption?: string
  onDelete?: () => void
  onDatumClick?: (url: string) => void
  height?: number
}

const Placeholder = ({
  height,
  textClass,
  children,
}: {
  height: number
  textClass: string
  children: React.ReactNode
}) => (
  <div className={`flex items-center justify-center text-sm ${textClass}`} style={{ height }}>
    {children}
  </div>
)

const CardBody = ({
  state,
  onDatumClick,
  height,
}: {
  state: ChartCardState
  onDatumClick?: (url: string) => void
  height: number
}) => {
  switch (state.status) {
    case "loading":
      return (
        <Placeholder height={height} textClass="text-subtext-color">
          Loading...
        </Placeholder>
      )
    case "empty":
      return (
        <Placeholder height={height} textClass="text-subtext-color">
          No data
        </Placeholder>
      )
    case "error":
      return (
        <Placeholder height={height} textClass="text-error-700">
          {state.message}
        </Placeholder>
      )
    case "ready":
      return (
        <ChartRenderer
          renderable={state.renderable}
          tooltipContext={state.tooltipContext}
          onDatumClick={onDatumClick}
          height={height}
        />
      )
  }
}

export const ChartCard = ({
  state,
  caption,
  onDelete,
  onDatumClick,
  height = CHART_HEIGHT,
}: ChartCardProps) => (
  <div className="group/chart flex w-full flex-col overflow-hidden rounded-lg border border-solid border-neutral-border bg-default-background my-2 relative">
    {onDelete && (
      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover/chart:opacity-100 transition-opacity">
        <IconButton variant="neutral-tertiary" size="small" icon={<Trash2 />} onClick={onDelete} />
      </div>
    )}
    <div className="px-4 py-3">
      <CardBody state={state} onDatumClick={onDatumClick} height={height} />
    </div>
    {state.status === "ready" && state.queryResults && (
      <QueryResultsTable rows={state.queryResults.rows} query={state.queryResults.query} />
    )}
    {caption && (
      <div className="px-4 pb-3">
        <span className="text-caption font-caption text-subtext-color italic">{caption}</span>
      </div>
    )}
  </div>
)
