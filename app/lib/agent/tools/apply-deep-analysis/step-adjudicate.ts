import type { Annotation } from "./types"
import type { ScopedSources, ContentResolver } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { buildSpanStepMessages, ADJUDICATE_CTA, buildAdjudicateSchema } from "./messages"
import { groupBySpan, type CodedSpan } from "./consensus"
import { formatCodedSection, type CodedItem } from "./present"
import { spanKey } from "./format"
import { ADJUDICATE_ENDPOINT, SPAN_STEP_CONTEXT_SENTENCES } from "./def"

export interface AdjudicateStepResult {
  annotations: Annotation[]
  errors: string[]
}

export interface Verdict {
  judgment: "keep" | "reject" | "inconsistent"
  reason: string
}

export const isContested = (a: Annotation): boolean => a.review !== undefined

export const buildCase = (a: Annotation): string =>
  `keep-case: ${a.reason} | remove-case: ${a.review ?? ""}`

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

const spanReasonKey = (start: number, end: number): string => `${start}-${end}`

const buildCaseMap = (annotations: readonly Annotation[]): Map<string, string> => {
  const map = new Map<string, string>()
  for (const a of annotations) map.set(spanReasonKey(a.start, a.end), buildCase(a))
  return map
}

const toCodedItems = (spans: CodedSpan[], cases: Map<string, string>): CodedItem[] =>
  spans.map((s) => ({
    start: s.start,
    end: s.end,
    codings: s.codings,
    reason: cases.get(spanReasonKey(s.start, s.end)),
  }))

const toFindShape = (
  annotations: readonly Annotation[]
): { start: number; end: number; analysis_source_id: string }[] =>
  annotations.map((a) => ({ start: a.start, end: a.end, analysis_source_id: a.code }))

export const adjudicateAnnotations = async (
  allSurvivors: Annotation[],
  sentences: string[],
  sources: ScopedSources,
  leadingCtx: string,
  trailingCtx: string,
  resolve: ContentResolver
): Promise<AdjudicateStepResult> => {
  const contested = allSurvivors.filter(isContested)
  if (contested.length === 0) return { annotations: allSurvivors, errors: [] }

  const grouped = groupBySpan(toFindShape(contested))
  const caseMap = buildCaseMap(contested)
  const codedItems = toCodedItems(grouped, caseMap)
  const codeIds = collectCodeIds(allSurvivors)

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

  if (!result.ok) return { annotations: allSurvivors, errors: [result.error] }

  const verdicts = new Map<string, Verdict>()
  for (const r of result.data.results) {
    const m = mapping.find((entry) => entry.index === r.id)
    if (!m) continue
    verdicts.set(spanKey(m.start, m.end, r.code), {
      judgment: r.judgment,
      reason: r.reason,
    })
  }

  const final: Annotation[] = []
  for (const a of allSurvivors) {
    if (!isContested(a)) {
      final.push(a)
      continue
    }
    const v = verdicts.get(spanKey(a.start, a.end, a.code))
    if (!v) {
      final.push(a)
      continue
    }
    const applied = applyVerdict(a, v)
    if (applied) final.push(applied)
  }

  return { annotations: final, errors: [] }
}
