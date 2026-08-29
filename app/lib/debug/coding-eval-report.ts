import type { CodingDocumentComparison, CodeScore } from "./coding-eval-comparison"
import { scoreTotals, type ScoreTotals } from "./coding-eval-comparison"
import type { CodingDocumentStatus, CodingRequestMetadata } from "./coding-eval"

export interface CodingDocumentOutcome {
  name: string
  status: CodingDocumentStatus
  annotationCount: number | null
  warnings: string[]
  failures: string[]
  comparison?: CodingDocumentComparison
}

export interface CodingRunOutcome {
  latencyMs: number
  requests: CodingRequestMetadata[]
  retries: number
  diagnostics: string[]
}

export interface CountSummary {
  documents: number
  findings: number
}

export interface CodingEvalResults {
  documents: CodingDocumentOutcome[]
  outcomes: Record<CodingDocumentStatus, number>
  relaxed: ScoreTotals
  exact: ScoreTotals
  meanIoU: number | null
  perCode: CodeScore[]
  falsePositivesOnEmptyGold: number
  duplicates: CountSummary
  ambiguous: CountSummary
  unresolved: CountSummary
  latencyMs: { run: number; requestMean: number; requestMin: number; requestMax: number }
  requests: CodingRequestMetadata[]
  retries: number
  diagnostics: string[]
  endpoints: string[]
}

const sumTotals = (
  documents: readonly CodingDocumentOutcome[],
  key: "relaxed" | "exact"
): ScoreTotals => {
  const totals = documents.reduce(
    (sum, document) => ({
      tp: sum.tp + (document.comparison?.[key].tp ?? 0),
      fp: sum.fp + (document.comparison?.[key].fp ?? 0),
      fn: sum.fn + (document.comparison?.[key].fn ?? 0),
    }),
    { tp: 0, fp: 0, fn: 0 }
  )
  return scoreTotals(totals.tp, totals.fp, totals.fn)
}

export const aggregateCodingResults = (
  documents: readonly CodingDocumentOutcome[],
  codeIds: readonly string[],
  run: CodingRunOutcome = { latencyMs: 0, requests: [], retries: 0, diagnostics: [] }
): CodingEvalResults => {
  const outcomes: Record<CodingDocumentStatus, number> = {
    success: 0,
    empty: 0,
    partial: 0,
    failed: 0,
    malformed: 0,
  }
  documents.forEach((document) => outcomes[document.status]++)
  const relaxed = sumTotals(documents, "relaxed")
  const exact = sumTotals(documents, "exact")
  const matchedIoUs = documents.flatMap(
    (document) => document.comparison?.matches.map((match) => match.iou) ?? []
  )
  const seenCodes = documents.flatMap(
    (document) => document.comparison?.perCode.map((score) => score.code) ?? []
  )
  const perCode = [...new Set([...codeIds, ...seenCodes])].sort().map((code) => {
    const totals = documents.reduce(
      (sum, document) => {
        const score = document.comparison?.perCode.find((item) => item.code === code)
        return {
          tp: sum.tp + (score?.tp ?? 0),
          fp: sum.fp + (score?.fp ?? 0),
          fn: sum.fn + (score?.fn ?? 0),
        }
      },
      { tp: 0, fp: 0, fn: 0 }
    )
    return { code, ...scoreTotals(totals.tp, totals.fp, totals.fn) }
  })
  const summarize = (count: (document: CodingDocumentOutcome) => number): CountSummary => ({
    documents: documents.filter((document) => count(document) > 0).length,
    findings: documents.reduce((sum, document) => sum + count(document), 0),
  })
  const requestLatencies = run.requests.flatMap((request) =>
    request.durationMs === null ? [] : [request.durationMs]
  )
  return {
    documents: [...documents],
    outcomes,
    relaxed,
    exact,
    meanIoU:
      matchedIoUs.length === 0
        ? null
        : matchedIoUs.reduce((sum, value) => sum + value, 0) / matchedIoUs.length,
    perCode,
    falsePositivesOnEmptyGold: documents.reduce(
      (sum, document) =>
        sum + (document.comparison?.goldIsEmpty ? document.comparison.relaxed.fp : 0),
      0
    ),
    duplicates: summarize(
      (document) =>
        (document.comparison?.duplicatePredictions ?? 0) + (document.comparison?.duplicateGold ?? 0)
    ),
    ambiguous: summarize(
      (document) =>
        document.comparison?.errors.filter((error) => error.type === "ambiguous").length ?? 0
    ),
    unresolved: summarize(
      (document) =>
        document.comparison?.errors.filter((error) => error.type !== "ambiguous").length ?? 0
    ),
    latencyMs: {
      run: run.latencyMs,
      requestMean:
        requestLatencies.length === 0
          ? 0
          : requestLatencies.reduce((sum, value) => sum + value, 0) / requestLatencies.length,
      requestMin: requestLatencies.length === 0 ? 0 : Math.min(...requestLatencies),
      requestMax: requestLatencies.length === 0 ? 0 : Math.max(...requestLatencies),
    },
    requests: [...run.requests],
    retries: run.retries,
    diagnostics: [...run.diagnostics],
    endpoints: [...new Set(run.requests.map((request) => request.endpoint))].sort(),
  }
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`

export const formatCodingSummary = (results: CodingEvalResults): string => {
  const terminal = Object.entries(results.outcomes)
    .map(([status, count]) => `${status}=${count}`)
    .join(" ")
  return [
    `Documents: ${results.documents.length} (${terminal})`,
    `Relaxed: P ${percent(results.relaxed.precision)} R ${percent(results.relaxed.recall)} F1 ${percent(results.relaxed.f1)} (${results.relaxed.tp} TP, ${results.relaxed.fp} FP, ${results.relaxed.fn} FN)`,
    `Exact: P ${percent(results.exact.precision)} R ${percent(results.exact.recall)} F1 ${percent(results.exact.f1)}`,
    `Mean matched IoU: ${results.meanIoU === null ? "n/a" : results.meanIoU.toFixed(3)}`,
    `Empty-gold false positives: ${results.falsePositivesOnEmptyGold}`,
    `Requests: ${results.requests.length}`,
    `Endpoints: ${results.endpoints.join(", ") || "none"}`,
  ].join("\n")
}
