import type { Envelope } from "./envelope"
import type { ScopedSources, ContentResolver, ParseCall } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { buildAnalysisCallShape, ADJUDICATE_CTA, buildAdjudicateSchema } from "./messages"
import { buildEntryMessages } from "~/lib/calls/entry"
import { envelopeEntries, findEnvelope, packEnvelopes } from "./triplet"
import { collectCodeIds, isContestedEnvelope } from "./envelope"
import { ADJUDICATE_ENDPOINT, POST_FIND_CONCURRENCY } from "./def"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import type { Tracer, AdjudEntry } from "./trace"

export interface AdjudCounts {
  kept: number
  rejected: number
  ambig: number
}

export type AdjudStats = Map<string, AdjudCounts>

export interface AdjudicateStepResult {
  envelopes: Envelope[]
  errors: string[]
  stats: AdjudStats
}

export interface Verdict {
  judgment: "keep" | "reject" | "inconsistent"
  reason: string
}

export const applyVerdict = (e: Envelope, v: Verdict): Envelope | null => {
  switch (v.judgment) {
    case "reject":
      return null
    case "keep":
      return { ...e, review: undefined }
    case "inconsistent":
      return { ...e, review: v.reason }
    default:
      throw new Error(`unknown adjudicate judgment: ${v.judgment}`)
  }
}

export const adjudicateEnvelopes = async (
  allSurvivors: Envelope[],
  sources: ScopedSources,
  resolve: ContentResolver,
  tracer?: Tracer,
  parse: ParseCall = callAndParse
): Promise<AdjudicateStepResult> => {
  const contested = allSurvivors.filter(isContestedEnvelope)
  if (contested.length === 0) return { envelopes: allSurvivors, errors: [], stats: new Map() }

  const { results } = await processPool(
    packEnvelopes(contested),
    async (batch) => [await adjudicateBatch(batch, sources, resolve, parse)],
    noop,
    { concurrency: POST_FIND_CONCURRENCY }
  )

  const verdicts = new Map<string, Verdict>()
  const errors: string[] = []
  for (const batch of results) {
    for (const [envelopeId, verdict] of batch.verdicts) verdicts.set(envelopeId, verdict)
    errors.push(...batch.errors)
  }

  const stats: AdjudStats = new Map()
  const bump = (code: string, key: keyof AdjudCounts): void => {
    const entry = stats.get(code) ?? { kept: 0, rejected: 0, ambig: 0 }
    entry[key] += 1
    stats.set(code, entry)
  }

  const final: Envelope[] = []
  for (const env of allSurvivors) {
    if (!isContestedEnvelope(env)) {
      final.push(env)
      continue
    }
    const v = verdicts.get(env.id)
    if (!v) {
      bump(env.code, "ambig")
      final.push(env)
      tracer?.pushAdjud(env.code, adjudEntry(env, ambigVerdict(env)))
      continue
    }
    const applied = applyVerdict(env, v)
    if (applied) final.push(applied)
    if (v.judgment === "keep") bump(env.code, "kept")
    else if (v.judgment === "reject") bump(env.code, "rejected")
    else if (v.judgment === "inconsistent") bump(env.code, "ambig")
    tracer?.pushAdjud(env.code, adjudEntry(env, v))
  }

  return { envelopes: final, errors, stats }
}

interface BatchVerdicts {
  verdicts: Map<string, Verdict>
  errors: string[]
}

const adjudicateBatch = async (
  batch: Envelope[],
  sources: ScopedSources,
  resolve: ContentResolver,
  parse: ParseCall
): Promise<BatchVerdicts> => {
  const codeIds = collectCodeIds(batch)
  const entries = envelopeEntries(batch)
  const shape = buildAnalysisCallShape(codeIds, sources, resolve, ADJUDICATE_CTA)
  const messages = buildEntryMessages(shape, entries)

  try {
    const result = await parse(ADJUDICATE_ENDPOINT, messages, buildAdjudicateSchema([...codeIds]))
    if (!result.ok) return { verdicts: new Map(), errors: [result.error] }

    const verdicts = new Map<string, Verdict>()
    for (const r of result.data.results) {
      const envelope = findEnvelope(entries, r.id)
      if (!envelope) continue
      verdicts.set(envelope.id, { judgment: r.judgment, reason: r.reason })
    }
    return { verdicts, errors: [] }
  } catch (e) {
    return { verdicts: new Map(), errors: [errorMessage(e)] }
  }
}

const adjudEntry = (e: Envelope, verdict: Verdict): AdjudEntry => ({
  code: e.code,
  start: e.markedStart,
  end: e.markedEnd,
  text: e.markedText,
  verdict: verdict.judgment,
  reason: verdict.reason,
})

const ambigVerdict = (e: Envelope): Verdict => ({
  judgment: "inconsistent",
  reason: e.review ?? "no verdict returned",
})
