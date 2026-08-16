import type {
  ChartTooltipContext,
  RechartsPayloadItem,
} from "~/lib/editor/chart-blocks/renderers/ChartTooltip"
import { CHART_COLOR_SHADE, FALLBACK_COLOR, type ColorContext } from "./color"
import type {
  AxisRenderable,
  ChartEntityMap,
  ChartSpec,
  MatrixCell,
  MatrixRenderable,
  PartRenderable,
  RenderableChart,
} from "./types"

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

export const regionEntities: ChartEntityMap = {
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

const wideRows = [
  { month: "Jan", count: 19, ratio: 0.4 },
  { month: "Feb", count: 23, ratio: 0.5 },
  { month: "Mar", count: 16, ratio: 0.7 },
]

const cooccurrenceRows = [
  { code: "grief", document: "interview-1", n: 3 },
  { code: "grief", document: "interview-2", n: 0 },
  { code: "grief", document: "interview-3", n: 5 },
  { code: "hope", document: "interview-1", n: 1 },
  { code: "hope", document: "interview-2", n: 4 },
  { code: "hope", document: "interview-3", n: 2 },
]

export interface ChartFixture {
  spec: ChartSpec
  rows: Record<string, unknown>[]
}

const fixtures = {
  bar: {
    spec: {
      type: "axis",
      x: "month",
      orientation: "vertical",
      layers: [{ mark: "bar", y: "count", color: "indigo", stack: false, axis: "left" }],
    },
    rows: monthlyRows,
  },
  line: {
    spec: {
      type: "axis",
      x: "month",
      orientation: "vertical",
      layers: [
        {
          mark: "line",
          curve: "linear",
          y: "count",
          series: "region",
          color: "{region:color}",
          axis: "left",
        },
      ],
    },
    rows: monthlyRows,
  },
  area: {
    spec: {
      type: "axis",
      x: "month",
      orientation: "vertical",
      layers: [
        {
          mark: "area",
          curve: "linear",
          y: "count",
          series: "region",
          color: "{region:color}",
          stack: true,
          axis: "left",
        },
      ],
    },
    rows: monthlyRows,
  },
  scatter: {
    spec: {
      type: "axis",
      x: "month",
      orientation: "vertical",
      layers: [{ mark: "scatter", y: "count", color: "indigo", axis: "left" }],
    },
    rows: monthlyRows,
  },
  stacked: {
    spec: {
      type: "axis",
      x: "month",
      orientation: "vertical",
      layers: [
        {
          mark: "bar",
          y: "count",
          series: "region",
          color: "{region:color}",
          stack: true,
          axis: "left",
        },
      ],
    },
    rows: monthlyRows,
  },
  grouped: {
    spec: {
      type: "axis",
      x: "month",
      orientation: "vertical",
      layers: [
        {
          mark: "bar",
          y: "count",
          series: "region",
          color: "{region:color}",
          stack: false,
          axis: "left",
        },
      ],
    },
    rows: monthlyRows,
  },
  "wide-stacked": {
    spec: {
      type: "axis",
      x: "month",
      orientation: "vertical",
      layers: [
        { mark: "bar", y: "count", color: "blue", stack: true, axis: "left" },
        { mark: "bar", y: "ratio", color: "amber", stack: true, axis: "left" },
      ],
    },
    rows: wideRows,
  },
  horizontal: {
    spec: {
      type: "axis",
      x: "month",
      orientation: "horizontal",
      layers: [{ mark: "bar", y: "count", color: "indigo", stack: false, axis: "left" }],
    },
    rows: monthlyRows,
  },
  banded: {
    spec: {
      type: "axis",
      x: "month",
      orientation: "vertical",
      layers: [
        {
          mark: "bar",
          y: "count",
          series: "region",
          color: "{region:color}",
          stack: true,
          axis: "left",
        },
      ],
      bands: [{ from: "Feb", to: "Mar", label: "Polar night" }],
    },
    rows: monthlyRows,
  },
  combo: {
    spec: {
      type: "axis",
      x: "month",
      orientation: "vertical",
      layers: [
        { mark: "bar", y: "count", color: "blue", stack: false, axis: "left" },
        { mark: "line", curve: "linear", y: "ratio", color: "amber", axis: "right" },
      ],
    },
    rows: wideRows,
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
    spec: { type: "heatmap", x: "document", y: "code", value: "n", color: "blue" },
    rows: cooccurrenceRows,
  },
} satisfies Record<string, ChartFixture>

export type ChartFixtureName = keyof typeof fixtures

export const allChartFixtureNames = Object.keys(fixtures) as ChartFixtureName[]

export const chartFixture = (name: ChartFixtureName): ChartFixture => fixtures[name]

const axisRows = (key: string, values: Record<string, number>, color: string) =>
  Object.entries(values).map(([x, value]) => ({
    x,
    _raw: { month: x },
    _colors: { [key]: color },
    [key]: value,
  }))

const singleSeriesAxisRenderable = (
  mark: "bar" | "line" | "area" | "scatter",
  stackId?: string
): AxisRenderable => ({
  kind: "axis",
  orientation: "vertical",
  xScale: "category",
  series: [
    {
      key: "l0s0",
      name: "count",
      mark,
      color: SAMPLE_SERIES_COLOR,
      curve: "linear",
      stackId,
      axis: "left",
    },
  ],
  rows: axisRows("l0s0", { Jan: 19, Feb: 23, Mar: 16 }, SAMPLE_SERIES_COLOR),
  bands: [],
})

const partRenderable = (type: "pie" | "treemap"): PartRenderable => ({
  kind: "part",
  type,
  rows: shareRows.map((row) => ({
    name: regionEntities[row.region].label,
    value: row.total,
    fill: regionEntities[row.region].color,
    _raw: row,
    _entityUrl: `/${row.region}`,
  })),
})

export const matrixRenderable = (overrides: Partial<MatrixRenderable> = {}): MatrixRenderable => {
  const cell = (value: number, row: Record<string, unknown>): MatrixCell => ({ value, _raw: row })
  const cells = new Map<string | number, Map<string | number, MatrixCell>>([
    [
      "interview-1",
      new Map<string | number, MatrixCell>([
        ["grief", cell(3, cooccurrenceRows[0])],
        ["hope", cell(1, cooccurrenceRows[3])],
      ]),
    ],
    [
      "interview-2",
      new Map<string | number, MatrixCell>([
        ["grief", cell(0, cooccurrenceRows[1])],
        ["hope", cell(4, cooccurrenceRows[4])],
      ]),
    ],
    [
      "interview-3",
      new Map<string | number, MatrixCell>([
        ["grief", cell(5, cooccurrenceRows[2])],
        ["hope", cell(2, cooccurrenceRows[5])],
      ]),
    ],
  ])
  return {
    kind: "matrix",
    xKeys: ["interview-1", "interview-2", "interview-3"],
    yKeys: ["grief", "hope"],
    cells,
    min: 0,
    max: 5,
    colorToken: "blue",
    ...overrides,
  }
}

const renderables: Record<string, () => RenderableChart> = {
  bar: () => singleSeriesAxisRenderable("bar"),
  line: () => singleSeriesAxisRenderable("line"),
  area: () => singleSeriesAxisRenderable("area", "area-left"),
  scatter: () => singleSeriesAxisRenderable("scatter"),
  pie: () => partRenderable("pie"),
  treemap: () => partRenderable("treemap"),
  heatmap: () => matrixRenderable(),
}

export const allRenderableFixtureNames = Object.keys(renderables)

export const renderableFixture = (name: string): RenderableChart => {
  const build = renderables[name]
  if (!build) throw new Error(`no renderable fixture named "${name}"`)
  return build()
}

export const narrowRenderable = <K extends RenderableChart["kind"]>(
  renderable: RenderableChart,
  kind: K
): Extract<RenderableChart, { kind: K }> => {
  if (renderable.kind !== kind) {
    throw new Error(`expected a ${kind} renderable, got ${renderable.kind}`)
  }
  return renderable as Extract<RenderableChart, { kind: K }>
}

export const renderableOfKind = <K extends RenderableChart["kind"]>(
  name: string,
  kind: K
): Extract<RenderableChart, { kind: K }> => narrowRenderable(renderableFixture(name), kind)

export const sampleTooltipContext = (entityMap: ChartEntityMap = {}): ChartTooltipContext => ({
  files: {},
  projectId: null,
  entityMap,
})

export const sampleTooltipPayload = (
  overrides: Partial<RechartsPayloadItem> = {}
): RechartsPayloadItem[] => [
  {
    name: "count",
    value: 12,
    color: SAMPLE_SERIES_COLOR,
    payload: { _raw: { month: "Jan", count: 12 } },
    ...overrides,
  },
]
