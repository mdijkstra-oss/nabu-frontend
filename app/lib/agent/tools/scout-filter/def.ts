import { z } from "zod"

export const SCOUT_FILTER_ENDPOINT = "/scout-filter"

const ExcludeRange = z.object({
  from: z.number().int().min(1).describe("First entry id in the excluded range"),
  to: z.number().int().min(1).describe("Last entry id in the excluded range"),
  reason: z.string().describe("Why these entries fall outside analysis scope"),
})

// Wrapper object — some providers reject a top-level JSON array as structured output.
export const ScoutFilterResponse = z.object({
  exclude: z.array(ExcludeRange).describe("Ranges of entry ids to exclude from analysis"),
})

export type ScoutFilterResponse = z.infer<typeof ScoutFilterResponse>
