import { z } from "zod"
import { BLOCK_COLORS } from "~/ui/theme/colors"
import { isTemplate } from "~/lib/chart/template"
import type { ChartSpec } from "~/lib/chart/types"

export type { ChartSpec } from "~/lib/chart/types"

export interface ChartBlock {
  id: string
  caption: { label: string }
  query: string
  spec: ChartSpec
}

const RADIX_TOKEN_SET = new Set<string>(BLOCK_COLORS)

const containsSemanticCall = (sql: string): boolean => /\bSEMANTIC\s*\(/i.test(sql)

const isRadixToken = (value: string): boolean => RADIX_TOKEN_SET.has(value)

const isColorTemplate = (value: string): boolean => isTemplate(value)

const isValidChartColor = (value: string): boolean => isColorTemplate(value) || isRadixToken(value)

const ColorSchema = z
  .string()
  .min(1)
  .describe(
    "Color source: an entity property template ('{code:color}'), a column template ('{column}') where the column holds Radix tokens or hex, or a Radix token literal (e.g. 'blue') for a single-color chart. For categories that carry no color of their own, join a VALUES list mapping category to Radix token and reference its column — CASE and string expressions are rejected."
  )
  .refine(isValidChartColor, {
    message:
      "color must be a Radix token (e.g. 'blue'), a column template ('{column}'), or an entity property template ('{code:color}')",
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

const OrientationSchema = z.enum(["horizontal", "vertical"])

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

const AxisChartSpecSchema = z.object({
  type: z.enum(["bar", "stacked-bar", "grouped-bar", "line", "area", "scatter"]),
  x: FieldBindingSchema,
  y: FieldBindingSchema,
  series: FieldBindingSchema.optional().describe(
    "Optional series/group field for stacking or multi-line"
  ),
  orientation: OrientationSchema.optional(),
  color: ColorSchema,
  tooltip: TooltipSchema,
  bands: BandsSchema,
})

const PartChartSpecSchema = z.object({
  type: z.enum(["pie", "treemap"]),
  label: FieldBindingSchema,
  value: FieldBindingSchema,
  parent: FieldBindingSchema.optional().describe("Parent field for hierarchical treemap layouts"),
  color: ColorSchema,
  tooltip: TooltipSchema,
})

const MatrixChartSpecSchema = z.object({
  type: z.literal("heatmap"),
  x: FieldBindingSchema,
  y: FieldBindingSchema,
  value: FieldBindingSchema,
  color: ColorSchema,
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

export const parseChart = (content: string): ChartBlock | null => {
  try {
    const json = JSON.parse(content)
    const result = ChartSchema.safeParse(json)
    return result.success ? (result.data as ChartBlock) : null
  } catch {
    return null
  }
}
