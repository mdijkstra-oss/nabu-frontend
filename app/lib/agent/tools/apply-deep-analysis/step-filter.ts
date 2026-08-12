import type { Envelope } from "./envelope"
import type { ScopedSources, ContentResolver, ParseCall } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { buildAnalysisCallShape, FILTER_CTA, buildFilterSchema } from "./messages"
import { buildEntryMessages } from "~/lib/calls/entry"
import { envelopeEntries, findEnvelope } from "./triplet"
import { collectCodeIds } from "./envelope"
import { FILTER_ENDPOINT, FILTER_RUNS, FILTER_VOTERS } from "./def"
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

// Counted from the deduped judgment maps and bucketed by the envelope's own
// code, so a voter repeating an id or echoing a batch-mate's code cannot skew
// the table.
const keepStats = (
  envelopes: readonly Envelope[],
  perModelJudgments: readonly Map<string, Judgment>[]
): FilterStats => {
  const stats: FilterStats = new Map()
  for (const env of envelopes) {
    for (let idx = 0; idx < perModelJudgments.length; idx++) {
      if (perModelJudgments[idx].get(env.id)?.judgment !== "keep") continue
      const tally = stats.get(env.code) ?? [0, 0]
      tally[idx] += 1
      stats.set(env.code, tally)
    }
  }
  return stats
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
  tracer?: Tracer,
  parse: ParseCall = callAndParse
): Promise<FilterStepResult> => {
  if (envelopes.length === 0) return { surviving: [], removed: [], errors: [], stats: new Map() }
  tracer?.setVoterCount(FILTER_RUNS)

  const codeIds = collectCodeIds(envelopes)
  const entries = envelopeEntries(envelopes)
  const shape = buildAnalysisCallShape(codeIds, sources, resolve, FILTER_CTA)
  const messages = buildEntryMessages(shape, entries)

  const validCodes = [...codeIds]
  const modelCalls = FILTER_VOTERS.map((voter) =>
    parse(`${FILTER_ENDPOINT}.${voter}`, messages, buildFilterSchema(validCodes))
  )
  const results = await Promise.all(modelCalls)

  const errors: string[] = []
  const perModelJudgments: Map<string, Judgment>[] = []

  for (const result of results) {
    const judgments = new Map<string, Judgment>()
    if (!result.ok) {
      errors.push(result.error)
    } else {
      for (const r of result.data.results) {
        const envelope = findEnvelope(entries, r.id)
        if (!envelope) continue
        judgments.set(envelope.id, { judgment: r.judgment, reason: r.reason })
      }
    }
    perModelJudgments.push(judgments)
  }

  const stats = keepStats(envelopes, perModelJudgments)

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
