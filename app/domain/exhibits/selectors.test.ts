import { describe, it, expect } from "vitest"
import { inferChartSubtype, collectExhibits, groupByKind } from "./selectors"
import type { ChartLayer, ChartSpec, LayerMark } from "~/lib/chart/types"
import type { ChartSubtype, ExhibitItem, ExhibitKind } from "./types"

const axisLayer = (mark: LayerMark): ChartLayer => {
  const shared = { y: "count", color: "blue", axis: "left" } as const
  if (mark === "line") return { mark, ...shared, curve: "linear" }
  if (mark === "area") return { mark, ...shared, curve: "linear", stack: false }
  if (mark === "scatter") return { mark, ...shared }
  return { mark, ...shared, stack: false }
}

const axisSpec = (mark: LayerMark): ChartSpec => ({
  type: "axis",
  x: "month",
  orientation: "vertical",
  layers: [axisLayer(mark)],
})

describe("inferChartSubtype", () => {
  interface Case {
    name: string
    spec: ChartSpec
    expected: ChartSubtype
  }

  const cases: Case[] = [
    { name: "axis with bar first layer", spec: axisSpec("bar"), expected: "bar" },
    { name: "axis with line first layer", spec: axisSpec("line"), expected: "line" },
    { name: "axis with area first layer", spec: axisSpec("area"), expected: "line" },
    { name: "axis with scatter first layer", spec: axisSpec("scatter"), expected: "scatter" },
    {
      name: "pie",
      spec: { type: "pie", label: "region", value: "total", color: "blue" },
      expected: "pie",
    },
    {
      name: "treemap",
      spec: { type: "treemap", label: "region", value: "total", color: "blue" },
      expected: "pie",
    },
    {
      name: "heatmap",
      spec: { type: "heatmap", x: "document", y: "code", value: "n", color: "blue" },
      expected: "other",
    },
  ]

  it.each(cases)("$name → $expected", ({ spec, expected }) => {
    expect(inferChartSubtype(spec)).toBe(expected)
  })
})

describe("collectExhibits", () => {
  const axisChartBlock = (id: string, title: string, mark: LayerMark, { stack = false } = {}) =>
    JSON.stringify({
      id,
      caption: { label: title },
      query: "SELECT 1",
      spec: {
        type: "axis",
        x: "month",
        layers: [
          {
            mark,
            y: "revenue",
            color: "blue",
            ...(mark === "bar" || mark === "area" ? { stack } : {}),
          },
        ],
      },
    })

  const wrapInDocument = (chartJson: string) =>
    `# Some doc\n\n\`\`\`json-chart\n${chartJson}\n\`\`\`\n`

  interface Case {
    name: string
    files: Record<string, string>
    check: (exhibits: ReturnType<typeof collectExhibits>) => void
  }

  const cases: Case[] = [
    {
      name: "collects charts from multiple files",
      files: {
        "doc_a.md": wrapInDocument(axisChartBlock("chart-001", "Revenue", "bar")),
        "doc_b.md": wrapInDocument(axisChartBlock("chart-002", "Trends", "line")),
      },
      check: (exhibits) => {
        expect(exhibits).toHaveLength(2)
        expect(exhibits[0]).toEqual({
          id: "chart-001",
          title: "Revenue",
          kind: "chart",
          subtype: "bar",
          documentId: "doc_a.md",
          documentTitle: "Doc A",
        })
        expect(exhibits[1]).toEqual({
          id: "chart-002",
          title: "Trends",
          kind: "chart",
          subtype: "line",
          documentId: "doc_b.md",
          documentTitle: "Doc B",
        })
      },
    },
    {
      name: "returns empty for files without charts",
      files: { "doc.md": "# Just text\n\nNo charts here." },
      check: (exhibits) => expect(exhibits).toEqual([]),
    },
    {
      name: "maps stacked bar and area layers to their canonical subtypes",
      files: {
        "multi.md": [
          "# Multi chart doc",
          "",
          "```json-chart",
          axisChartBlock("chart-a", "First", "bar", { stack: true }),
          "```",
          "",
          "```json-chart",
          axisChartBlock("chart-b", "Second", "area"),
          "```",
        ].join("\n"),
      },
      check: (exhibits) => {
        expect(exhibits).toHaveLength(2)
        expect(exhibits[0].subtype).toBe("bar")
        expect(exhibits[1].subtype).toBe("line")
      },
    },
  ]

  it.each(cases)("$name", ({ files, check }) => check(collectExhibits(files)))
})

describe("groupByKind", () => {
  const exhibit = (kind: ExhibitKind, id: string): ExhibitItem => ({
    id,
    title: id,
    kind,
    subtype: "bar",
    documentId: "doc.md",
    documentTitle: "Doc",
  })

  interface Case {
    name: string
    items: ExhibitItem[]
    check: (groups: ReturnType<typeof groupByKind>) => void
  }

  const cases: Case[] = [
    {
      name: "groups exhibits by kind",
      items: [exhibit("chart", "a"), exhibit("chart", "b")],
      check: (groups) => {
        expect(groups).toHaveLength(1)
        expect(groups[0].kind).toBe("chart")
        expect(groups[0].items).toHaveLength(2)
      },
    },
    {
      name: "returns empty for no exhibits",
      items: [],
      check: (groups) => expect(groups).toEqual([]),
    },
  ]

  it.each(cases)("$name", ({ items, check }) => check(groupByKind(items)))
})
