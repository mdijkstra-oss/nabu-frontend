"use client"

import { useState } from "react"
import Markdown from "react-markdown"
import { formatValue } from "~/lib/chart/format"
import { radixVar } from "~/ui/theme/radix"
import type { MatrixCell, MatrixRenderable } from "~/lib/chart/types"
import { allowFileProtocol } from "~/ui/components/nabu/MessageContent"
import { createEntityLinkComponents } from "~/ui/components/markdown/createEntityLinkComponents"
import { ChartTooltip, type ChartTooltipContext } from "./ChartTooltip"
import { CHART_COLOR_SHADE } from "~/lib/chart/color"
import { CHART_HEIGHT, HEATMAP_MIN_CELL, buildDatumClickHandler } from "./shared"

interface HeatmapProps {
  renderable: MatrixRenderable
  tooltipContext: ChartTooltipContext
  onDatumClick?: (url: string) => void
  height?: number
}

interface HoveredCell {
  xKey: string | number
  yKey: string | number
  cell: MatrixCell
  left: number
  top: number
}

const RAMP_FLOOR = 3
// The hottest cell paints at the same shade every other chart's marks use.
const RAMP_CEILING = CHART_COLOR_SHADE
// Shades up to 7 are tints readable under the token's darkest text step;
// 8-9 are solids that need the lightest.
const DARK_TEXT_MAX_SHADE = 7

const rampShade = (value: number, min: number, max: number): number => {
  if (min === max) return RAMP_CEILING
  const span = RAMP_CEILING - RAMP_FLOOR
  return RAMP_FLOOR + Math.round(((value - min) / (max - min)) * span)
}

const cellColors = (token: string, shade: number): { background: string; color: string } => ({
  background: radixVar(token, shade),
  color: radixVar(token, shade <= DARK_TEXT_MAX_SHADE ? 12 : 1),
})

const formatPlainValue = (value: string | number, format: string | undefined): string =>
  format ? formatValue(value, format) : String(value)

const resolveAxisLabel = (
  key: string | number,
  format: string | undefined,
  context: ChartTooltipContext
): string => {
  if (typeof key === "string" && context.entityMap[key]) return context.entityMap[key].label
  return formatPlainValue(key, format)
}

const AxisLabel = ({
  value,
  format,
  context,
}: {
  value: string | number
  format: string | undefined
  context: ChartTooltipContext
}) => {
  const entity = typeof value === "string" ? context.entityMap[value] : undefined
  if (!entity) {
    return <span>{formatPlainValue(value, format)}</span>
  }
  const components = createEntityLinkComponents({
    files: context.files,
    projectId: context.projectId,
    navigate: context.navigate,
  })
  return (
    <Markdown components={components} urlTransform={allowFileProtocol}>
      {`[${entity.label}](file://${entity.id})`}
    </Markdown>
  )
}

export const Heatmap = ({
  renderable,
  tooltipContext,
  onDatumClick,
  height = CHART_HEIGHT,
}: HeatmapProps) => {
  const [hovered, setHovered] = useState<HoveredCell | null>(null)
  const { xKeys, yKeys, cells, min, max, colorToken } = renderable
  const onClick = buildDatumClickHandler(onDatumClick)

  const handleEnter = (
    event: React.MouseEvent<HTMLDivElement>,
    xKey: string | number,
    yKey: string | number,
    cell: MatrixCell
  ) => {
    const target = event.currentTarget
    setHovered({
      xKey,
      yKey,
      cell,
      left: target.offsetLeft + target.offsetWidth / 2,
      top: target.offsetTop + target.offsetHeight,
    })
  }

  return (
    <div className="nabu-chart-heatmap relative" style={{ height }}>
      <div className="nabu-chart-heatmap-scroll">
        <div
          className="nabu-chart-heatmap-grid"
          style={{
            gridTemplateColumns: `auto repeat(${xKeys.length}, minmax(${HEATMAP_MIN_CELL}px, 1fr))`,
            gridAutoRows: `minmax(${HEATMAP_MIN_CELL}px, auto)`,
          }}
        >
          <div className="nabu-chart-heatmap-corner" />
          {xKeys.map((xKey) => (
            <div key={String(xKey)} className="nabu-chart-heatmap-col-label">
              <AxisLabel value={xKey} format={renderable.xFormat} context={tooltipContext} />
            </div>
          ))}
          {yKeys.map((yKey) => [
            <div key={`label-${String(yKey)}`} className="nabu-chart-heatmap-row-label">
              <AxisLabel value={yKey} format={renderable.yFormat} context={tooltipContext} />
            </div>,
            ...xKeys.map((xKey) => {
              const cell = cells.get(xKey)?.get(yKey)
              if (!cell || min === undefined || max === undefined) {
                return (
                  <div
                    key={`${String(xKey)}-${String(yKey)}`}
                    className="nabu-chart-heatmap-cell nabu-chart-heatmap-cell-empty"
                  />
                )
              }
              const clickable = onDatumClick && cell._entityUrl
              return (
                <div
                  key={`${String(xKey)}-${String(yKey)}`}
                  className="nabu-chart-heatmap-cell"
                  style={{
                    ...cellColors(colorToken, rampShade(cell.value, min, max)),
                    cursor: clickable ? "pointer" : undefined,
                  }}
                  onMouseEnter={(event) => handleEnter(event, xKey, yKey, cell)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onClick?.(cell)}
                >
                  {formatPlainValue(cell.value, renderable.valueFormat)}
                </div>
              )
            }),
          ])}
        </div>
        {hovered && (
          <div
            className="nabu-chart-heatmap-tooltip"
            style={{ left: hovered.left, top: hovered.top }}
          >
            <ChartTooltip
              context={tooltipContext}
              active
              label={resolveAxisLabel(hovered.xKey, renderable.xFormat, tooltipContext)}
              payload={[
                {
                  name: resolveAxisLabel(hovered.yKey, renderable.yFormat, tooltipContext),
                  value: formatPlainValue(hovered.cell.value, renderable.valueFormat),
                  payload: {
                    _raw: hovered.cell._raw,
                    _tooltipNodes: hovered.cell._tooltipNodes,
                  },
                },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  )
}
