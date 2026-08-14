"use client"

import type { ReactElement } from "react"
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { formatValue } from "~/lib/chart/format"
import type { AxisRenderable, ChartBand, SeriesDescriptor } from "~/lib/chart/types"
import { exhaustive } from "~/lib/utils/exhaustive"
import {
  buildChartTooltipContent,
  type ChartTooltipContext,
  type RechartsTooltipContent,
} from "./ChartTooltip"
import { ChartLegend } from "./ChartLegend"
import {
  CHART_AREA_FILL_OPACITY,
  CHART_BAR_RADIUS,
  CHART_DOT_RADIUS,
  CHART_HEIGHT,
  CHART_LINE_WIDTH,
  CHART_MARGIN,
  FALLBACK_COLOR,
  STACKED_BAR_CLASS,
  buildDatumClickHandler,
} from "./shared"

interface AxisChartProps {
  renderable: AxisRenderable
  tooltipContext: ChartTooltipContext
  onDatumClick?: (url: string) => void
  height?: number
}

const tickFormatterFor = (format: string | undefined): ((value: unknown) => string) =>
  format ? (value) => formatValue(value, format) : (value) => String(value ?? "")

// Bands mark category ranges, so they bind to whichever screen axis carries
// the category binding.
const renderBands = (bands: ChartBand[], isHorizontal: boolean): ReactElement[] =>
  bands.map((band) => (
    <ReferenceArea
      key={`${band.from}-${band.to}`}
      yAxisId="left"
      {...(isHorizontal ? { y1: band.from, y2: band.to } : { x1: band.from, x2: band.to })}
      label={{ value: band.label, position: isHorizontal ? "insideRight" : "top" }}
    />
  ))

const barRadius = (isStacked: boolean, isHorizontal: boolean): [number, number, number, number] => {
  if (isStacked) return [0, 0, 0, 0]
  const r = CHART_BAR_RADIUS
  return isHorizontal ? [0, r, r, 0] : [r, r, 0, 0]
}

const renderMark = (
  descriptor: SeriesDescriptor,
  renderable: AxisRenderable,
  isHorizontal: boolean,
  onDatumClick: ((url: string) => void) | undefined
): ReactElement => {
  const onClick = buildDatumClickHandler(onDatumClick)
  const cursor = onDatumClick ? "pointer" : undefined
  const yAxisId = isHorizontal ? "left" : descriptor.axis
  switch (descriptor.mark) {
    case "bar":
      return (
        <Bar
          key={descriptor.key}
          dataKey={descriptor.key}
          name={descriptor.name}
          stackId={descriptor.stackId}
          yAxisId={yAxisId}
          className={descriptor.stackId ? STACKED_BAR_CLASS : undefined}
          radius={barRadius(descriptor.stackId !== undefined, isHorizontal)}
          fill={descriptor.color || FALLBACK_COLOR}
          onClick={onClick}
          cursor={cursor}
        >
          {renderable.rows.map((row, i) => (
            <Cell
              key={i}
              fill={row._colors[descriptor.key] ?? descriptor.color ?? FALLBACK_COLOR}
            />
          ))}
        </Bar>
      )
    case "line":
      return (
        <Line
          key={descriptor.key}
          type="monotone"
          dataKey={descriptor.key}
          name={descriptor.name}
          yAxisId={yAxisId}
          stroke={descriptor.color || FALLBACK_COLOR}
          strokeWidth={CHART_LINE_WIDTH}
          dot={{ r: CHART_DOT_RADIUS, fill: descriptor.color || FALLBACK_COLOR }}
        />
      )
    case "area":
      return (
        <Area
          key={descriptor.key}
          type="monotone"
          dataKey={descriptor.key}
          name={descriptor.name}
          yAxisId={yAxisId}
          stackId={descriptor.stackId}
          fill={descriptor.color || FALLBACK_COLOR}
          fillOpacity={CHART_AREA_FILL_OPACITY}
          stroke={descriptor.color || FALLBACK_COLOR}
          strokeWidth={CHART_LINE_WIDTH}
        />
      )
    case "scatter":
      return (
        <Scatter
          key={descriptor.key}
          dataKey={descriptor.key}
          name={descriptor.name}
          yAxisId={yAxisId}
          fill={descriptor.color || FALLBACK_COLOR}
          onClick={onClick}
          cursor={cursor}
        />
      )
    default:
      return exhaustive(descriptor.mark)
  }
}

const renderChart = (
  renderable: AxisRenderable,
  tooltipContent: RechartsTooltipContent,
  onDatumClick: ((url: string) => void) | undefined
): ReactElement => {
  const allBars = renderable.series.every((descriptor) => descriptor.mark === "bar")
  // Horizontal orientation is honored only for all-bar charts; Recharts draws
  // line and area incoherently under a category y-axis, so anything else
  // degrades to vertical.
  const isHorizontal = renderable.orientation === "horizontal" && allBars
  const hasRight = !isHorizontal && renderable.series.some((d) => d.axis === "right")
  const categoryTick = tickFormatterFor(renderable.xFormat)
  const leftTick = tickFormatterFor(
    isHorizontal
      ? (renderable.leftAxisFormat ?? renderable.rightAxisFormat)
      : renderable.leftAxisFormat
  )
  const rightTick = tickFormatterFor(renderable.rightAxisFormat)

  // Recharts scans direct chart children for axes and marks; a fragment hides
  // them, because its bundled react-is 18 does not recognize React 19 fragment
  // elements — marks stay flat arrays of direct children.
  return (
    <ComposedChart
      data={renderable.rows}
      layout={isHorizontal ? "vertical" : "horizontal"}
      margin={CHART_MARGIN}
    >
      <CartesianGrid vertical={isHorizontal} horizontal={!isHorizontal} />
      {renderBands(renderable.bands, isHorizontal)}
      {isHorizontal ? (
        <XAxis type="number" tickFormatter={leftTick} axisLine={false} tickLine={false} />
      ) : (
        <XAxis dataKey="x" tickFormatter={categoryTick} axisLine={false} tickLine={false} />
      )}
      {isHorizontal ? (
        <YAxis
          yAxisId="left"
          dataKey="x"
          type="category"
          tickFormatter={categoryTick}
          axisLine={false}
          tickLine={false}
        />
      ) : (
        <YAxis yAxisId="left" tickFormatter={leftTick} axisLine={false} tickLine={false} />
      )}
      {hasRight ? (
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={rightTick}
          axisLine={false}
          tickLine={false}
        />
      ) : null}
      <RechartsTooltip content={tooltipContent} />
      {renderable.series.length > 1 ? <Legend content={<ChartLegend />} /> : null}
      {renderable.series.map((descriptor) =>
        renderMark(descriptor, renderable, isHorizontal, onDatumClick)
      )}
    </ComposedChart>
  )
}

export const AxisChart = ({
  renderable,
  tooltipContext,
  onDatumClick,
  height = CHART_HEIGHT,
}: AxisChartProps) => {
  const tooltipContent = buildChartTooltipContent(tooltipContext)

  return (
    <ResponsiveContainer className="nabu-chart" width="100%" height={height}>
      {renderChart(renderable, tooltipContent, onDatumClick)}
    </ResponsiveContainer>
  )
}
