import type { ChartTooltipContext } from "~/lib/editor/chart-blocks/renderers/ChartTooltip"
import { CHART_COLOR_SHADE, FALLBACK_COLOR, type ColorContext } from "./color"
import { resolveChartData } from "./resolve"
import type { ChartSpec, ChartType, RenderableChart, TemplateNode } from "./types"
import type { ChartEntityMap } from "./types"

const SAMPLE_SERIES_COLOR = "#4f46e5"

export const entity = (id: string, label: string, color: string): ChartEntityMap[string] => ({
  id,
  label,
  url: `/${id}`,
  color,
})

export const stubResolveRadix = (token: string, shade: number): string => `radix(${token},${shade})`

export const buildColorContext = (entityMap: ChartEntityMap = {}): ColorContext => ({
  entityMap,
  resolveRadix: stubResolveRadix,
  shade: CHART_COLOR_SHADE,
  fallback: FALLBACK_COLOR,
})

const regionEntities: ChartEntityMap = {
  north: entity("north", "North", SAMPLE_SERIES_COLOR),
  south: entity("south", "South", "#0d9488"),
}

const monthlyRows = [
  { month: "Jan", count: 12, region: "north" },
  { month: "Jan", count: 7, region: "south" },
  { month: "Feb", count: 9, region: "north" },
  { month: "Feb", count: 14, region: "south" },
  { month: "Mar", count: 6, region: "north" },
  { month: "Mar", count: 10, region: "south" },
]

const shareRows = [
  { region: "north", total: 24 },
  { region: "south", total: 31 },
]

interface ChartFixtureSource {
  spec: ChartSpec
  rows: Record<string, unknown>[]
}

const fixtureSources: Record<ChartType, ChartFixtureSource> = {
  bar: {
    spec: { type: "bar", x: "month", y: "count", color: SAMPLE_SERIES_COLOR },
    rows: monthlyRows,
  },
  "stacked-bar": {
    spec: {
      type: "stacked-bar",
      x: "month",
      y: "count",
      series: "region",
      color: "{region:color}",
    },
    rows: monthlyRows,
  },
  "grouped-bar": {
    spec: {
      type: "grouped-bar",
      x: "month",
      y: "count",
      series: "region",
      color: "{region:color}",
    },
    rows: monthlyRows,
  },
  line: {
    spec: { type: "line", x: "month", y: "count", series: "region", color: "{region:color}" },
    rows: monthlyRows,
  },
  area: {
    spec: { type: "area", x: "month", y: "count", series: "region", color: "{region:color}" },
    rows: monthlyRows,
  },
  scatter: {
    spec: { type: "scatter", x: "month", y: "count", color: SAMPLE_SERIES_COLOR },
    rows: monthlyRows,
  },
  pie: {
    spec: { type: "pie", label: "region", value: "total", color: "{region:color}" },
    rows: shareRows,
  },
  treemap: {
    spec: { type: "treemap", label: "region", value: "total", color: "{region:color}" },
    rows: shareRows,
  },
  heatmap: {
    spec: { type: "heatmap", x: "month", y: "region", value: "count", color: SAMPLE_SERIES_COLOR },
    rows: monthlyRows,
  },
}

export const allChartTypes = Object.keys(fixtureSources) as ChartType[]

export interface ChartFixture {
  spec: ChartSpec
  rows: Record<string, unknown>[]
  renderable: RenderableChart
}

export const chartFixture = (type: ChartType): ChartFixture => {
  const { spec, rows } = fixtureSources[type]
  return {
    spec,
    rows,
    renderable: resolveChartData({
      spec,
      rows,
      entityMap: regionEntities,
      colorContext: buildColorContext(regionEntities),
    }),
  }
}

export const renderableOfKind = <K extends RenderableChart["kind"]>(
  type: ChartType,
  kind: K
): Extract<RenderableChart, { kind: K }> => {
  const { renderable } = chartFixture(type)
  if (renderable.kind !== kind) {
    throw new Error(`${type} fixture resolved to a non-${kind} renderable`)
  }
  return renderable as Extract<RenderableChart, { kind: K }>
}

export const sampleTooltipContext = (entityMap: ChartEntityMap = {}): ChartTooltipContext => ({
  files: {},
  projectId: null,
  entityMap,
})

export interface SampleTooltipPayloadItem {
  name?: string
  value?: number | string
  color?: string
  payload?: {
    _raw: Record<string, unknown>
    _tooltipNodes?: TemplateNode[]
  }
}

export const sampleTooltipPayload = (
  overrides: Partial<SampleTooltipPayloadItem> = {}
): SampleTooltipPayloadItem[] => [
  {
    name: "count",
    value: 12,
    color: SAMPLE_SERIES_COLOR,
    payload: { _raw: { month: "Jan", count: 12 } },
    ...overrides,
  },
]
