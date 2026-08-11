import type { ComponentType } from "react"

export type ChartType =
  | "bar"
  | "stacked-bar"
  | "grouped-bar"
  | "line"
  | "area"
  | "scatter"
  | "pie"
  | "treemap"
  | "heatmap"

export type AxisChartType = "bar" | "stacked-bar" | "grouped-bar" | "line" | "area" | "scatter"

export type Orientation = "horizontal" | "vertical"

export interface FieldBindingObject {
  field: string
  label?: string
  format?: string
}

export type FieldBinding = string | FieldBindingObject

export interface ChartBand {
  from: string | number
  to: string | number
  label?: string
}

export interface AxisChartSpec {
  type: AxisChartType
  x: FieldBinding
  y: FieldBinding
  series?: FieldBinding
  orientation?: Orientation
  color: string
  tooltip?: string
  bands?: ChartBand[]
}

export interface PartChartSpec {
  type: "pie" | "treemap"
  label: FieldBinding
  value: FieldBinding
  parent?: FieldBinding
  color: string
  tooltip?: string
}

export interface MatrixChartSpec {
  type: "heatmap"
  x: FieldBinding
  y: FieldBinding
  value: FieldBinding
  color: string
  tooltip?: string
}

export type ChartSpec = AxisChartSpec | PartChartSpec | MatrixChartSpec

export interface TemplateLiteralNode {
  type: "literal"
  value: string
}

export type TemplateRefOp =
  | { kind: "raw" }
  | { kind: "format"; format: string }
  | { kind: "property"; property: "color" | "name" | "label" | "icon" }

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
  icon?: ComponentType<{ className?: string }>
}

export type ChartEntityMap = Record<string, ChartEntityInfo>

export interface AxisRow {
  x: string | number
  _raw: Record<string, unknown>
  _tooltipNodes?: TemplateNode[]
  _colors: Record<string, string>
  _entityUrl?: string
  [seriesName: string]: unknown
}

export interface PartRow {
  name: string
  value: number
  fill: string
  _raw: Record<string, unknown>
  _tooltipNodes?: TemplateNode[]
  _entityUrl?: string
  _parent?: string
}

export interface AxisRenderable {
  kind: "axis"
  type: AxisChartType
  orientation: Orientation
  xFormat?: string
  yFormat?: string
  seriesNames: string[]
  seriesColors: Record<string, string>
  rows: AxisRow[]
  bands: ChartBand[]
}

export interface PartRenderable {
  kind: "part"
  type: "pie" | "treemap"
  rows: PartRow[]
}

export interface MatrixRenderable {
  kind: "matrix"
  type: "heatmap"
}

export type RenderableChart = AxisRenderable | PartRenderable | MatrixRenderable

export const bindingField = (binding: FieldBinding): string =>
  typeof binding === "string" ? binding : binding.field

export const bindingFormat = (binding: FieldBinding | undefined): string | undefined => {
  if (binding === undefined) return undefined
  return typeof binding === "string" ? undefined : binding.format
}

export const isAxisSpec = (spec: ChartSpec): spec is AxisChartSpec =>
  spec.type === "bar" ||
  spec.type === "stacked-bar" ||
  spec.type === "grouped-bar" ||
  spec.type === "line" ||
  spec.type === "area" ||
  spec.type === "scatter"

export const isPartSpec = (spec: ChartSpec): spec is PartChartSpec =>
  spec.type === "pie" || spec.type === "treemap"

export const isMatrixSpec = (spec: ChartSpec): spec is MatrixChartSpec => spec.type === "heatmap"
