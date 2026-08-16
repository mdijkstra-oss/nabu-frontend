import type { z } from "zod"
// Type-only edge: schema.ts value-imports from template.ts, which value-imports
// from this file, so this import must never become a runtime one.
import type {
  AxisChartSpecSchema,
  ChartLayerSchema,
  ChartSpecSchema,
} from "~/domain/data-blocks/chart/schema"

export type ChartSpec = z.infer<typeof ChartSpecSchema>
export type AxisChartSpec = z.infer<typeof AxisChartSpecSchema>
export type ChartLayer = z.infer<typeof ChartLayerSchema>
export type PartChartSpec = Extract<ChartSpec, { type: "pie" | "treemap" }>
export type MatrixChartSpec = Extract<ChartSpec, { type: "heatmap" }>

export type LayerMark = ChartLayer["mark"]
export type Orientation = AxisChartSpec["orientation"]
export type AxisSide = ChartLayer["axis"]
export type FieldBinding = ChartLayer["y"]
export type AxisXBinding = AxisChartSpec["x"]
export type XScale = "category" | "time"
export type Curve = "linear" | "step" | "monotone"
export type ChartBand = NonNullable<AxisChartSpec["bands"]>[number]

export interface TemplateLiteralNode {
  type: "literal"
  value: string
}

export type TemplateRefOp =
  | { kind: "raw" }
  | { kind: "format"; format: string }
  | { kind: "property"; property: "color" | "name" | "label" }

export interface TemplateRefNode {
  type: "ref"
  field: string
  op: TemplateRefOp
}

export type TemplateNode = TemplateLiteralNode | TemplateRefNode

export interface ChartEntityInfo {
  id: string
  label: string
  url: string
  color: string
}

export type ChartEntityMap = Record<string, ChartEntityInfo>

export interface SeriesDescriptor {
  key: string
  name: string
  mark: LayerMark
  color: string
  curve: Curve
  stackId?: string
  axis: AxisSide
}

export interface AxisRow {
  x: string | number
  _raw: Record<string, unknown>
  _tooltipNodes?: TemplateNode[]
  _colors: Record<string, string>
  _entityUrl?: string
  [seriesKey: string]: unknown
}

export interface AxisRenderable {
  kind: "axis"
  orientation: Orientation
  xScale: XScale
  xFormat?: string
  leftAxisFormat?: string
  rightAxisFormat?: string
  series: SeriesDescriptor[]
  rows: AxisRow[]
  bands: ChartBand[]
}

export interface PartRow {
  name: string
  value: number
  fill: string
  _raw: Record<string, unknown>
  _tooltipNodes?: TemplateNode[]
  _entityUrl?: string
}

export interface PartRenderable {
  kind: "part"
  type: "pie" | "treemap"
  rows: PartRow[]
}

export interface MatrixCell {
  value: number
  _raw: Record<string, unknown>
  _tooltipNodes?: TemplateNode[]
  _entityUrl?: string
}

export interface MatrixRenderable {
  kind: "matrix"
  xKeys: (string | number)[]
  yKeys: (string | number)[]
  cells: Map<string | number, Map<string | number, MatrixCell>>
  min?: number
  max?: number
  colorToken: string
  xFormat?: string
  yFormat?: string
  valueFormat?: string
}

export type RenderableChart = AxisRenderable | PartRenderable | MatrixRenderable

export const bindingField = (binding: FieldBinding | AxisXBinding): string =>
  typeof binding === "string" ? binding : binding.field

export const bindingFormat = (
  binding: FieldBinding | AxisXBinding | undefined
): string | undefined => {
  if (binding === undefined) return undefined
  return typeof binding === "string" ? undefined : binding.format
}

export const bindingLabel = (binding: FieldBinding): string | undefined =>
  typeof binding === "string" ? undefined : binding.label

// The string shorthand carries no scale, and a name axis is what it means.
export const bindingScale = (binding: AxisXBinding): XScale =>
  typeof binding === "string" ? "category" : binding.scale

export const isAxisSpec = (spec: ChartSpec): spec is AxisChartSpec => spec.type === "axis"

export const isPartSpec = (spec: ChartSpec): spec is PartChartSpec =>
  spec.type === "pie" || spec.type === "treemap"

export const isMatrixSpec = (spec: ChartSpec): spec is MatrixChartSpec => spec.type === "heatmap"
