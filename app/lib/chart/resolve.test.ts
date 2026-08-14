import { describe, it, expect } from "vitest"
import { resolveChartData, type ResolveOptions } from "./resolve"
import type {
  AxisRenderable,
  ChartEntityMap,
  ChartSpec,
  MatrixRenderable,
  PartRenderable,
} from "./types"
import { parseTemplate } from "./template"
import {
  entity,
  buildColorContext,
  chartFixture,
  narrowRenderable,
  regionEntities,
} from "./test-helpers"

const buildOptions = (
  spec: ChartSpec,
  rows: Record<string, unknown>[],
  entityMap: ChartEntityMap = {}
): ResolveOptions => ({
  spec,
  rows,
  entityMap,
  colorContext: buildColorContext(entityMap),
})

const mustFind = <T>(arr: T[], pred: (item: T) => boolean, label: string): T => {
  const found = arr.find(pred)
  if (!found) throw new Error(`expected ${label}`)
  return found
}

describe("resolveChartData — axis charts", () => {
  const cases: {
    name: string
    spec: ChartSpec
    rows: Record<string, unknown>[]
    entityMap?: ChartEntityMap
    expect: (chart: AxisRenderable) => void
  }[] = [
    {
      name: "two layers binding the same y column contribute distinct keys, each with its own sum",
      spec: {
        type: "axis",
        x: "month",
        orientation: "vertical",
        layers: [
          { mark: "bar", y: "count", color: "blue", stack: false, axis: "left" },
          { mark: "line", y: "count", color: "amber", axis: "left" },
        ],
      },
      rows: [
        { month: "Jan", count: 2 },
        { month: "Jan", count: 3 },
        { month: "Feb", count: 5 },
      ],
      expect: (chart) => {
        expect(chart.series.map((s) => s.key)).toEqual(["l0s0", "l1s0"])
        expect(chart.rows).toHaveLength(2)
        expect(chart.rows[0].x).toBe("Jan")
        expect(chart.rows[0].l0s0).toBe(5)
        expect(chart.rows[0].l1s0).toBe(5)
        expect(chart.rows[1].l0s0).toBe(5)
        expect(chart.rows[1].l1s0).toBe(5)
      },
    },
    {
      name: "same display name across layers: names equal, keys distinct, two legend entries",
      spec: {
        type: "axis",
        x: "month",
        orientation: "vertical",
        layers: [
          { mark: "bar", y: "count", color: "blue", stack: false, axis: "left" },
          { mark: "line", y: { field: "ratio", label: "count" }, color: "amber", axis: "left" },
        ],
      },
      rows: [{ month: "Jan", count: 5, ratio: 0.5 }],
      expect: (chart) => {
        expect(chart.series).toHaveLength(2)
        expect(chart.series[0].name).toBe("count")
        expect(chart.series[1].name).toBe("count")
        expect(chart.series[0].key).not.toBe(chart.series[1].key)
      },
    },
    {
      name: "scatter series each hold only their own values; a missing row leaves the key absent",
      spec: {
        type: "axis",
        x: "month",
        orientation: "vertical",
        layers: [
          { mark: "scatter", y: "count", series: "region", color: "{region:color}", axis: "left" },
        ],
      },
      rows: [
        { month: "Jan", region: "north", count: 12 },
        { month: "Jan", region: "south", count: 7 },
        { month: "Feb", region: "north", count: 9 },
      ],
      entityMap: regionEntities,
      expect: (chart) => {
        expect(chart.series.map((s) => s.key)).toEqual(["l0s0", "l0s1"])
        expect(chart.series.map((s) => s.name)).toEqual(["North", "South"])
        const jan = mustFind(chart.rows, (r) => r.x === "Jan", "Jan row")
        expect(jan.l0s0).toBe(12)
        expect(jan.l0s1).toBe(7)
        expect(jan._entityUrl).toBe("/north")
        const feb = mustFind(chart.rows, (r) => r.x === "Feb", "Feb row")
        expect(feb.l0s0).toBe(9)
        expect("l0s1" in feb).toBe(false)
      },
    },
    {
      name: "pivoting layer and plain layer coexist in one ordered list over one row set",
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
          { mark: "line", y: "ratio", color: "amber", axis: "right" },
        ],
      },
      rows: [
        { month: "Jan", region: "north", count: 1, ratio: 0.5 },
        { month: "Jan", region: "south", count: 2, ratio: 0.25 },
        { month: "Feb", region: "north", count: 3, ratio: 0.75 },
      ],
      entityMap: regionEntities,
      expect: (chart) => {
        expect(chart.series.map((s) => s.key)).toEqual(["l0s0", "l0s1", "l1s0"])
        expect(chart.series.map((s) => s.name)).toEqual(["North", "South", "ratio"])
        expect(chart.rows).toHaveLength(2)
        const jan = mustFind(chart.rows, (r) => r.x === "Jan", "Jan row")
        expect(jan.l0s0).toBe(1)
        expect(jan.l0s1).toBe(2)
        expect(jan.l1s0).toBe(0.75)
      },
    },
    {
      name: "two single-series stacking bar layers on the left share one stackId",
      ...chartFixture("wide-stacked"),
      expect: (chart) => {
        expect(chart.series).toHaveLength(2)
        expect(chart.series[0].stackId).toBeDefined()
        expect(chart.series[0].stackId).toBe(chart.series[1].stackId)
      },
    },
    {
      name: "stacking layers carry a stackId, non-stacking layers carry none",
      spec: {
        type: "axis",
        x: "month",
        orientation: "vertical",
        layers: [
          { mark: "bar", y: "count", color: "blue", stack: true, axis: "left" },
          { mark: "bar", y: "ratio", color: "amber", stack: false, axis: "left" },
          { mark: "line", y: "other", color: "green", axis: "left" },
        ],
      },
      rows: [{ month: "Jan", count: 1, ratio: 2, other: 3 }],
      expect: (chart) => {
        expect(chart.series[0].stackId).toBeDefined()
        expect(chart.series[1].stackId).toBeUndefined()
        expect(chart.series[2].stackId).toBeUndefined()
      },
    },
    {
      name: "stacking bar and stacking area take different stackIds",
      spec: {
        type: "axis",
        x: "month",
        orientation: "vertical",
        layers: [
          { mark: "bar", y: "count", color: "blue", stack: true, axis: "left" },
          { mark: "area", y: "ratio", color: "amber", stack: true, axis: "left" },
        ],
      },
      rows: [{ month: "Jan", count: 1, ratio: 2 }],
      expect: (chart) => {
        expect(chart.series[0].stackId).toBeDefined()
        expect(chart.series[1].stackId).toBeDefined()
        expect(chart.series[0].stackId).not.toBe(chart.series[1].stackId)
      },
    },
    {
      name: "stacking bars on opposite axes take different stackIds",
      spec: {
        type: "axis",
        x: "month",
        orientation: "vertical",
        layers: [
          { mark: "bar", y: "count", color: "blue", stack: true, axis: "left" },
          { mark: "bar", y: "ratio", color: "amber", stack: true, axis: "right" },
        ],
      },
      rows: [{ month: "Jan", count: 1, ratio: 2 }],
      expect: (chart) => {
        expect(chart.series[0].stackId).toBeDefined()
        expect(chart.series[1].stackId).toBeDefined()
        expect(chart.series[0].stackId).not.toBe(chart.series[1].stackId)
      },
    },
    {
      name: "two distinct series values sharing a label stay two series",
      spec: {
        type: "axis",
        x: "month",
        orientation: "vertical",
        layers: [
          { mark: "bar", y: "count", series: "code", color: "blue", stack: false, axis: "left" },
        ],
      },
      rows: [
        { month: "Jan", code: "grief-a", count: 3 },
        { month: "Jan", code: "grief-b", count: 4 },
      ],
      entityMap: {
        "grief-a": entity("grief-a", "Grief", "red"),
        "grief-b": entity("grief-b", "Grief", "blue"),
      },
      expect: (chart) => {
        expect(chart.series).toHaveLength(2)
        expect(chart.series.map((s) => s.name)).toEqual(["Grief", "Grief"])
        expect(chart.rows[0].l0s0).toBe(3)
        expect(chart.rows[0].l0s1).toBe(4)
      },
    },
    {
      name: "duplicate rows at the same (x, series) sum",
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
      rows: [
        { month: "Jan", region: "north", count: 3 },
        { month: "Jan", region: "north", count: 4 },
      ],
      entityMap: regionEntities,
      expect: (chart) => {
        expect(chart.series).toHaveLength(1)
        expect(chart.rows).toHaveLength(1)
        expect(chart.rows[0].l0s0).toBe(7)
      },
    },
    {
      name: "_colors keyed by synthetic keys, each datum carrying its own row's resolved color",
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
      rows: [
        { month: "Jan", region: "north", count: 1 },
        { month: "Jan", region: "south", count: 2 },
      ],
      entityMap: {
        north: entity("north", "North", "red"),
        south: entity("south", "South", "#0d9488"),
      },
      expect: (chart) => {
        expect(chart.rows[0]._colors).toEqual({ l0s0: "radix(red,9)", l0s1: "#0d9488" })
        expect(chart.series[0].color).toBe("radix(red,9)")
        expect(chart.series[1].color).toBe("#0d9488")
      },
    },
    {
      name: "axis formats come from the first layer on each side whose y binding declares one",
      spec: {
        type: "axis",
        x: { field: "month", format: "%b" },
        orientation: "vertical",
        layers: [
          { mark: "bar", y: "count", color: "blue", stack: false, axis: "left" },
          { mark: "line", y: { field: "ratio", format: ".1%" }, color: "amber", axis: "left" },
          { mark: "line", y: { field: "other", format: ",.0f" }, color: "green", axis: "right" },
        ],
      },
      rows: [{ month: "Jan", count: 1, ratio: 0.5, other: 100 }],
      expect: (chart) => {
        expect(chart.xFormat).toBe("%b")
        expect(chart.leftAxisFormat).toBe(".1%")
        expect(chart.rightAxisFormat).toBe(",.0f")
      },
    },
    {
      name: "empty rows: plain layers keep their descriptors, pivoting layers contribute none",
      spec: {
        type: "axis",
        x: "month",
        orientation: "vertical",
        layers: [
          { mark: "bar", y: "count", color: "blue", stack: false, axis: "left" },
          { mark: "line", y: "count", series: "region", color: "{region:color}", axis: "left" },
        ],
      },
      rows: [],
      expect: (chart) => {
        expect(chart.series.map((s) => s.key)).toEqual(["l0s0"])
        expect(chart.series[0].name).toBe("count")
        expect(chart.rows).toEqual([])
      },
    },
    {
      name: "descriptor color is the first contributing row's; per-datum colors are the last's",
      spec: {
        type: "axis",
        x: "month",
        orientation: "vertical",
        layers: [{ mark: "bar", y: "count", color: "{c}", stack: false, axis: "left" }],
      },
      rows: [
        { month: "Jan", count: 1, c: "#111111" },
        { month: "Jan", count: 2, c: "#222222" },
        { month: "Feb", count: 3, c: "#333333" },
      ],
      expect: (chart) => {
        expect(chart.series[0].color).toBe("#111111")
        expect(chart.rows[0]._colors.l0s0).toBe("#222222")
        expect(chart.rows[1]._colors.l0s0).toBe("#333333")
      },
    },
    {
      name: "two format-bearing layers on one side: the first layer's format wins",
      spec: {
        type: "axis",
        x: "month",
        orientation: "vertical",
        layers: [
          {
            mark: "bar",
            y: { field: "count", format: ".1%" },
            color: "blue",
            stack: false,
            axis: "left",
          },
          { mark: "line", y: { field: "ratio", format: ",.0f" }, color: "amber", axis: "left" },
        ],
      },
      rows: [{ month: "Jan", count: 1, ratio: 2 }],
      expect: (chart) => {
        expect(chart.leftAxisFormat).toBe(".1%")
      },
    },
    {
      name: "a chart-level tooltip template is parsed once and attached to every row",
      spec: {
        type: "axis",
        x: "month",
        orientation: "vertical",
        layers: [{ mark: "bar", y: "count", color: "blue", stack: false, axis: "left" }],
        tooltip: "**{month}**: {count} visits",
      },
      rows: [
        { month: "Jan", count: 1 },
        { month: "Feb", count: 2 },
      ],
      expect: (chart) => {
        const nodes = parseTemplate("**{month}**: {count} visits")
        expect(chart.rows[0]._tooltipNodes).toEqual(nodes)
        expect(chart.rows[1]._tooltipNodes).toEqual(nodes)
      },
    },
    {
      name: "skeleton combo: bar and right-axis line resolve to one row set with both keys",
      ...chartFixture("combo"),
      expect: (chart) => {
        expect(chart.series.map((s) => s.mark)).toEqual(["bar", "line"])
        expect(chart.series.map((s) => s.axis)).toEqual(["left", "right"])
        expect(chart.series[0].key).not.toBe(chart.series[1].key)
        expect(chart.rows).toHaveLength(3)
        expect(chart.rows[0].l0s0).toBe(19)
        expect(chart.rows[0].l1s0).toBe(0.4)
      },
    },
  ]

  it.each(cases)("$name", ({ spec, rows, entityMap, expect: assertFn }) => {
    const chart = resolveChartData(buildOptions(spec, rows, entityMap))
    assertFn(narrowRenderable(chart, "axis"))
  })
})

