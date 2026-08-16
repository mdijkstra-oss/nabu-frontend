import { describe, it, expect } from "vitest"
import { parseChart } from "./schema"
import { allChartFixtureNames, chartFixture, type ChartFixtureName } from "~/lib/chart/test-helpers"

const chartJson = (spec: unknown): string =>
  JSON.stringify({
    id: "chart-001",
    caption: { label: "Demo" },
    query: "SELECT * FROM t",
    spec,
  })

const barLayer = (overrides: Record<string, unknown> = {}) => ({
  mark: "bar",
  y: "count",
  color: "blue",
  ...overrides,
})

const axisSpec = (overrides: Record<string, unknown> = {}) => ({
  type: "axis",
  x: "month",
  layers: [barLayer()],
  ...overrides,
})

describe("parseChart — hostile content", () => {
  const cases: { name: string; content: string }[] = [
    { name: "not JSON", content: "not json at all" },
    { name: "JSON string", content: '"just a string"' },
    { name: "JSON number", content: "42" },
    { name: "JSON array", content: "[1, 2, 3]" },
    { name: "JSON null", content: "null" },
    {
      name: "object missing spec",
      content: JSON.stringify({ id: "chart-1", caption: { label: "x" }, query: "SELECT 1" }),
    },
  ]

  it.each(cases)("$name → null", ({ content }) => {
    expect(parseChart(content)).toBeNull()
  })
})

describe("parseChart — rejected specs", () => {
  const cases: { name: string; spec: unknown }[] = [
    {
      name: "old flat format (type bar)",
      spec: { type: "bar", x: "month", y: "count", color: "blue" },
    },
    { name: "empty layers", spec: axisSpec({ layers: [] }) },
    { name: "absent layers", spec: { type: "axis", x: "month" } },
    { name: "unknown mark", spec: axisSpec({ layers: [barLayer({ mark: "lollipop" })] }) },
    { name: "unknown family", spec: { type: "lollipop", x: "a", y: "b", color: "blue" } },
    {
      name: "stack on line layer",
      spec: axisSpec({ layers: [{ mark: "line", y: "count", color: "blue", stack: true }] }),
    },
    {
      name: "stack on scatter layer",
      spec: axisSpec({ layers: [{ mark: "scatter", y: "count", color: "blue", stack: true }] }),
    },
    { name: "orientation diagonal", spec: axisSpec({ orientation: "diagonal" }) },
    { name: "axis middle", spec: axisSpec({ layers: [barLayer({ axis: "middle" })] }) },
    { name: "empty x binding string", spec: axisSpec({ x: "" }) },
    { name: "empty x binding field", spec: axisSpec({ x: { field: "" } }) },
    { name: "empty layer y binding string", spec: axisSpec({ layers: [barLayer({ y: "" })] }) },
    {
      name: "empty layer y binding field",
      spec: axisSpec({ layers: [barLayer({ y: { field: "" } })] }),
    },
  ]

  it.each(cases)("$name", ({ spec }) => {
    expect(parseChart(chartJson(spec))).toBeNull()
  })
})

describe("parseChart — orientation", () => {
  const cases: { orientation: string }[] = [
    { orientation: "vertical" },
    { orientation: "horizontal" },
  ]

  it.each(cases)("accepts $orientation", ({ orientation }) => {
    const block = parseChart(chartJson(axisSpec({ orientation })))
    expect(block).not.toBeNull()
    if (block?.spec.type !== "axis") throw new Error("expected axis spec")
    expect(block.spec.orientation).toBe(orientation)
  })
})

describe("parseChart — defaults materialize", () => {
  it("orientation, stack, and axis come out concrete", () => {
    const block = parseChart(chartJson(axisSpec()))
    expect(block).not.toBeNull()
    if (block?.spec.type !== "axis") throw new Error("expected axis spec")
    expect(block.spec.orientation).toBe("vertical")
    const layer = block.spec.layers[0]
    if (layer.mark !== "bar") throw new Error("expected bar layer")
    expect(layer.stack).toBe(false)
    expect(layer.axis).toBe("left")
  })

  it("a line curve defaults to straight segments", () => {
    const block = parseChart(
      chartJson(axisSpec({ layers: [{ mark: "line", y: "count", color: "blue" }] }))
    )
    if (block?.spec.type !== "axis") throw new Error("expected axis spec")
    const layer = block.spec.layers[0]
    if (layer.mark !== "line") throw new Error("expected line layer")
    expect(layer.curve).toBe("linear")
  })

  it("an x binding object defaults to a category axis", () => {
    const block = parseChart(chartJson(axisSpec({ x: { field: "month", format: "%b %Y" } })))
    if (block?.spec.type !== "axis") throw new Error("expected axis spec")
    if (typeof block.spec.x === "string") throw new Error("expected object binding")
    expect(block.spec.x.scale).toBe("category")
  })

  it("a time axis is taken as written", () => {
    const block = parseChart(chartJson(axisSpec({ x: { field: "month", scale: "time" } })))
    if (block?.spec.type !== "axis") throw new Error("expected axis spec")
    if (typeof block.spec.x === "string") throw new Error("expected object binding")
    expect(block.spec.x.scale).toBe("time")
  })
})

