import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { z } from "zod"
import { buildSpanStepMessages, REASON_CTA } from "./messages"
import { groupBySpan, type CodedSpan } from "./consensus"
import { formatCodedSection, type CodedItem } from "./present"
import { spanKey } from "./format"
import { REASON_ENDPOINT, SPAN_STEP_CONTEXT_SENTENCES } from "./def"

export interface ReasonStepResult {
  annotations: Annotation[]
  error?: string
}

const collectCodeIds = (spans: CodedSpan[]): Set<string> => {
  const ids = new Set<string>()
  for (const s of spans) for (const c of s.codings) ids.add(c)
  return ids
}

const toCodedItems = (spans: CodedSpan[]): CodedItem[] =>
  spans.map((s) => ({ start: s.start, end: s.end, codings: s.codings }))

const buildReasonSchema = (validCodes: string[]) =>
  z.object({
    results: z.array(
      z.object({
        id: z.number().int().min(1),
        code: validCodes.length > 0 ? z.enum(validCodes as [string, ...string[]]) : z.string(),
        justification: z.string(),
      })
    ),
  })

export const reasonAnnotations = async (
  annotations: Annotation[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<ReasonStepResult> => {
  if (annotations.length === 0) return { annotations: [] }

  const grouped = groupBySpan(
    annotations.map((a) => ({ start: a.start, end: a.end, analysis_source_id: a.code }))
  )
  const codeIds = collectCodeIds(grouped)
  const codedItems = toCodedItems(grouped)
  const { text: presented, mapping } = formatCodedSection(
    sentences,
    codedItems,
    SPAN_STEP_CONTEXT_SENTENCES
  )

  const messages = buildSpanStepMessages(
    presented,
    codeIds,
    sources,
    leadingCtx,
    trailingCtx,
    resolve,
    REASON_CTA
  )

  const validCodes = [...codeIds]
  const schema = buildReasonSchema(validCodes)
  const result = await callAndParse(REASON_ENDPOINT, messages, schema)

  if (!result.ok) {
    console.debug(`[deep-analysis] reason failed: ${result.error}`)
    return { annotations, error: result.error }
  }

  const reasonMap = new Map<string, string>()
  for (const r of result.data.results) {
    const m = mapping.find((entry) => entry.index === r.id)
    if (!m) continue
    reasonMap.set(spanKey(m.start, m.end, r.code), r.justification)
  }

  if (reasonMap.size > 0) {
    console.debug(`[deep-analysis] reason: ${reasonMap.size} span(s)`)
  }

  const enriched = annotations.map((a) => {
    const key = spanKey(a.start, a.end, a.code)
    const reason = reasonMap.get(key)
    return reason !== undefined ? { ...a, reason } : a
  })

  return { annotations: enriched }
}
