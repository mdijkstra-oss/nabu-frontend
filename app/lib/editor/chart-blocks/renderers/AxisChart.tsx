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
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { formatValue } from "~/lib/chart/format"
import type { AxisChartType, AxisRenderable, ChartBand } from "~/lib/chart/types"
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
  CHART_STACK_ID,
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

interface InnerProps {
  renderable: AxisRenderable
  tooltipContent: RechartsTooltipContent
  onDatumClick?: (url: string) => void
}

const tickFormatterFor = (format: string | undefined): ((value: unknown) => string) =>
  format ? (value) => formatValue(value, format) : (value) => String(value ?? "")

const seriesColor = (renderable: AxisRenderable, name: string): string =>
  renderable.seriesColors[name] ?? FALLBACK_COLOR

const renderBands = (bands: ChartBand[]): ReactElement[] =>
  bands.map((band) => (
    <ReferenceArea
      key={`${band.from}-${band.to}`}
      x1={band.from}
      x2={band.to}
      label={{ value: band.label, position: "top" }}
    />
  ))

const barRadius = (isStacked: boolean, isVertical: boolean): [number, number, number, number] => {
  if (isStacked) return [0, 0, 0, 0]
  const r = CHART_BAR_RADIUS
  return isVertical ? [0, r, r, 0] : [r, r, 0, 0]
}

const renderLegend = (seriesNames: string[]): ReactElement | null =>
  seriesNames.length > 1 ? <Legend content={<ChartLegend />} /> : null

const renderBar = ({ renderable, tooltipContent, onDatumClick }: InnerProps): ReactElement => {
  const isStacked = renderable.type === "stacked-bar"
  const isVertical = renderable.orientation === "vertical"
  const stackId = isStacked ? CHART_STACK_ID : undefined
  const onClick = buildDatumClickHandler(onDatumClick)
  const categoryTick = tickFormatterFor(renderable.xFormat)
  const valueTick = tickFormatterFor(renderable.yFormat)

  // Recharts scans direct chart children for axes; a fragment hides them, because
  // its bundled react-is 18 does not recognize React 19 fragment elements.
  return (
    <BarChart
      data={renderable.rows}
      layout={isVertical ? "vertical" : "horizontal"}
      margin={CHART_MARGIN}
    >
      <CartesianGrid vertical={isVertical} horizontal={!isVertical} />
      {renderBands(renderable.bands)}
      {isVertical ? (
        <XAxis type="number" tickFormatter={valueTick} axisLine={false} tickLine={false} />
      ) : (
        <XAxis dataKey="x" tickFormatter={categoryTick} axisLine={false} tickLine={false} />
      )}
      {isVertical ? (
        <YAxis
          dataKey="x"
          type="category"
          tickFormatter={categoryTick}
          axisLine={false}
          tickLine={false}
        />
      ) : (
        <YAxis tickFormatter={valueTick} axisLine={false} tickLine={false} />
      )}
      <RechartsTooltip content={tooltipContent} />
      {renderLegend(renderable.seriesNames)}
      {renderable.seriesNames.map((name) => (
        <Bar
          key={name}
          dataKey={name}
          stackId={stackId}
          className={isStacked ? STACKED_BAR_CLASS : undefined}
          radius={barRadius(isStacked, isVertical)}
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
  <LineChart data={renderable.rows} margin={CHART_MARGIN}>
    <CartesianGrid vertical={false} />
    {renderBands(renderable.bands)}
    <XAxis
      dataKey="x"
      tickFormatter={tickFormatterFor(renderable.xFormat)}
      axisLine={false}
      tickLine={false}
    />
    <YAxis tickFormatter={tickFormatterFor(renderable.yFormat)} axisLine={false} tickLine={false} />
    <RechartsTooltip content={tooltipContent} />
    {renderLegend(renderable.seriesNames)}
    {renderable.seriesNames.map((name) => (
      <Line
        key={name}
        type="monotone"
        dataKey={name}
        stroke={seriesColor(renderable, name)}
        strokeWidth={CHART_LINE_WIDTH}
        dot={{ r: CHART_DOT_RADIUS, fill: seriesColor(renderable, name) }}
      />
    ))}
  </LineChart>
)

const renderArea = ({ renderable, tooltipContent }: InnerProps): ReactElement => (
  <AreaChart data={renderable.rows} margin={CHART_MARGIN}>
    <CartesianGrid vertical={false} />
    {renderBands(renderable.bands)}
    <XAxis
      dataKey="x"
      tickFormatter={tickFormatterFor(renderable.xFormat)}
      axisLine={false}
      tickLine={false}
    />
    <YAxis tickFormatter={tickFormatterFor(renderable.yFormat)} axisLine={false} tickLine={false} />
    <RechartsTooltip content={tooltipContent} />
    {renderLegend(renderable.seriesNames)}
    {renderable.seriesNames.map((name) => (
      <Area
        key={name}
        type="monotone"
        dataKey={name}
        stackId={CHART_STACK_ID}
        fill={seriesColor(renderable, name)}
        fillOpacity={CHART_AREA_FILL_OPACITY}
        stroke={seriesColor(renderable, name)}
        strokeWidth={CHART_LINE_WIDTH}
      />
    ))}
  </AreaChart>
)

const renderScatter = ({ renderable, tooltipContent, onDatumClick }: InnerProps): ReactElement => {
  const onClick = buildDatumClickHandler(onDatumClick)
  return (
    <ScatterChart margin={CHART_MARGIN}>
      <CartesianGrid />
      {renderBands(renderable.bands)}
      <XAxis
        dataKey="x"
        tickFormatter={tickFormatterFor(renderable.xFormat)}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        dataKey={renderable.seriesNames[0]}
        tickFormatter={tickFormatterFor(renderable.yFormat)}
        axisLine={false}
        tickLine={false}
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
    <ResponsiveContainer className="nabu-chart" width="100%" height={height}>
      {renderByType(renderable.type, inner)}
    </ResponsiveContainer>
  )
}
