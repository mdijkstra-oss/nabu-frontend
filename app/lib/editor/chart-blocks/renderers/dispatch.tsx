"use client"

import type { RenderableChart } from "~/lib/chart/types"
import { exhaustive } from "~/lib/utils/exhaustive"
import { AxisChart } from "./AxisChart"
import { PartChart } from "./PartChart"
import { Heatmap } from "./Heatmap"
import type { ChartTooltipContext } from "./ChartTooltip"

export interface ChartRendererProps {
  renderable: RenderableChart
  tooltipContext: ChartTooltipContext
  onDatumClick?: (url: string) => void
  height?: number
}

export const ChartRenderer = ({
  renderable,
  tooltipContext,
  onDatumClick,
  height,
}: ChartRendererProps) => {
  switch (renderable.kind) {
    case "axis":
      return (
        <AxisChart
          renderable={renderable}
          tooltipContext={tooltipContext}
          onDatumClick={onDatumClick}
          height={height}
        />
      )
    case "part":
      return (
        <PartChart
          renderable={renderable}
          tooltipContext={tooltipContext}
          onDatumClick={onDatumClick}
          height={height}
        />
      )
    case "matrix":
      return (
        <Heatmap
          renderable={renderable}
          tooltipContext={tooltipContext}
          onDatumClick={onDatumClick}
          height={height}
        />
      )
    default:
      return exhaustive(renderable)
  }
}
