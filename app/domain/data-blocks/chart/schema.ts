import { z } from "zod"
import { isRadixToken } from "~/lib/chart/color"
import { isTemplate, parseTemplate } from "~/lib/chart/template"

const containsSemanticCall = (sql: string): boolean => /\bSEMANTIC\s*\(/i.test(sql)

// Only the templates the color evaluator can resolve: exactly one placeholder,
// reading a column raw or an entity's color. Anything else would parse here
// and throw at render time.
const isValidColorTemplate = (value: string): boolean => {
  const nodes = parseTemplate(value)
  if (nodes.length !== 1) return false
  const node = nodes[0]
  if (node.type !== "ref" || node.field.length === 0) return false
  return node.op.kind === "raw" || (node.op.kind === "property" && node.op.property === "color")
}

const isValidChartColor = (value: string): boolean =>
  isTemplate(value) ? isValidColorTemplate(value) : isRadixToken(value)

const ColorSchema = z
  .string()
  .min(1)
  .describe(
    "Color source: an entity property template ('{code:color}'), a column template ('{column}') where the column holds Radix tokens or hex, or a Radix token literal (e.g. 'blue') for a single-color layer. For categories that carry no color of their own, join a VALUES list mapping category to Radix token and reference its column — CASE and string expressions are rejected."
  )
  .refine(isValidChartColor, {
    message:
      "color must be a Radix token (e.g. 'blue'), a column template ('{column}'), or an entity property template ('{code:color}')",
  })

const HeatmapColorSchema = z
  .string()
  .min(1)
  .describe(
    "A single Radix token literal (e.g. 'blue'). It seeds the value→shade ramp — cells map their value onto this one token's shade scale — so templates and hex values are not accepted here."
  )
  .refine(isRadixToken, {
    message:
      "heatmap color must be a single Radix token (e.g. 'blue') — it seeds the value→shade ramp",
  })

const FieldBindingObjectSchema = z.object({
  field: z.string().min(1).describe("Column name from the SQL result"),
  label: z.string().optional().describe("Axis / legend label override"),
  format: z
    .string()
    .optional()
    .describe(
      "d3-format specifier (e.g. ',.0f', '.1%', '$,.0f') or d3-time-format pattern (e.g. '%b %Y')"
    ),
})

const FieldBindingSchema = z
  .union([z.string().min(1), FieldBindingObjectSchema])
  .describe("Column name shorthand or { field, label?, format? } object")

const OrientationSchema = z
  .enum(["vertical", "horizontal"])
  .describe(
    "The direction bars run. 'vertical' (default): bars rise upward, categories along the horizontal edge. 'horizontal': bars run sideways, categories along the vertical edge. The bindings never swap — x stays the category binding and each layer's y stays the measure in both orientations."
  )

const AxisSideSchema = z
  .enum(["left", "right"])
  .describe(
    "Which y-axis scales this layer. Use 'right' only when this layer's unit genuinely differs from the left axis's (a ratio over counts); layers with the same unit share the left axis."
  )

const TooltipSchema = z
  .string()
  .optional()
  .describe(
    "Tooltip template with {column} / {column:format} / {column:property} placeholders. Entity IDs render as pills."
  )

const BandSchema = z.object({
  from: z
    .union([z.string(), z.number()])
    .describe("First x-axis value the band covers, exactly as the query returns it"),
  to: z
    .union([z.string(), z.number()])
    .describe("Last x-axis value the band covers, exactly as the query returns it"),
  label: z.string().optional().describe("Caption drawn inside the band, e.g. 'Polar night'"),
})

const BandsSchema = z
  .array(BandSchema)
  .optional()
  .describe(
    "Shaded x-axis regions marking context the data does not carry. Edges snap to whole categories on a category axis."
  )

const LayerYSchema = FieldBindingSchema.describe(
  "This layer's measure column. Each layer binds its own value column — two measure columns in the result are two layers, never an UNPIVOT."
)

const LayerSeriesSchema = FieldBindingSchema.optional().describe(
  "Optional category column: the layer splits into one drawn series per distinct value. Use series when categories arrive as row values; use another layer when they arrive as columns."
)

const StackSchema = z
  .boolean()
  .default(false)
  .describe(
    "Stack this layer's series (and other stacked layers of the same mark and axis side) instead of drawing them side by side or overlapping. Stacking is always said, never implied."
  )

const layerFields = {
  y: LayerYSchema,
  series: LayerSeriesSchema,
  color: ColorSchema,
  axis: AxisSideSchema.default("left"),
}

const stackableLayerSchema = <M extends string>(mark: M) =>
  z.strictObject({ mark: z.literal(mark), ...layerFields, stack: StackSchema })

const unstackableLayerSchema = <M extends string>(mark: M) =>
  z.strictObject({ mark: z.literal(mark), ...layerFields })

export const ChartLayerSchema = z.discriminatedUnion("mark", [
  stackableLayerSchema("bar"),
  unstackableLayerSchema("line"),
  stackableLayerSchema("area"),
  unstackableLayerSchema("scatter"),
])

export const AxisChartSpecSchema = z.object({
  type: z.literal("axis"),
  x: FieldBindingSchema.describe(
    "Column for the independent axis — the category or time dimension every layer shares. Always x, whichever direction the bars run."
  ),
  orientation: OrientationSchema.default("vertical"),
  layers: z
    .array(ChartLayerSchema)
    .min(1)
    .describe(
      "One drawn layer per mark, minimum one. Distinct measure columns in the result → one layer each; categories arriving as values in a column → one layer with series bound to that column."
    ),
  bands: BandsSchema,
  tooltip: TooltipSchema,
})

const PartChartSpecSchema = z.object({
  type: z.enum(["pie", "treemap"]),
  label: FieldBindingSchema,
  value: FieldBindingSchema,
  parent: FieldBindingSchema.optional().describe(
    "Accepted and validated against the query; the treemap currently renders flat, so it changes nothing visually."
  ),
  color: ColorSchema,
  tooltip: TooltipSchema,
})

const MatrixChartSpecSchema = z.object({
  type: z.literal("heatmap"),
  x: FieldBindingSchema,
  y: FieldBindingSchema,
  value: FieldBindingSchema,
  color: HeatmapColorSchema,
  tooltip: TooltipSchema,
})

export const ChartSpecSchema = z.discriminatedUnion("type", [
  AxisChartSpecSchema,
  PartChartSpecSchema,
  MatrixChartSpecSchema,
])

const CaptionSchema = z.object({
  label: z.string().describe("Caption label displayed below the chart, e.g. 'Revenue by Region'"),
})

export const ChartSchema = z.object({
  id: z.string(),
  caption: CaptionSchema,
  query: z
    .string()
    .describe("SQL query against database tables.")
    .refine((q) => !containsSemanticCall(q), {
      message: "SEMANTIC() is a search-only function and cannot be used in chart queries.",
    }),
  spec: ChartSpecSchema,
})

export type ChartBlock = z.infer<typeof ChartSchema>
export type { ChartSpec } from "~/lib/chart/types"

export const parseChart = (content: string): ChartBlock | null => {
  try {
    const json = JSON.parse(content)
    const result = ChartSchema.safeParse(json)
    return result.success ? result.data : null
  } catch {
    return null
  }
}
