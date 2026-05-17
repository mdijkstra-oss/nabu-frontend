import { z } from "zod"
import type { Annotation } from "./types"
import { callAndParse } from "../../client/call-parse"
import { TRIM_ENDPOINT } from "./def"

export interface TrimStepResult {
  annotations: Annotation[]
  error?: string
}

const TrimResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.number().int().min(0),
      start: z.number().int().min(1),
      end: z.number().int().min(1),
    })
  ),
})

const buildTrimMessages = (
  sentences: string[],
  annotations: Annotation[]
): { type: "message"; role: "system" | "user"; content: string }[] => {
  const numbered = sentences.map((s, i) => `[${i + 1}] ${s}`).join("\n")

  const passages = annotations.map((a, i) => ({
    id: i,
    start: a.start,
    end: a.end,
    reason: a.reason,
  }))

  const passagesJson = JSON.stringify(passages, null, 2)

  return [
    {
      type: "message",
      role: "system",
      content: [
        "You receive numbered sentences and a list of coded passages.",
        "Each passage has an id, a start and end sentence number, and",
        "a reason explaining what feature of the passage satisfies its code.",
        "",
        "For each passage, find the smallest contiguous range of",
        "sentences that contains the feature described in the reason.",
        "Drop sentences that only introduce, set up, elaborate, or",
        "echo the coded feature.",
        "",
        "A passage cannot shrink below one sentence.",
      ].join("\n"),
    },
    {
      type: "message",
      role: "user",
      content: `## Sentences\n\n${numbered}\n\n## Coded passages\n\n${passagesJson}`,
    },
  ]
}

const clampBounds = (
  trimmed: { start: number; end: number },
  original: Annotation
): { start: number; end: number } => {
  const start = Math.max(trimmed.start, original.start)
  const end = Math.min(trimmed.end, original.end)
  return start <= end ? { start, end } : { start: original.start, end: original.end }
}

export const trimAnnotations = async (
  annotations: Annotation[],
  sentences: string[]
): Promise<TrimStepResult> => {
  const withReasons = annotations.filter((a) => a.reason !== "")

  if (withReasons.length === 0) return { annotations }

  const messages = buildTrimMessages(sentences, withReasons)
  const result = await callAndParse(TRIM_ENDPOINT, messages, TrimResultSchema)

  if (!result.ok) {
    console.debug(`[deep-analysis] trim failed: ${result.error}`)
    return { annotations, error: result.error }
  }

  const trimMap = new Map<number, { start: number; end: number }>()
  for (const r of result.data.results) {
    trimMap.set(r.id, { start: r.start, end: r.end })
  }

  const reasonedSet = new Set(withReasons)
  let reasonIndex = 0
  let changed = 0
  const trimmed = annotations.map((a) => {
    if (!reasonedSet.has(a)) return a
    const idx = reasonIndex++
    const t = trimMap.get(idx)
    if (!t) return a
    const clamped = clampBounds(t, a)
    if (clamped.start === a.start && clamped.end === a.end) return a
    changed++
    return { ...a, start: clamped.start, end: clamped.end }
  })

  if (changed > 0) {
    console.debug(`[deep-analysis] trim: ${changed}/${annotations.length} span(s) tightened`)
  }

  return { annotations: trimmed }
}
