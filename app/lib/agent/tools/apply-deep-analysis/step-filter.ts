import type { Envelope } from "./envelope"
import type { ScopedSources, ContentResolver } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { buildFilterMessages, FILTER_CTA, buildFilterSchema } from "./messages"
import { renderEnvelopeBlocks } from "./triplet"
import { collectCodeIds } from "./envelope"
import { FILTER_ENDPOINT, FILTER_RUNS, SPAN_STEP_CONTEXT_SENTENCES } from "./def"
import { shouldShowModelIndex } from "./debug-flags"
import type { Tracer, FilterEntry, FilterOutcome, FilterVote } from "./trace"

export type FilterStats = Map<string, [number, number]>

export interface FilterStepResult {
  surviving: Envelope[]
  removed: Envelope[]
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

const buildVoteList = (
  envelopeId: string,
  perModelJudgments: readonly Map<string, Judgment>[]
): FilterVote[] => {
  const out: FilterVote[] = []
  for (let idx = 0; idx < perModelJudgments.length; idx++) {
    const entry = perModelJudgments[idx].get(envelopeId)
    if (entry) {
      const judgment = entry.judgment === "keep" ? "keep" : "remove"
      out.push({ modelIdx: idx, judgment, reason: entry.reason })
    } else {
      out.push({ modelIdx: idx, judgment: "missing", reason: "no response" })
    }
  }
  return out
}

export const filterEnvelopes = async (
  envelopes: Envelope[],
  sources: ScopedSources,
  resolve: ContentResolver,
  tracer?: Tracer
): Promise<FilterStepResult> => {
  if (envelopes.length === 0) return { surviving: [], removed: [], errors: [], stats: new Map() }
  tracer?.setVoterCount(FILTER_RUNS)

  const codeIds = collectCodeIds(envelopes)
  const { blocks, mapping } = renderEnvelopeBlocks(envelopes, SPAN_STEP_CONTEXT_SENTENCES)
  const messages = buildFilterMessages(blocks, codeIds, sources, resolve, FILTER_CTA)

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
        judgments.set(m.envelopeId, { judgment: r.judgment, reason: r.reason })
        if (r.judgment === "keep") {
          const entry = stats.get(r.code) ?? [0, 0]
          entry[idx] += 1
          stats.set(r.code, entry)
        }
      }
    }
    perModelJudgments.push(judgments)
  }

  const surviving: Envelope[] = []
  const removed: Envelope[] = []

  for (const env of envelopes) {
    const traceVotes = buildVoteList(env.id, perModelJudgments)
    const traceEntry = (outcome: FilterOutcome): FilterEntry => ({
      code: env.code,
      start: env.markedStart,
      end: env.markedEnd,
      text: env.markedText,
      votes: traceVotes,
      outcome,
    })

    const votes: IndexedJudgment[] = []
    for (let idx = 0; idx < perModelJudgments.length; idx++) {
      const entry = perModelJudgments[idx].get(env.id)
      if (entry) votes.push({ idx, judgment: entry })
    }

    if (votes.length === 0) {
      surviving.push(env)
      tracer?.pushFilter(env.code, traceEntry("keep"))
      continue
    }

    const merged = mergeVotes(votes)
    switch (merged.outcome) {
      case "remove":
        removed.push(env)
        tracer?.pushFilter(env.code, traceEntry("remove"))
        break
      case "keep":
        surviving.push({ ...env, reason: merged.reason })
        tracer?.pushFilter(env.code, traceEntry("keep"))
        break
      case "contested":
        surviving.push({ ...env, reason: merged.reason, review: merged.review })
        tracer?.pushFilter(env.code, traceEntry("contested"))
        break
      default:
        throw new Error(`unknown filter outcome: ${merged.outcome}`)
    }
  }

  return { surviving, removed, errors, stats }
}
