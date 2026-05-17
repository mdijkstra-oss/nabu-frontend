import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { buildSpanStepMessages, ADJUDICATE_CTA, buildAdjudicateSchema } from "./messages"
import { groupBySpan, type CodedSpan } from "./consensus"
import { formatCodedSection, type CodedItem } from "./present"
import { spanKey } from "./format"
import { ADJUDICATE_ENDPOINT, SPAN_STEP_CONTEXT_SENTENCES } from "./def"

export interface AdjudicateStepResult {
  surviving: Annotation[]
  removed: Annotation[]
  errors: string[]
}

const collectCodeIds = (spans: CodedSpan[]): Set<string> => {
  const ids = new Set<string>()
  for (const s of spans) for (const c of s.codings) ids.add(c)
  return ids
}

const toCodedItems = (spans: CodedSpan[]): CodedItem[] =>
  spans.map((s) => ({ start: s.start, end: s.end, codings: s.codings }))

const annotationKey = (a: Annotation): string => spanKey(a.start, a.end, a.code)

export const adjudicateAnnotations = async (
  annotations: Annotation[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<AdjudicateStepResult> => {
  if (annotations.length === 0) return { surviving: [], removed: [], errors: [] }

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
    ADJUDICATE_CTA
  )

  const validCodes = [...codeIds]
  const schema = buildAdjudicateSchema(validCodes)
  const result = await callAndParse(ADJUDICATE_ENDPOINT, messages, schema)

  if (!result.ok) {
    return { surviving: annotations, removed: [], errors: [result.error] }
  }

  const judgmentByKey = new Map<string, { judgment: string; reason: string }>()
  for (const r of result.data.results) {
    const m = mapping.find((entry) => entry.index === r.id)
    if (!m) continue
    judgmentByKey.set(spanKey(m.start, m.end, r.code), { judgment: r.judgment, reason: r.reason })
  }

  const surviving: Annotation[] = []
  const removed: Annotation[] = []
  for (const a of annotations) {
    const key = annotationKey(a)
    const entry = judgmentByKey.get(key)
    if (!entry || entry.judgment === "keep") {
      surviving.push(a)
    } else if (entry.judgment === "remove") {
      removed.push(a)
    } else {
      surviving.push({ ...a, review: entry.reason })
    }
  }

  return { surviving, removed, errors: [] }
}
