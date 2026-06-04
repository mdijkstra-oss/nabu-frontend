import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { buildSpanStepMessages, FILTER_CTA, buildFilterSchema } from "./messages"
import { groupBySpan, type CodedSpan } from "./consensus"
import { formatCodedSection, type CodedItem } from "./present"
import { spanKey } from "./format"
import { FILTER_ENDPOINT, FILTER_RUNS, SPAN_STEP_CONTEXT_SENTENCES } from "./def"
import { shouldShowModelIndex } from "./debug-flags"

export type FilterStats = Map<string, [number, number]>

export interface FilterStepResult {
  surviving: Annotation[]
  removed: Annotation[]
  errors: string[]
  stats: FilterStats
}

interface Judgment {
  judgment: string
  reason: string
}

interface IndexedJudgment {
  idx: number
  judgment: Judgment
}

interface MergedJudgment {
  outcome: "keep" | "remove" | "contested"
  reason: string
  review?: string
}

const collectCodeIds = (spans: CodedSpan[]): Set<string> => {
  const ids = new Set<string>()
  for (const s of spans) for (const c of s.codings) ids.add(c)
  return ids
}

const toCodedItems = (spans: CodedSpan[]): CodedItem[] =>
  spans.map((s) => ({ start: s.start, end: s.end, codings: s.codings }))

const annotationKey = (a: Annotation): string => spanKey(a.start, a.end, a.code)

const isKeep = (v: IndexedJudgment): boolean => v.judgment.judgment === "keep"

const isRemove = (v: IndexedJudgment): boolean => v.judgment.judgment === "remove"

const pickReason = (reasons: string[]): string => reasons[0] ?? ""

const formatIndexedReasons = (votes: IndexedJudgment[]): string =>
  votes.map((v) => `${v.idx}: ${v.judgment.reason}`).join("\n")

const formatRemoveReview = (removes: IndexedJudgment[]): string =>
  shouldShowModelIndex() ? formatIndexedReasons(removes) : (removes[0]?.judgment.reason ?? "")

const mergeVotes = (votes: IndexedJudgment[]): MergedJudgment => {
  const keeps = votes.filter(isKeep)
  const removes = votes.filter(isRemove)

  if (removes.length === votes.length) return { outcome: "remove", reason: "" }

  if (keeps.length === votes.length) {
    const reason = pickReason(keeps.map((k) => k.judgment.reason))
    return { outcome: "keep", reason }
  }

  const keepReason = keeps[0]?.judgment.reason ?? ""
  const removeReason = formatRemoveReview(removes)
  return { outcome: "contested", reason: keepReason, review: removeReason }
}

const callFilterModel = async (
  modelIdx: number,
  messages: { type: "message"; role: "system" | "user"; content: string }[],
  validCodes: string[]
) => {
  const schema = buildFilterSchema(validCodes)
  const endpoint = `${FILTER_ENDPOINT}?model=${modelIdx}`
  return callAndParse(endpoint, messages, schema)
}

export const filterAnnotations = async (
  annotations: Annotation[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<FilterStepResult> => {
  if (annotations.length === 0) return { surviving: [], removed: [], errors: [], stats: new Map() }

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
  const modelCalls = Array.from({ length: FILTER_RUNS }, (_, i) =>
    callFilterModel(i, messages, validCodes)
  )
  const results = await Promise.all(modelCalls)

  const errors: string[] = []
  const perModelJudgments: Map<string, Judgment>[] = []
  const stats: FilterStats = new Map()

  for (let idx = 0; idx < results.length; idx++) {
    const result = results[idx]
    const judgments = new Map<string, Judgment>()
    if (!result.ok) {
      errors.push(result.error)
    } else {
      for (const r of result.data.results) {
        const m = mapping.find((entry) => entry.index === r.id)
        if (!m) continue
        judgments.set(spanKey(m.start, m.end, r.code), { judgment: r.judgment, reason: r.reason })
        if (r.judgment === "keep") {
          const entry = stats.get(r.code) ?? [0, 0]
          entry[idx] += 1
          stats.set(r.code, entry)
        }
      }
    }
    perModelJudgments.push(judgments)
  }

  const surviving: Annotation[] = []
  const removed: Annotation[] = []

  for (const a of annotations) {
    const key = annotationKey(a)
    const votes: IndexedJudgment[] = []
    for (let idx = 0; idx < perModelJudgments.length; idx++) {
      const entry = perModelJudgments[idx].get(key)
      if (entry) votes.push({ idx, judgment: entry })
    }

    if (votes.length === 0) {
      surviving.push(a)
      continue
    }

    const merged = mergeVotes(votes)
    switch (merged.outcome) {
      case "remove":
        removed.push(a)
        break
      case "keep":
        surviving.push({ ...a, reason: merged.reason })
        break
      case "contested":
        surviving.push({ ...a, reason: merged.reason, review: merged.review })
        break
      default:
        throw new Error(`unknown filter outcome: ${merged.outcome}`)
    }
  }

  return { surviving, removed, errors, stats }
}
