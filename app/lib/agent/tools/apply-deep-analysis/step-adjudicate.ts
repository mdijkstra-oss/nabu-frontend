import type { Envelope } from "./envelope"
import type { ScopedSources, ContentResolver } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { buildAdjudicateMessages, ADJUDICATE_CTA, buildAdjudicateSchema } from "./messages"
import { renderEnvelopeBlocks } from "./triplet"
import { collectCodeIds, isContestedEnvelope } from "./envelope"
import { ADJUDICATE_ENDPOINT, SPAN_STEP_CONTEXT_SENTENCES } from "./def"
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
      return { ...e, reason: v.reason, review: undefined }
    case "inconsistent":
      return { ...e, reason: v.reason, review: v.reason }
    default:
      throw new Error(`unknown adjudicate judgment: ${v.judgment}`)
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

export const adjudicateEnvelopes = async (
  allSurvivors: Envelope[],
  sources: ScopedSources,
  resolve: ContentResolver,
  tracer?: Tracer
): Promise<AdjudicateStepResult> => {
  const contested = allSurvivors.filter(isContestedEnvelope)
  if (contested.length === 0) return { envelopes: allSurvivors, errors: [], stats: new Map() }

  const codeIds = collectCodeIds(allSurvivors)
  const { blocks, mapping } = renderEnvelopeBlocks(contested, SPAN_STEP_CONTEXT_SENTENCES)

  const messages = buildAdjudicateMessages(blocks, codeIds, sources, resolve, ADJUDICATE_CTA)

  const validCodes = [...codeIds]
  const schema = buildAdjudicateSchema(validCodes)
  const result = await callAndParse(ADJUDICATE_ENDPOINT, messages, schema)

  if (!result.ok) return { envelopes: allSurvivors, errors: [result.error], stats: new Map() }

  const verdicts = new Map<string, Verdict>()
  for (const r of result.data.results) {
    const m = mapping.find((entry) => entry.index === r.id)
    if (!m) continue
    verdicts.set(m.envelopeId, { judgment: r.judgment, reason: r.reason })
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

  return { envelopes: final, errors: [], stats }
}