describe("parseChart — rejected scale and curve values", () => {
  const cases: { name: string; spec: unknown }[] = [
    {
      name: "unknown x scale",
      spec: {
        type: "axis",
        x: { field: "m", scale: "log" },
        layers: [{ mark: "bar", y: "c", color: "blue" }],
      },
    },
    {
      name: "unknown curve",
      spec: {
        type: "axis",
        x: "m",
        layers: [{ mark: "line", y: "c", color: "blue", curve: "wiggly" }],
      },
    },
    {
      name: "curve on a bar",
      spec: {
        type: "axis",
        x: "m",
        layers: [{ mark: "bar", y: "c", color: "blue", curve: "linear" }],
      },
    },
  ]

  it.each(cases)("$name → null", ({ spec }) => {
    expect(parseChart(chartJson(spec))).toBeNull()
  })
})

describe("parseChart — color forms", () => {
  const cases: { name: string; family: "axis" | "heatmap"; color: string; valid: boolean }[] = [
    { name: "axis radix token", family: "axis", color: "blue", valid: true },
    { name: "axis column template", family: "axis", color: "{color_col}", valid: true },
    { name: "axis entity property template", family: "axis", color: "{code:color}", valid: true },
    { name: "axis hex literal", family: "axis", color: "#3b82f6", valid: false },
    { name: "axis unknown token", family: "axis", color: "fuchsia", valid: false },
    { name: "axis empty string", family: "axis", color: "", valid: false },
    { name: "axis whitespace template field", family: "axis", color: "{ }", valid: false },
    { name: "axis name-property template", family: "axis", color: "{code:name}", valid: false },
    { name: "axis format template", family: "axis", color: "{n:.0f}", valid: false },
    { name: "axis multi-node template", family: "axis", color: "a{b}c", valid: false },
    { name: "axis empty property template field", family: "axis", color: "{:color}", valid: false },
    { name: "heatmap radix token", family: "heatmap", color: "blue", valid: true },
    { name: "heatmap column template", family: "heatmap", color: "{color_col}", valid: false },
    {
      name: "heatmap entity property template",
      family: "heatmap",
      color: "{code:color}",
      valid: false,
    },
    { name: "heatmap hex literal", family: "heatmap", color: "#3b82f6", valid: false },
    { name: "heatmap unknown token", family: "heatmap", color: "fuchsia", valid: false },
    { name: "heatmap empty string", family: "heatmap", color: "", valid: false },
  ]

  const specWithColor = (family: "axis" | "heatmap", color: string): unknown =>
    family === "axis"
      ? axisSpec({ layers: [barLayer({ color })] })
      : { type: "heatmap", x: "doc", y: "code", value: "n", color }

  it.each(cases)("$name → valid: $valid", ({ family, color, valid }) => {
    expect(parseChart(chartJson(specWithColor(family, color))) !== null).toBe(valid)
  })
})

describe("parseChart — query refinement", () => {
  const semanticQueries = [
    "SELECT SEMANTIC('foo')",
    "SELECT semantic('foo')",
    "SELECT SEMANTIC ('foo')",
  ]

  it.each(semanticQueries.map((query) => ({ query })))("rejects $query", ({ query }) => {
    const content = JSON.stringify({
      id: "chart-1",
      caption: { label: "x" },
      query,
      spec: axisSpec(),
    })
    expect(parseChart(content)).toBeNull()
  })
})

describe("parseChart — fixtures", () => {
  const names: ChartFixtureName[] = ["combo", "stacked", "grouped", "horizontal", "wide-stacked"]

  it.each(allChartFixtureNames.map((name) => ({ name })))(
    "every fixture spec passes the schema: $name",
    ({ name }) => {
      expect(parseChart(chartJson(chartFixture(name).spec))).not.toBeNull()
    }
  )

  it.each(names.map((name) => ({ name })))("$name parses with concrete defaults", ({ name }) => {
    const block = parseChart(chartJson(chartFixture(name).spec))
    expect(block).not.toBeNull()
    if (block?.spec.type !== "axis") throw new Error("expected axis spec")
    expect(["vertical", "horizontal"]).toContain(block.spec.orientation)
    for (const layer of block.spec.layers) {
      expect(["left", "right"]).toContain(layer.axis)
      if (layer.mark === "bar" || layer.mark === "area") {
        expect(typeof layer.stack).toBe("boolean")
      }
    }
  })

  it("combo comes back as a bar layer and a right-axis line layer over one x", () => {
    const block = parseChart(chartJson(chartFixture("combo").spec))
    expect(block).not.toBeNull()
    if (block?.spec.type !== "axis") throw new Error("expected axis spec")
    expect(block.spec.x).toBe("month")
    expect(block.spec.layers.map((layer) => layer.mark)).toEqual(["bar", "line"])
    expect(block.spec.layers[1].axis).toBe("right")
  })
})
