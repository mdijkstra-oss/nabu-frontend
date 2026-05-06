import { z } from "zod"
import { callLlm } from "../client/fetch"
import { toResponseFormat, extractText } from "../client/convert"

export const ScoutSection = z.object({
  label: z.string().describe("Short name for this section, 2-5 words"),
  start_line: z.number().int().min(1).describe("1-based first line of this section"),
  end_line: z.number().int().min(1).describe("1-based last line of this section"),
  desc: z.string().optional().describe("Brief description of section contents"),
  keywords: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe(
      "Key names, topics, and entities present in this section — no interpretation, just what's concretely there."
    ),
})

export type ScoutSection = z.infer<typeof ScoutSection>

export interface ScoutMap {
  sections: ScoutSection[]
}

const SectionLabelResponse = z.object({
  label: z.string().describe("Short name for this section, 2-5 words"),
  desc: z
    .string()
    .describe("What the section contains — specific enough for a planner to decide scope"),
  keywords: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe("Salient terms concretely present in the section. No interpretation, no inference."),
})

export type SectionLabel = z.infer<typeof SectionLabelResponse>

const LABELER_ENDPOINT = "/section-labeler"

export const labelSection = async (text: string): Promise<SectionLabel> => {
  const blocks = await callLlm({
    endpoint: LABELER_ENDPOINT,
    messages: [{ type: "message", role: "user", content: `${text}\n\nLabel this section.` }],
    responseFormat: toResponseFormat(SectionLabelResponse),
  })

  const raw = extractText(blocks)
  if (!raw) throw new Error("Section labeler returned empty response")

  const result = SectionLabelResponse.safeParse(JSON.parse(raw))
  if (!result.success) throw new Error(`Invalid labeler response: ${result.error.message}`)

  return result.data
}
