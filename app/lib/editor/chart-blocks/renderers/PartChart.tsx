"use client"

import type { ReactElement } from "react"
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Treemap,
} from "recharts"
import type { PartRenderable } from "~/lib/chart/types"
import { exhaustive } from "~/lib/utils/exhaustive"
import {
  buildChartTooltipContent,
  type ChartTooltipContext,
  type RechartsTooltipContent,
} from "./ChartTooltip"
import { CHART_HEIGHT, FALLBACK_COLOR, buildDatumClickHandler } from "./shared"

interface PartChartProps {
  renderable: PartRenderable
  tooltipContext: ChartTooltipContext
  onDatumClick?: (url: string) => void
  height?: number
}

interface InnerProps {
  renderable: PartRenderable
  tooltipContent: RechartsTooltipContent
  onDatumClick?: (url: string) => void
}

const renderPie = ({ renderable, tooltipContent, onDatumClick }: InnerProps): ReactElement => {
  const onClick = buildDatumClickHandler(onDatumClick)
  return (
    <PieChart>
      <RechartsTooltip content={tooltipContent} />
      <Pie
        data={renderable.rows}
        dataKey="value"
        nameKey="name"
        cx="50%"
        cy="50%"
        outerRadius="80%"
        paddingAngle={1}
        className="nabu-chart-stacked"
        onClick={onClick}
        cursor={onDatumClick ? "pointer" : undefined}
        label
      >
        {renderable.rows.map((row, i) => (
          <Cell key={i} fill={row.fill || FALLBACK_COLOR} />
        ))}
      </Pie>
    </PieChart>
  )
}

const renderTreemap = ({ renderable, tooltipContent, onDatumClick }: InnerProps): ReactElement => {
  const onClick = buildDatumClickHandler(onDatumClick)
  return (
    <Treemap
      data={renderable.rows}
      dataKey="value"
      nameKey="name"
      className="nabu-chart-stacked"
      fill={FALLBACK_COLOR}
      onClick={onClick}
    >
      <RechartsTooltip content={tooltipContent} />
    </Treemap>
  )
}

const renderByType = (inner: InnerProps): ReactElement => {
  switch (inner.renderable.type) {
    case "pie":
      return renderPie(inner)
    case "treemap":
      return renderTreemap(inner)
    default:
      return exhaustive(inner.renderable.type)
  }
}

export const PartChart = ({
  renderable,
  tooltipContext,
  onDatumClick,
  height = CHART_HEIGHT,
}: PartChartProps) => {
  const tooltipContent = buildChartTooltipContent(tooltipContext)
  const inner: InnerProps = { renderable, tooltipContent, onDatumClick }

  return (
    <ResponsiveContainer className="nabu-chart" width="100%" height={height}>
      {renderByType(inner)}
    </ResponsiveContainer>
  )
}
