import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import { buildSpanStepMessages, FILTER_CTA, buildFilterSchema } from "./messages"
import { groupBySpan, countKeys, type CodedSpan } from "./consensus"
import { formatCodedSection, type CodedItem } from "./present"
import { spanKey } from "./format"
import { FILTER_ENDPOINT, FILTER_RUNS, FILTER_THRESHOLD, SPAN_STEP_CONTEXT_SENTENCES } from "./def"

export interface FilterStepResult {
  undisputed: Annotation[]
  disputed: Annotation[]
  dropped: Annotation[]
  errors: string[]
}

interface FilterHit {
  key: string
  justification: string
}

const collectCodeIds = (spans: CodedSpan[]): Set<string> => {
  const ids = new Set<string>()
  for (const s of spans) for (const c of s.codings) ids.add(c)
  return ids
}

const toCodedItems = (spans: CodedSpan[]): CodedItem[] =>
  spans.map((s) => ({ start: s.start, end: s.end, codings: s.codings }))

const mapFilterResults = (
  results: { id: number; code: string; removalJustification: string }[],
  mapping: { index: number; start: number; end: number }[]
): FilterHit[] =>
  results.flatMap((r) => {
    const m = mapping.find((entry) => entry.index === r.id)
    return m
      ? [{ key: spanKey(m.start, m.end, r.code), justification: r.removalJustification }]
      : []
  })

const annotationKey = (a: Annotation): string => spanKey(a.start, a.end, a.code)

export const filterAnnotations = async (
  annotations: Annotation[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<FilterStepResult> => {
  if (annotations.length === 0) return { undisputed: [], disputed: [], dropped: [], errors: [] }

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
    FILTER_CTA
  )

  const validCodes = [...codeIds]
  const schema = buildFilterSchema(validCodes)
  const errors: string[] = []
  const slots = Array.from({ length: FILTER_RUNS }, (_, i) => i)
  const { results: rawRuns, failures } = await processPool<number, FilterHit[]>(
    slots,
    async (slot) => {
      const endpoint = `${FILTER_ENDPOINT}?model=${slot % 2}`
      const result = await callAndParse(endpoint, messages, schema)
      if (!result.ok) {
        errors.push(result.error)
        return []
      }
      return [mapFilterResults(result.data.results, mapping)]
    },
    noop,
    { concurrency: 3 }
  )
  for (const f of failures) errors.push(errorMessage(f.error))

  if (rawRuns.length === 0) {
    const allWithVotes = annotations.map((a) => ({
      ...a,
      filterVotes: Array.from({ length: FILTER_RUNS }, () => true),
    }))
    return { undisputed: allWithVotes, disputed: [], dropped: [], errors }
  }

  const keyRuns = rawRuns.map((hits) => hits.map((h) => h.key))
  const votes = countKeys(keyRuns)
  const rejected = new Set(
    [...votes.entries()].filter(([, v]) => v >= FILTER_THRESHOLD).map(([k]) => k)
  )

  const allKeys = new Set(annotations.map(annotationKey))
  const filterVotesMap = new Map<string, boolean[]>()
  for (const key of allKeys) {
    const perVoter = rawRuns.map((hits) => !hits.some((h) => h.key === key))
    filterVotesMap.set(key, perVoter)
  }

  const disputedKeys = new Set<string>()
  for (const key of allKeys) {
    if (rejected.has(key)) continue
    const dissent = rawRuns.flatMap((hits) => hits.filter((h) => h.key === key))
    if (dissent.length > 0) disputedKeys.add(key)
  }

  const undisputed: Annotation[] = []
  const disputed: Annotation[] = []
  const dropped: Annotation[] = []
  for (const a of annotations) {
    const key = annotationKey(a)
    const enriched = { ...a, filterVotes: filterVotesMap.get(key) ?? [] }
    if (rejected.has(key)) {
      dropped.push(enriched)
    } else if (disputedKeys.has(key)) {
      disputed.push(enriched)
    } else {
      undisputed.push(enriched)
    }
  }

  return { undisputed, disputed, dropped, errors }
}