describe("resolveChartData — matrix charts", () => {
  const heatmapSpec: ChartSpec = {
    type: "heatmap",
    x: "doc",
    y: "code",
    value: "n",
    color: "blue",
  }

  const cases: {
    name: string
    spec: ChartSpec
    rows: Record<string, unknown>[]
    entityMap?: ChartEntityMap
    expect: (chart: MatrixRenderable) => void
  }[] = [
    {
      name: "negative values: min is the true negative minimum",
      spec: heatmapSpec,
      rows: [
        { doc: "a", code: "p", n: -5 },
        { doc: "a", code: "q", n: 4 },
        { doc: "b", code: "p", n: 0 },
      ],
      expect: (chart) => {
        expect(chart.min).toBe(-5)
        expect(chart.max).toBe(4)
      },
    },
    {
      name: "one distinct value: min equals max and the renderable stays well-formed",
      spec: heatmapSpec,
      rows: [
        { doc: "a", code: "p", n: 7 },
        { doc: "b", code: "q", n: 7 },
      ],
      expect: (chart) => {
        expect(chart.min).toBe(7)
        expect(chart.max).toBe(7)
        expect(chart.xKeys).toEqual(["a", "b"])
        expect(chart.yKeys).toEqual(["p", "q"])
        expect(chart.cells.get("a")?.get("p")?.value).toBe(7)
      },
    },
    {
      name: "zero-valued pair has a cell, uncovered pairs have none",
      spec: heatmapSpec,
      rows: [
        { doc: "a", code: "p", n: 0 },
        { doc: "b", code: "q", n: 2 },
      ],
      expect: (chart) => {
        expect(chart.cells.get("a")?.get("p")?.value).toBe(0)
        expect(chart.cells.get("a")?.get("q")).toBeUndefined()
        expect(chart.cells.get("b")?.get("p")).toBeUndefined()
      },
    },
    {
      name: "duplicate rows at one (x, y) sum into one cell",
      spec: heatmapSpec,
      rows: [
        { doc: "a", code: "p", n: 2 },
        { doc: "a", code: "p", n: 3 },
      ],
      expect: (chart) => {
        expect(chart.cells.get("a")?.get("p")?.value).toBe(5)
        expect(chart.cells.get("a")?.get("p")?._raw).toEqual({ doc: "a", code: "p", n: 2 })
      },
    },
    {
      name: "xKeys and yKeys list raw distinct values in order of first appearance",
      spec: heatmapSpec,
      rows: [
        { doc: "south", code: 2, n: 1 },
        { doc: "north", code: 1, n: 1 },
        { doc: "south", code: 1, n: 1 },
      ],
      entityMap: regionEntities,
      expect: (chart) => {
        expect(chart.xKeys).toEqual(["south", "north"])
        expect(chart.yKeys).toEqual([2, 1])
      },
    },
    {
      name: "empty rows: empty key lists, no cells, no min/max",
      spec: heatmapSpec,
      rows: [],
      expect: (chart) => {
        expect(chart.xKeys).toEqual([])
        expect(chart.yKeys).toEqual([])
        expect(chart.cells.size).toBe(0)
        expect(chart.min).toBeUndefined()
        expect(chart.max).toBeUndefined()
      },
    },
    {
      name: "cells carry the tooltip template and the row's entity url",
      spec: {
        type: "heatmap",
        x: "doc",
        y: "code",
        value: "n",
        color: "blue",
        tooltip: "{code}: {n}",
      },
      rows: [{ doc: "north", code: "p", n: 1 }],
      entityMap: regionEntities,
      expect: (chart) => {
        const cell = chart.cells.get("north")?.get("p")
        expect(cell?._tooltipNodes).toEqual(parseTemplate("{code}: {n}"))
        expect(cell?._entityUrl).toBe("/north")
      },
    },
    {
      name: "skeleton heatmap: 3×2 grid with min/max bracketing the cells",
      ...chartFixture("heatmap"),
      expect: (chart) => {
        expect(chart.xKeys).toEqual(["interview-1", "interview-2", "interview-3"])
        expect(chart.yKeys).toEqual(["grief", "hope"])
        expect(chart.min).toBe(0)
        expect(chart.max).toBe(5)
        expect(chart.colorToken).toBe("blue")
      },
    },
  ]

  it.each(cases)("$name", ({ spec, rows, entityMap, expect: assertFn }) => {
    const chart = resolveChartData(buildOptions(spec, rows, entityMap))
    assertFn(narrowRenderable(chart, "matrix"))
  })
})

