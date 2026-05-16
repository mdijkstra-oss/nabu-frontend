import type { z } from "zod"
import type { Splitter } from "~/lib/text/types"
import { splitByParagraphs } from "~/lib/text/split"
import { callLlm } from "../../client/fetch"
import { extractText, toResponseFormat } from "../../client/convert"
import { ScoutFilterResponse, SCOUT_FILTER_ENDPOINT } from "./def"
import { numberParagraphs, buildScoutFilterMessages, type NumberedParagraph } from "./messages"

export interface FilterResult {
  surviving: NumberedParagraph[]
  excludedIndices: Set<number>
}

const expandRanges = (ranges: ScoutFilterResponse["exclude"]): Set<number> => {
  const set = new Set<number>()
  for (const { from, to } of ranges) {
    for (let i = from; i <= to; i++) set.add(i)
  }
  return set
}

const tryParseJson = (text: string): unknown | undefined => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const callAndParse = async <T>(
  endpoint: string,
  messages: { type: "message"; role: "system" | "user"; content: string }[],
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
  const blocks = await callLlm({
    endpoint,
    messages,
    responseFormat: toResponseFormat(schema),
  })

  const text = extractText(blocks)
  if (!text) return { ok: false, error: "LLM returned no text response" }

  const raw = tryParseJson(text)
  if (raw === undefined) return { ok: false, error: "LLM returned invalid JSON" }

  const parsed = schema.safeParse(raw)
  if (!parsed.success)
    return { ok: false, error: `Schema validation failed: ${parsed.error.message}` }

  return { ok: true, data: parsed.data }
}

export const filterTarget = async (
  framework: string,
  content: string,
  splitter: Splitter = splitByParagraphs
): Promise<FilterResult> => {
  const paragraphs = numberParagraphs(content, splitter)

  if (paragraphs.length === 0) {
    return { surviving: [], excludedIndices: new Set() }
  }

  const messages = buildScoutFilterMessages(framework, paragraphs)
  const result = await callAndParse(SCOUT_FILTER_ENDPOINT, messages, ScoutFilterResponse)

  if (!result.ok) {
    throw new Error(`scout-filter failed: ${result.error}`)
  }

  const excludedIndices = expandRanges(result.data.exclude)
  const surviving = paragraphs.filter((p) => !excludedIndices.has(p.index))

  const rangesSummary = result.data.exclude
    .map((r) => `  [${r.from}-${r.to}] ${r.reason}`)
    .join("\n")
  console.debug(
    `[scout-filter] ${excludedIndices.size}/${paragraphs.length} paragraphs excluded\n${rangesSummary}`
  )

  return { surviving, excludedIndices }
}
