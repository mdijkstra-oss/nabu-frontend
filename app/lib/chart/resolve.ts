import { parseTemplate } from "./template"
import { resolveRowColor, type ColorContext } from "./color"
import { exhaustive } from "~/lib/utils/exhaustive"
import {
  bindingField,
  bindingFormat,
  isAxisSpec,
  isMatrixSpec,
  isPartSpec,
  type AxisChartSpec,
  type AxisRenderable,
  type AxisRow,
  type ChartEntityMap,
  type ChartSpec,
  type MatrixChartSpec,
  type MatrixRenderable,
  type PartChartSpec,
  type PartRenderable,
  type PartRow,
  type RenderableChart,
  type TemplateNode,
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

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return value
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string") {
    const n = Number(value)
    return isNaN(n) ? 0 : n
  }
  return 0
}

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

const groupRowsByX = (rows: Record<string, unknown>[], xField: string): GroupedRows[] => {
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
  return result
}

const seriesNameFor = (
  row: Record<string, unknown>,
  seriesField: string | undefined,
  fallback: string,
  entityMap: ChartEntityMap
): string => (seriesField ? toLabel(row[seriesField], entityMap) : fallback)

const resolveAxis = (
  spec: AxisChartSpec,
  rows: Record<string, unknown>[],
  entityMap: ChartEntityMap,
  colorContext: ColorContext
): AxisRenderable => {
  const xField = bindingField(spec.x)
  const yField = bindingField(spec.y)
  const seriesField = spec.series ? bindingField(spec.series) : undefined
  const defaultSeriesName = typeof spec.y === "string" ? yField : (spec.y.label ?? yField)
  const colorNodes = parseTemplate(spec.color)
  const tooltipNodes = parseTooltip(spec.tooltip)

  const seriesNameSet = new Set<string>()
  const seriesColors: Record<string, string> = {}
  const groups = groupRowsByX(rows, xField)

  const axisRows: AxisRow[] = groups.map(({ key, rows: groupRows }) => {
    const colors: Record<string, string> = {}
    const row: AxisRow = {
      x: key,
      _raw: groupRows[0],
      _tooltipNodes: tooltipNodes,
      _colors: colors,
      _entityUrl: findEntityUrl(groupRows[0], entityMap),
    }
    for (const sourceRow of groupRows) {
      const seriesName = seriesNameFor(sourceRow, seriesField, defaultSeriesName, entityMap)
      seriesNameSet.add(seriesName)
      const current = typeof row[seriesName] === "number" ? (row[seriesName] as number) : 0
      row[seriesName] = current + toNumber(sourceRow[yField])
      const color = resolveRowColor(colorNodes, sourceRow, colorContext)
      colors[seriesName] = color
      if (!(seriesName in seriesColors)) seriesColors[seriesName] = color
    }
    return row
  })

  return {
    kind: "axis",
    type: spec.type,
    orientation: spec.orientation ?? "horizontal",
    xFormat: bindingFormat(spec.x),
    yFormat: bindingFormat(spec.y),
    seriesNames: [...seriesNameSet],
    seriesColors,
    rows: axisRows,
    bands: spec.bands ?? [],
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
  const parentField = spec.parent ? bindingField(spec.parent) : undefined
  const colorNodes = parseTemplate(spec.color)
  const tooltipNodes = parseTooltip(spec.tooltip)

  const partRows: PartRow[] = rows.map((row) => ({
    name: toLabel(row[labelField], entityMap),
    value: toNumber(row[valueField]),
    fill: resolveRowColor(colorNodes, row, colorContext),
    _raw: row,
    _tooltipNodes: tooltipNodes,
    _entityUrl: findEntityUrl(row, entityMap),
    _parent: parentField ? toLabel(row[parentField], entityMap) : undefined,
  }))

  return { kind: "part", type: spec.type, rows: partRows }
}

const resolveMatrix = (_spec: MatrixChartSpec): MatrixRenderable => ({
  kind: "matrix",
  type: "heatmap",
})

export const resolveChartData = (options: ResolveOptions): RenderableChart => {
  const { spec, rows, entityMap, colorContext } = options
  if (isAxisSpec(spec)) return resolveAxis(spec, rows, entityMap, colorContext)
  if (isPartSpec(spec)) return resolvePart(spec, rows, entityMap, colorContext)
  if (isMatrixSpec(spec)) return resolveMatrix(spec)
  return exhaustive(spec)
}
