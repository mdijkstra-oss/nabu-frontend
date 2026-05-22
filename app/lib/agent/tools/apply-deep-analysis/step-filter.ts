import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { buildSpanStepMessages, FILTER_CTA, buildFilterSchema } from "./messages"
import { groupBySpan, type CodedSpan } from "./consensus"
import { formatCodedSection, type CodedItem } from "./present"
import { spanKey } from "./format"
import { FILTER_ENDPOINT, FILTER_RUNS, SPAN_STEP_CONTEXT_SENTENCES } from "./def"

export interface FilterStepResult {
  surviving: Annotation[]
  removed: Annotation[]
  errors: string[]
}

interface Judgment {
  judgment: string
  reason: string
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

const isKeep = (j: Judgment): boolean => j.judgment === "keep"

const pickReason = (reasons: string[]): string => reasons[0] ?? ""

const mergeVotes = (votes: Judgment[]): MergedJudgment => {
  const keeps = votes.filter(isKeep)
  const removes = votes.filter((j) => j.judgment === "remove")

  if (removes.length === votes.length) return { outcome: "remove", reason: "" }

  if (keeps.length === votes.length) {
    const reason = pickReason(keeps.map((k) => k.reason))
    return { outcome: "keep", reason }
  }

  const keepReason = keeps[0]?.reason ?? ""
  const removeReason = removes[0]?.reason ?? ""
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
    FILTER_CTA
  )

  const validCodes = [...codeIds]
  const modelCalls = Array.from({ length: FILTER_RUNS }, (_, i) =>
    callFilterModel(i, messages, validCodes)
  )
  const results = await Promise.all(modelCalls)

  const errors: string[] = []
  const perModelJudgments: Map<string, Judgment>[] = []

  for (let ri = 0; ri < results.length; ri++) {
    const result = results[ri]
    const judgments = new Map<string, Judgment>()
    if (!result.ok) {
      errors.push(result.error)
      console.debug(`[deep-analysis] filter model-${ri} error: ${result.error}`)
    } else {
      for (const r of result.data.results) {
        const m = mapping.find((entry) => entry.index === r.id)
        if (!m) continue
        judgments.set(spanKey(m.start, m.end, r.code), { judgment: r.judgment, reason: r.reason })
      }
    }
    perModelJudgments.push(judgments)
  }

  const modelSizes = perModelJudgments.map((m, i) => `model-${i}:${m.size}`).join(", ")
  console.debug(`[deep-analysis] filter votes: ${modelSizes}, errors: ${errors.length}`)
  for (let i = 0; i < perModelJudgments.length; i++) {
    console.debug(
      `[deep-analysis] filter model-${i} keys: ${[...perModelJudgments[i].keys()].sort().join(", ")}`
    )
  }

  const surviving: Annotation[] = []
  const removed: Annotation[] = []
  let underVoted = 0

  for (const a of annotations) {
    const key = annotationKey(a)
    const votes: Judgment[] = []
    for (const judgments of perModelJudgments) {
      const entry = judgments.get(key)
      if (entry) votes.push(entry)
    }

    if (votes.length < FILTER_RUNS) {
      underVoted++
      console.debug(`[deep-analysis] filter under-voted: ${key} (${votes.length}/${FILTER_RUNS})`)
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

  if (underVoted > 0) console.debug(`[deep-analysis] filter: ${underVoted} under-voted annotations`)

  return { surviving, removed, errors }
}
