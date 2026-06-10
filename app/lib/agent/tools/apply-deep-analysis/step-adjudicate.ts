import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { buildAdjudicateMessages, ADJUDICATE_CTA, buildAdjudicateSchema } from "./messages"
import { groupBySpan, type CodedSpan } from "./consensus"
import { renderTargetBlocks } from "./triplet"
import { type CodedItem } from "./present"
import { spanKey } from "./format"
import { ADJUDICATE_ENDPOINT, SPAN_STEP_CONTEXT_SENTENCES } from "./def"

export interface AdjudCounts {
  kept: number
  rejected: number
  ambig: number
}

export type AdjudStats = Map<string, AdjudCounts>

export interface AdjudicateStepResult {
  annotations: Annotation[]
  errors: string[]
  stats: AdjudStats
}

export interface Verdict {
  judgment: "keep" | "reject" | "inconsistent"
  reason: string
}

export const isContested = (a: Annotation): boolean => a.review !== undefined

export const collectCodeIds = (annotations: readonly Annotation[]): Set<string> => {
  const ids = new Set<string>()
  for (const a of annotations) ids.add(a.code)
  return ids
}

export const applyVerdict = (a: Annotation, v: Verdict): Annotation | null => {
  switch (v.judgment) {
    case "reject":
      return null
    case "keep":
      return { ...a, reason: v.reason, review: undefined }
    case "inconsistent":
      return { ...a, reason: v.reason, review: v.reason }
    default:
      throw new Error(`unknown adjudicate judgment: ${v.judgment}`)
  }
}

interface CaseEntry {
  keepCase: string
  removeCase: string
}

const spanReasonKey = (start: number, end: number): string => `${start}-${end}`

const buildCaseMap = (annotations: readonly Annotation[]): Map<string, CaseEntry> => {
  const map = new Map<string, CaseEntry>()
  for (const a of annotations) {
    map.set(spanReasonKey(a.start, a.end), {
      keepCase: a.reason,
      removeCase: a.review ?? "",
    })
  }
  return map
}

const toCodedItems = (spans: CodedSpan[], cases: Map<string, CaseEntry>): CodedItem[] =>
  spans.map((s) => {
    const c = cases.get(spanReasonKey(s.start, s.end))
    return {
      start: s.start,
      end: s.end,
      codings: s.codings,
      keepCase: c?.keepCase,
      removeCase: c?.removeCase,
    }
  })

const toFindShape = (
  annotations: readonly Annotation[]
): { start: number; end: number; analysis_source_id: string }[] =>
  annotations.map((a) => ({ start: a.start, end: a.end, analysis_source_id: a.code }))

export const adjudicateAnnotations = async (
  allSurvivors: Annotation[],
  sentences: string[],
  sources: ScopedSources,
  resolve: ContentResolver
): Promise<AdjudicateStepResult> => {
  const contested = allSurvivors.filter(isContested)
  if (contested.length === 0) return { annotations: allSurvivors, errors: [], stats: new Map() }

  const grouped = groupBySpan(toFindShape(contested))
  const caseMap = buildCaseMap(contested)
  const codedItems = toCodedItems(grouped, caseMap)
  const codeIds = collectCodeIds(allSurvivors)

  const { blocks, mapping } = renderTargetBlocks(sentences, codedItems, SPAN_STEP_CONTEXT_SENTENCES)

  const messages = buildAdjudicateMessages(blocks, codeIds, sources, resolve, ADJUDICATE_CTA)

  const validCodes = [...codeIds]
  const schema = buildAdjudicateSchema(validCodes)
  const result = await callAndParse(ADJUDICATE_ENDPOINT, messages, schema)

  if (!result.ok) return { annotations: allSurvivors, errors: [result.error], stats: new Map() }

  const verdicts = new Map<string, Verdict>()
  for (const r of result.data.results) {
    const m = mapping.find((entry) => entry.index === r.id)
    if (!m) continue
    verdicts.set(spanKey(m.start, m.end, r.code), {
      judgment: r.judgment,
      reason: r.reason,
    })
  }

  const stats: AdjudStats = new Map()
  const bump = (code: string, key: keyof AdjudCounts): void => {
    const entry = stats.get(code) ?? { kept: 0, rejected: 0, ambig: 0 }
    entry[key] += 1
    stats.set(code, entry)
  }

  const final: Annotation[] = []
  for (const a of allSurvivors) {
    if (!isContested(a)) {
      final.push(a)
      continue
    }
    const v = verdicts.get(spanKey(a.start, a.end, a.code))
    if (!v) {
      bump(a.code, "ambig")
      final.push(a)
      continue
    }
    const applied = applyVerdict(a, v)
    if (applied) final.push(applied)
    if (v.judgment === "keep") bump(a.code, "kept")
    else if (v.judgment === "reject") bump(a.code, "rejected")
    else if (v.judgment === "inconsistent") bump(a.code, "ambig")
  }

  return { annotations: final, errors: [], stats }
}
