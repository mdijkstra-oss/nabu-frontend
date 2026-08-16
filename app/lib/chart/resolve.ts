import { parseTemplate } from "./template"
import { toNumber as coerceNumber } from "./format"
import { resolveRowColor, type ColorContext } from "./color"
import { exhaustive } from "~/lib/utils/exhaustive"
import {
  bindingField,
  bindingFormat,
  bindingLabel,
  bindingScale,
  isAxisSpec,
  isMatrixSpec,
  isPartSpec,
  type AxisChartSpec,
  type AxisRenderable,
  type AxisRow,
  type AxisSide,
  type ChartBand,
  type ChartEntityMap,
  type ChartLayer,
  type ChartSpec,
  type Curve,
  type MatrixCell,
  type MatrixChartSpec,
  type MatrixRenderable,
  type PartChartSpec,
  type PartRenderable,
  type PartRow,
  type RenderableChart,
  type SeriesDescriptor,
  type TemplateNode,
  type XScale,
} from "./types"

export interface ResolveOptions {
  spec: ChartSpec
  rows: Record<string, unknown>[]
  entityMap: ChartEntityMap
  colorContext: ColorContext
}

const toKey = (value: unknown): string | number => {
  if (typeof value === "number") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

const toNumber = (value: unknown): number => coerceNumber(value) ?? 0

const toLabel = (value: unknown, entityMap: ChartEntityMap): string => {
  if (typeof value !== "string") return value === null || value === undefined ? "" : String(value)
  return entityMap[value]?.label ?? value
}

const findEntityUrl = (
  row: Record<string, unknown>,
  entityMap: ChartEntityMap
): string | undefined => {
  for (const value of Object.values(row)) {
    if (typeof value === "string") {
      const entity = entityMap[value]
      if (entity) return entity.url
    }
  }
  return undefined
}

const parseTooltip = (tooltip: string | undefined): TemplateNode[] | undefined =>
  tooltip ? parseTemplate(tooltip) : undefined

interface GroupedRows {
  key: string | number
  rows: Record<string, unknown>[]
}

// A category axis draws groups in the order the query returned them, which is the
// author's ordering and has to survive. A time axis draws them where their instant
// falls, so out-of-order rows would double the line back on itself.
const orderGroups = (groups: GroupedRows[], xScale: XScale): GroupedRows[] =>
  xScale === "time" ? [...groups].sort((a, b) => Number(a.key) - Number(b.key)) : groups

const groupRowsByX = (
  rows: Record<string, unknown>[],
  xField: string,
  xScale: XScale
): GroupedRows[] => {
  const result: GroupedRows[] = []
  const index = new Map<string | number, GroupedRows>()
  for (const row of rows) {
    const key = toKey(row[xField])
    const existing = index.get(key)
    if (existing) {
      existing.rows.push(row)
    } else {
      const group: GroupedRows = { key, rows: [row] }
      index.set(key, group)
      result.push(group)
    }
  }
  return orderGroups(result, xScale)
}

// A DATE column arrives from DuckDB as epoch milliseconds, while a band edge is
// written as a date string, so the two never match on identity. Both sides
// reduce to a number here, and the edge then snaps to a category the axis
// actually draws — Recharts drops a ReferenceArea whose bound is not one.
const toComparable = (value: string | number): number | null => {
  if (typeof value === "number") return value
  const asNumber = Number(value)
  if (value.trim() !== "" && !isNaN(asNumber)) return asNumber
  const time = Date.parse(value)
  return isNaN(time) ? null : time
}

const snapEdge = (
  edge: string | number,
  keys: (string | number)[],
  side: "from" | "to"
): string | number | undefined => {
  const exact = toKey(edge)
  if (keys.includes(exact)) return exact

  const target = toComparable(edge)
  if (target === null) return undefined

  let best: { key: string | number; value: number } | undefined
  for (const key of keys) {
    const value = toComparable(key)
    if (value === null) continue
    if (side === "from" ? value < target : value > target) continue
    if (!best || (side === "from" ? value < best.value : value > best.value)) {
      best = { key, value }
    }
  }
  return best?.key
}

const resolveBands = (bands: ChartBand[], keys: (string | number)[]): ChartBand[] =>
  bands.flatMap((band) => {
    const from = snapEdge(band.from, keys, "from")
    const to = snapEdge(band.to, keys, "to")
    if (from === undefined || to === undefined) return []
    if (keys.indexOf(from) > keys.indexOf(to)) return []
    return [{ ...band, from, to }]
  })

const layerStacks = (layer: ChartLayer): boolean =>
  (layer.mark === "bar" || layer.mark === "area") && layer.stack

const stackIdFor = (layer: ChartLayer): string | undefined =>
  layerStacks(layer) ? `${layer.mark}-${layer.axis}` : undefined

// Only line and area travel between points; a bar or a dot has nothing to curve.
const curveFor = (layer: ChartLayer): Curve =>
  layer.mark === "line" || layer.mark === "area" ? layer.curve : "linear"

const axisFormat = (layers: ChartLayer[], side: AxisSide): string | undefined => {
  for (const layer of layers) {
    if (layer.axis !== side) continue
    const format = bindingFormat(layer.y)
    if (format) return format
  }
  return undefined
}

const resolveAxis = (
  spec: AxisChartSpec,
  rows: Record<string, unknown>[],
  entityMap: ChartEntityMap,
  colorContext: ColorContext
): AxisRenderable => {
  const xField = bindingField(spec.x)
  const xScale = bindingScale(spec.x)
  const tooltipNodes = parseTooltip(spec.tooltip)
  const groups = groupRowsByX(rows, xField, xScale)

  const axisRows: AxisRow[] = groups.map(({ key, rows: groupRows }) => ({
    x: key,
    _raw: groupRows[0],
    _tooltipNodes: tooltipNodes,
    _colors: {},
    _entityUrl: findEntityUrl(groupRows[0], entityMap),
  }))

  const series: SeriesDescriptor[] = []

  spec.layers.forEach((layer, layerIndex) => {
    const yField = bindingField(layer.y)
    const seriesField = layer.series ? bindingField(layer.series) : undefined
    const colorNodes = parseTemplate(layer.color)
    const stackId = stackIdFor(layer)
    const curve = curveFor(layer)
    const layerDescriptors = new Map<string | number, SeriesDescriptor>()

    // Deduped by the series value, not its label: two entities sharing a
    // display name stay two series.
    const descriptorFor = (seriesValue: unknown): SeriesDescriptor => {
      const dedupeKey = seriesField ? toKey(seriesValue) : ""
      const existing = layerDescriptors.get(dedupeKey)
      if (existing) return existing
      const descriptor: SeriesDescriptor = {
        key: `l${layerIndex}s${layerDescriptors.size}`,
        name: seriesField ? toLabel(seriesValue, entityMap) : (bindingLabel(layer.y) ?? yField),
        mark: layer.mark,
        color: "",
        curve,
        stackId,
        axis: layer.axis,
      }
      layerDescriptors.set(dedupeKey, descriptor)
      series.push(descriptor)
      return descriptor
    }

    if (!seriesField) descriptorFor(undefined)

    groups.forEach(({ rows: groupRows }, groupIndex) => {
      const axisRow = axisRows[groupIndex]
      for (const sourceRow of groupRows) {
        const descriptor = descriptorFor(seriesField ? sourceRow[seriesField] : undefined)
        const current =
          typeof axisRow[descriptor.key] === "number" ? (axisRow[descriptor.key] as number) : 0
        axisRow[descriptor.key] = current + toNumber(sourceRow[yField])
        const color = resolveRowColor(colorNodes, sourceRow, colorContext)
        axisRow._colors[descriptor.key] = color
        if (!descriptor.color) descriptor.color = color
      }
    })
  })

  return {
    kind: "axis",
    orientation: spec.orientation,
    xScale,
    xFormat: bindingFormat(spec.x),
    leftAxisFormat: axisFormat(spec.layers, "left"),
    rightAxisFormat: axisFormat(spec.layers, "right"),
    series,
    rows: axisRows,
    bands: resolveBands(
      spec.bands ?? [],
      axisRows.map((row) => row.x)
    ),
  }
}

const resolvePart = (
  spec: PartChartSpec,
  rows: Record<string, unknown>[],
  entityMap: ChartEntityMap,
  colorContext: ColorContext
): PartRenderable => {
  const labelField = bindingField(spec.label)
  const valueField = bindingField(spec.value)
  const colorNodes = parseTemplate(spec.color)
  const tooltipNodes = parseTooltip(spec.tooltip)

  const partRows: PartRow[] = rows.map((row) => ({
    name: toLabel(row[labelField], entityMap),
    value: toNumber(row[valueField]),
    fill: resolveRowColor(colorNodes, row, colorContext),
    _raw: row,
    _tooltipNodes: tooltipNodes,
    _entityUrl: findEntityUrl(row, entityMap),
  }))

  return { kind: "part", type: spec.type, rows: partRows }
}

const resolveMatrix = (
  spec: MatrixChartSpec,
  rows: Record<string, unknown>[],
  entityMap: ChartEntityMap
): MatrixRenderable => {
  const xField = bindingField(spec.x)
  const yField = bindingField(spec.y)
  const valueField = bindingField(spec.value)
  const tooltipNodes = parseTooltip(spec.tooltip)

  const xKeys: (string | number)[] = []
  const yKeys: (string | number)[] = []
  const cells = new Map<string | number, Map<string | number, MatrixCell>>()
  let min: number | undefined
  let max: number | undefined

  for (const row of rows) {
    const xKey = toKey(row[xField])
    const yKey = toKey(row[yField])
    let column = cells.get(xKey)
    if (!column) {
      column = new Map()
      cells.set(xKey, column)
      xKeys.push(xKey)
    }
    if (!yKeys.includes(yKey)) yKeys.push(yKey)

    const existing = column.get(yKey)
    if (existing) {
      existing.value += toNumber(row[valueField])
    } else {
      column.set(yKey, {
        value: toNumber(row[valueField]),
        _raw: row,
        _tooltipNodes: tooltipNodes,
        _entityUrl: findEntityUrl(row, entityMap),
      })
    }
  }

  for (const column of cells.values()) {
    for (const cell of column.values()) {
      if (min === undefined || cell.value < min) min = cell.value
      if (max === undefined || cell.value > max) max = cell.value
    }
  }

  return {
    kind: "matrix",
    xKeys,
    yKeys,
    cells,
    min,
    max,
    colorToken: spec.color,
    xFormat: bindingFormat(spec.x),
    yFormat: bindingFormat(spec.y),
    valueFormat: bindingFormat(spec.value),
  }
}

export const resolveChartData = (options: ResolveOptions): RenderableChart => {
  const { spec, rows, entityMap, colorContext } = options
  if (isAxisSpec(spec)) return resolveAxis(spec, rows, entityMap, colorContext)
  if (isPartSpec(spec)) return resolvePart(spec, rows, entityMap, colorContext)
  if (isMatrixSpec(spec)) return resolveMatrix(spec, rows, entityMap)
  return exhaustive(spec)
}
