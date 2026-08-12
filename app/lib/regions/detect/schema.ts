import { z } from "zod"
import type { RegionValueType } from "~/lib/regions/kinds/registry"

const ISO_8601_SHAPE = /^\d{4}-\d{2}-\d{2}([T ].+)?$/

const valueField = (valueType: RegionValueType): z.ZodString =>
  valueType === "datetime"
    ? z.string().regex(ISO_8601_SHAPE).describe("the date this occurrence names, ISO-8601")
    : z.string().describe("the value this occurrence resolves to")

// `results` wrapper — several providers reject a top-level JSON array as structured output.
export const buildFindSchema = (valueType: RegionValueType) =>
  z.object({
    results: z.array(
      z.object({
        quote: z.string().describe("the phrase in the text this occurrence is named by"),
        sentence: z.number().int().min(1).describe("the number of the sentence it sits in"),
        value: valueField(valueType),
      })
    ),
  })

export type FindResult = z.infer<ReturnType<typeof buildFindSchema>>["results"][number]

// `results` wrapper — several providers reject a top-level JSON array as structured output.
export const markSchema = z.object({
  results: z.array(
    z.object({
      start: z.number().int().min(1).describe("the number of the first sentence it owns"),
      end: z.number().int().min(1).describe("the number of the last sentence it owns"),
    })
  ),
})

export type MarkResult = z.infer<typeof markSchema>["results"][number]