describe("resolveChartData — part charts", () => {
  const cases: {
    name: string
    spec: ChartSpec
    rows: Record<string, unknown>[]
    entityMap?: ChartEntityMap
    expect: (chart: PartRenderable) => void
  }[] = [
    {
      name: "pie: label resolved via entity map, color via property",
      spec: {
        type: "pie",
        label: "code",
        value: "count",
        color: "{code:color}",
      },
      rows: [
        { code: "callout-abc12345", count: 40 },
        { code: "callout-def67890", count: 60 },
      ],
      entityMap: {
        "callout-abc12345": entity("callout-abc12345", "Trust", "red"),
        "callout-def67890": entity("callout-def67890", "Fear", "blue"),
      },
      expect: (chart) => {
        expect(chart.type).toBe("pie")
        expect(chart.rows).toHaveLength(2)
        expect(chart.rows[0].name).toBe("Trust")
        expect(chart.rows[0].value).toBe(40)
        expect(chart.rows[0].fill).toBe("radix(red,9)")
        expect(chart.rows[1].name).toBe("Fear")
        expect(chart.rows[1].fill).toBe("radix(blue,9)")
      },
    },
    {
      name: "treemap: values coerced and token color resolved",
      spec: {
        type: "treemap",
        label: "name",
        value: "amount",
        color: "cyan",
      },
      rows: [
        { name: "A", amount: "100" },
        { name: "B", amount: 200 },
      ],
      expect: (chart) => {
        expect(chart.type).toBe("treemap")
        expect(chart.rows[0].value).toBe(100)
        expect(chart.rows[1].value).toBe(200)
        expect(chart.rows[0].fill).toBe("radix(cyan,9)")
      },
    },
    {
      name: "pie: entity URL propagated from chart entity map",
      spec: {
        type: "pie",
        label: "code",
        value: "count",
        color: "pink",
      },
      rows: [{ code: "callout-abc12345", count: 5 }],
      entityMap: {
        "callout-abc12345": entity("callout-abc12345", "Trust", "red"),
      },
      expect: (chart) => {
        expect(chart.rows[0]._entityUrl).toBe("/callout-abc12345")
      },
    },
  ]

  it.each(cases)("$name", ({ spec, rows, entityMap, expect: assertFn }) => {
    const chart = resolveChartData(buildOptions(spec, rows, entityMap))
    assertFn(narrowRenderable(chart, "part"))
  })
})
