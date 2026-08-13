import { z } from "zod"
import { REGION_KIND_IDS, REGION_VALUE_TYPES } from "~/lib/regions/kinds/registry"

const sentenceIndex = z.number().int().min(0)

// The range triple is all-or-nothing: a stored occurrence the model never bounded
// keeps its hit and carries no range, and there is no sentinel for that state.
const hasWholeRange = (r: {
  startSentence?: number
  endSentence?: number
  rangeHash?: string
}): boolean => {
  const present = [r.startSentence, r.endSentence, r.rangeHash].filter(
    (v) => v !== undefined
  ).length
  return present === 0 || present === 3
}

const endsAfterItStarts = (r: { startSentence?: number; endSentence?: number }): boolean =>
  r.startSentence === undefined || r.endSentence === undefined || r.endSentence >= r.startSentence

export const regionRowSchema = z
  .object({
    kind: z.enum(REGION_KIND_IDS),
    parsed: z.object({
      type: z.enum(REGION_VALUE_TYPES),
      value: z.string(),
    }),
    quote: z.string(),
    hitSentence: sentenceIndex,
    startSentence: sentenceIndex.optional(),
    endSentence: sentenceIndex.optional(),
    rangeHash: z.string().optional(),
  })
  .refine(
    hasWholeRange,
    "startSentence, endSentence and rangeHash must all be present or all absent"
  )
  .refine(endsAfterItStarts, "endSentence must not precede startSentence")

export const scannedUnitSchema = z.object({
  hash: z.string(),
  firstSentence: sentenceIndex,
  rules: z.string().optional(),
})

export const regionsBlockSchema = () =>
  z.object({
    regions: z.array(regionRowSchema),
    scanned: z.record(z.string(), z.array(scannedUnitSchema)),
  })

export const RegionsBlockSchema = regionsBlockSchema()

export type RegionRow = z.infer<typeof regionRowSchema>
export type ScannedUnit = z.infer<typeof scannedUnitSchema>
export type RegionsBlock = z.infer<typeof RegionsBlockSchema>

export type ResolvedRegionRow = RegionRow & {
  startSentence: number
  endSentence: number
  rangeHash: string
}

export const isResolved = (row: RegionRow): row is ResolvedRegionRow =>
  row.startSentence !== undefined && row.endSentence !== undefined
