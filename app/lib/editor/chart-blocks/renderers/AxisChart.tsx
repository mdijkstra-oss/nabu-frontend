"use client"

import type { ReactElement } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { formatValue } from "~/lib/chart/format"
import type { AxisChartType, AxisRenderable } from "~/lib/chart/types"
import { exhaustive } from "~/lib/utils/exhaustive"
import {
  buildChartTooltipContent,
  type ChartTooltipContext,
  type RechartsTooltipContent,
} from "./ChartTooltip"
import { CHART_HEIGHT, FALLBACK_COLOR, buildDatumClickHandler } from "./shared"

interface AxisChartProps {
  renderable: AxisRenderable
  tooltipContext: ChartTooltipContext
  onDatumClick?: (url: string) => void
  height?: number
}

interface InnerProps {
  renderable: AxisRenderable
  tooltipContent: RechartsTooltipContent
  onDatumClick?: (url: string) => void
}

const tickFormatterFor = (format: string | undefined): ((value: unknown) => string) =>
  format ? (value) => formatValue(value, format) : (value) => String(value ?? "")

const seriesColor = (renderable: AxisRenderable, name: string): string =>
  renderable.seriesColors[name] ?? FALLBACK_COLOR

const renderBar = ({ renderable, tooltipContent, onDatumClick }: InnerProps): ReactElement => {
  const isStacked = renderable.type === "stacked-bar"
  const isVertical = renderable.orientation === "vertical"
  const stackId = isStacked ? "stack" : undefined
  const onClick = buildDatumClickHandler(onDatumClick)
  const categoryTick = tickFormatterFor(renderable.xFormat)
  const valueTick = tickFormatterFor(renderable.yFormat)

  // Recharts scans direct chart children for axes; a fragment hides them, because
  // its bundled react-is 18 does not recognize React 19 fragment elements.
  return (
    <BarChart data={renderable.rows} layout={isVertical ? "vertical" : "horizontal"}>
      <CartesianGrid strokeDasharray="3 3" />
      {isVertical ? (
        <XAxis type="number" tickFormatter={valueTick} />
      ) : (
        <XAxis dataKey="x" tickFormatter={categoryTick} />
      )}
      {isVertical ? (
        <YAxis dataKey="x" type="category" tickFormatter={categoryTick} />
      ) : (
        <YAxis tickFormatter={valueTick} />
      )}
      <RechartsTooltip content={tooltipContent} />
      {renderable.seriesNames.length > 1 && <Legend />}
      {renderable.seriesNames.map((name) => (
        <Bar
          key={name}
          dataKey={name}
          stackId={stackId}
          fill={seriesColor(renderable, name)}
          onClick={onClick}
          cursor={onDatumClick ? "pointer" : undefined}
        >
          {renderable.rows.map((row, i) => (
            <Cell key={i} fill={row._colors[name] ?? FALLBACK_COLOR} />
          ))}
        </Bar>
      ))}
    </BarChart>
  )
}

const renderLine = ({ renderable, tooltipContent }: InnerProps): ReactElement => (
  <LineChart data={renderable.rows}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="x" tickFormatter={tickFormatterFor(renderable.xFormat)} />
    <YAxis tickFormatter={tickFormatterFor(renderable.yFormat)} />
    <RechartsTooltip content={tooltipContent} />
    {renderable.seriesNames.length > 1 && <Legend />}
    {renderable.seriesNames.map((name) => (
      <Line key={name} type="monotone" dataKey={name} stroke={seriesColor(renderable, name)} dot />
    ))}
  </LineChart>
)

const renderArea = ({ renderable, tooltipContent }: InnerProps): ReactElement => (
  <AreaChart data={renderable.rows}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="x" tickFormatter={tickFormatterFor(renderable.xFormat)} />
    <YAxis tickFormatter={tickFormatterFor(renderable.yFormat)} />
    <RechartsTooltip content={tooltipContent} />
    {renderable.seriesNames.length > 1 && <Legend />}
    {renderable.seriesNames.map((name) => (
      <Area
        key={name}
        type="monotone"
        dataKey={name}
        fill={seriesColor(renderable, name)}
        stroke={seriesColor(renderable, name)}
      />
    ))}
  </AreaChart>
)

const renderScatter = ({ renderable, tooltipContent, onDatumClick }: InnerProps): ReactElement => {
  const onClick = buildDatumClickHandler(onDatumClick)
  return (
    <ScatterChart>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="x" tickFormatter={tickFormatterFor(renderable.xFormat)} />
      <YAxis
        dataKey={renderable.seriesNames[0]}
        tickFormatter={tickFormatterFor(renderable.yFormat)}
      />
      <RechartsTooltip content={tooltipContent} />
      {renderable.seriesNames.map((name) => (
        <Scatter
          key={name}
          name={name}
          data={renderable.rows}
          fill={seriesColor(renderable, name)}
          onClick={onClick}
          cursor={onDatumClick ? "pointer" : undefined}
        />
      ))}
    </ScatterChart>
  )
}

const renderByType = (type: AxisChartType, inner: InnerProps): ReactElement => {
  switch (type) {
    case "bar":
    case "stacked-bar":
    case "grouped-bar":
      return renderBar(inner)
    case "line":
      return renderLine(inner)
    case "area":
      return renderArea(inner)
    case "scatter":
      return renderScatter(inner)
    default:
      return exhaustive(type)
  }
}

export const AxisChart = ({
  renderable,
  tooltipContext,
  onDatumClick,
  height = CHART_HEIGHT,
}: AxisChartProps) => {
  const tooltipContent = buildChartTooltipContent(tooltipContext)
  const inner: InnerProps = { renderable, tooltipContent, onDatumClick }

  return (
    <ResponsiveContainer width="100%" height={height}>
      {renderByType(renderable.type, inner)}
    </ResponsiveContainer>
  )
}
