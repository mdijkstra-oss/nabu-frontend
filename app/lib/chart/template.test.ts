import { describe, it, expect } from "vitest"
import {
  parseTemplate,
  resolveTemplateToMarkdown,
  isTemplate,
  collectReferencedFields,
} from "./template"
import type { ChartEntityMap, ChartSpec, TemplateNode } from "./types"
import { entity } from "./test-helpers"

describe("parseTemplate", () => {
  const cases: {
    name: string
    input: string
    expected: TemplateNode[]
  }[] = [
    {
      name: "empty string",
      input: "",
      expected: [],
    },
    {
      name: "literal only",
      input: "Hello world",
      expected: [{ type: "literal", value: "Hello world" }],
    },
    {
      name: "single raw ref",
      input: "{count}",
      expected: [{ type: "ref", field: "count", op: { kind: "raw" } }],
    },
    {
      name: "ref with format",
      input: "{count:.2f}",
      expected: [{ type: "ref", field: "count", op: { kind: "format", format: ".2f" } }],
    },
    {
      name: "ref with property color",
      input: "{code:color}",
      expected: [{ type: "ref", field: "code", op: { kind: "property", property: "color" } }],
    },
    {
      name: "ref with property label",
      input: "{code:label}",
      expected: [{ type: "ref", field: "code", op: { kind: "property", property: "label" } }],
    },
    {
      name: "icon is an unrecognized tail, not a property op",
      input: "{code:icon}",
      expected: [{ type: "ref", field: "code", op: { kind: "format", format: "icon" } }],
    },
    {
      name: "literal and refs mixed",
      input: "total: {count} items",
      expected: [
        { type: "literal", value: "total: " },
        { type: "ref", field: "count", op: { kind: "raw" } },
        { type: "literal", value: " items" },
      ],
    },
    {
      name: "time format",
      input: "{date:%b %Y}",
      expected: [{ type: "ref", field: "date", op: { kind: "format", format: "%b %Y" } }],
    },
    {
      name: "percentage format",
      input: "{pct:.0%}",
      expected: [{ type: "ref", field: "pct", op: { kind: "format", format: ".0%" } }],
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(parseTemplate(input)).toEqual(expected)
  })
})

describe("resolveTemplateToMarkdown", () => {
  const entityMap: ChartEntityMap = {
    "callout-abc12345": entity("callout-abc12345", "Trust", "red"),
  }

  const cases: {
    name: string
    input: string
    row: Record<string, unknown>
    map: ChartEntityMap
    expected: string
  }[] = [
    {
      name: "raw entity id becomes markdown link",
      input: "{code}",
      row: { code: "callout-abc12345" },
      map: entityMap,
      expected: "[Trust](file://callout-abc12345)",
    },
    {
      name: "raw non-entity string unchanged",
      input: "{code}",
      row: { code: "alpha" },
      map: entityMap,
      expected: "alpha",
    },
    {
      name: "property access returns scalar color",
      input: "{code:color}",
      row: { code: "callout-abc12345" },
      map: entityMap,
      expected: "red",
    },
    {
      name: "property name returns label",
      input: "{code:name}",
      row: { code: "callout-abc12345" },
      map: entityMap,
      expected: "Trust",
    },
    {
      name: "format applies to numbers",
      input: "{n:,}",
      row: { n: 12345 },
      map: {},
      expected: "12,345",
    },
    {
      name: "format percentage",
      input: "{pct:.0%}",
      row: { pct: 0.345 },
      map: {},
      expected: "35%",
    },
    {
      name: "literal + entity link mixed",
      input: "Hovered: {code}",
      row: { code: "callout-abc12345" },
      map: entityMap,
      expected: "Hovered: [Trust](file://callout-abc12345)",
    },
    {
      name: "null value",
      input: "{count}",
      row: { count: null },
      map: {},
      expected: "",
    },
    {
      name: "missing field",
      input: "{missing}",
      row: {},
      map: {},
      expected: "",
    },
  ]

  it.each(cases)("$name", ({ input, row, map, expected }) => {
    const nodes = parseTemplate(input)
    expect(resolveTemplateToMarkdown(nodes, { row, entityMap: map })).toBe(expected)
  })
})

describe("isTemplate", () => {
  const cases: { input: string; expected: boolean }[] = [
    { input: "{count}", expected: true },
    { input: "blue", expected: false },
    { input: "{code:color}", expected: true },
    { input: "", expected: false },
    { input: "literal text", expected: false },
    { input: "open { only", expected: false },
  ]

  it.each(cases)('"$input" → $expected', ({ input, expected }) => {
    expect(isTemplate(input)).toBe(expected)
  })
})

describe("collectReferencedFields", () => {
  const cases: {
    name: string
    spec: ChartSpec
    expected: string[]
  }[] = [
    {
      name: "pie tooltip fields join the collected set",
      spec: {
        type: "pie",
        label: "code",
        value: "count",
        color: "blue",
        tooltip: "{code}: {pct}",
      },
      expected: ["code", "count", "pct"],
    },
    {
      name: "heatmap tooltip fields join the collected set",
      spec: {
        type: "heatmap",
        x: "doc",
        y: "code",
        value: "n",
        color: "blue",
        tooltip: "{extra_col}",
      },
      expected: ["doc", "code", "n", "extra_col"],
    },
    {
      name: "single-layer axis with string bindings",
      spec: {
        type: "axis",
        x: "code",
        orientation: "vertical",
        layers: [{ mark: "bar", y: "count", color: "blue", stack: false, axis: "left" }],
      },
      expected: ["code", "count"],
    },
    {
      name: "two layers with series and per-layer color templates",
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
          {
            mark: "line",
            curve: "linear",
            y: "ratio",
            series: "cohort",
            color: "{palette}",
            axis: "right",
          },
        ],
      },
      expected: ["month", "count", "region", "ratio", "cohort", "palette"],
    },
    {
      name: "axis with object bindings",
      spec: {
        type: "axis",
        x: { field: "date", label: "Date", format: "%b %Y", scale: "category" },
        orientation: "vertical",
        layers: [
          {
            mark: "bar",
            y: { field: "count", label: "Count" },
            color: "blue",
            stack: false,
            axis: "left",
          },
        ],
      },
      expected: ["date", "count"],
    },
    {
      name: "pie with parent and color template",
      spec: {
        type: "pie",
        label: "name",
        value: "amount",
        parent: "group",
        color: "{shade_col}",
      },
      expected: ["name", "amount", "group", "shade_col"],
    },
    {
      name: "heatmap",
      spec: {
        type: "heatmap",
        x: "day",
        y: "hour",
        value: "count",
        color: "blue",
      },
      expected: ["day", "hour", "count"],
    },
    {
      name: "tooltip contributes fields",
      spec: {
        type: "axis",
        x: "date",
        orientation: "vertical",
        layers: [{ mark: "line", curve: "linear", y: "value", color: "blue", axis: "left" }],
        tooltip: "{label}: {value} ({pct:.0%})",
      },
      expected: ["date", "value", "label", "pct"],
    },
  ]

  it.each(cases)("$name", ({ spec, expected }) => {
    expect(collectReferencedFields(spec).sort()).toEqual(expected.sort())
  })
})
