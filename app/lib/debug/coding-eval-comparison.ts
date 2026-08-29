import type { Annotation } from "~/domain/data-blocks/attributes/schema"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { findBlocksByLanguage } from "~/lib/data-blocks/parse"
import { getBlocksStrict } from "~/lib/data-blocks/query"
import { findOverlappingRange, indexFileSentences, proseOf } from "~/lib/text/halo"

export interface SentenceRange {
  start: number
  end: number
}

export interface ResolvedFinding {
  index: number
  code: string
  text: string
  range: SentenceRange
}

export interface FindingError {
  side: "prediction" | "gold"
  index: number
  code: string | null
  type: "missing-code" | "unresolved" | "ambiguous"
  text: string
  candidateRanges: SentenceRange[]
}

export interface FindingMatch {
  prediction: ResolvedFinding
  gold: ResolvedFinding
  iou: number
  exact: boolean
}

export interface ScoreTotals {
  tp: number
  fp: number
  fn: number
  precision: number
  recall: number
  f1: number
}

export interface CodeScore extends ScoreTotals {
  code: string
}

export interface CodingDocumentComparison {
  matches: FindingMatch[]
  falsePositives: ResolvedFinding[]
  falseNegatives: ResolvedFinding[]
  errors: FindingError[]
  duplicatePredictions: number
  duplicateGold: number
  relaxed: ScoreTotals
  exact: ScoreTotals
  meanIoU: number | null
  perCode: CodeScore[]
  goldIsEmpty: boolean
}

const occurrences = (source: string, text: string): { start: number; end: number }[] => {
  if (text.length === 0) return []
  const result: { start: number; end: number }[] = []
  let from = 0
  while (from <= source.length - text.length) {
    const start = source.indexOf(text, from)
    if (start === -1) break
    result.push({ start, end: start + text.length })
    from = start + 1
  }
  return result
}

const rangeKey = (range: SentenceRange): string => `${range.start}:${range.end}`

const resolveAnnotations = (
  annotations: readonly Annotation[],
  markdown: string,
  side: FindingError["side"]
): { findings: ResolvedFinding[]; errors: FindingError[]; duplicates: number } => {
  const prose = proseOf(markdown)
  const rows = indexFileSentences(markdown)
  const findings: ResolvedFinding[] = []
  const errors: FindingError[] = []

  annotations.forEach((annotation, index) => {
    if (!annotation.code) {
      errors.push({
        side,
        index,
        code: null,
        type: "missing-code",
        text: annotation.text,
        candidateRanges: [],
      })
      return
    }
    const ranges = occurrences(prose, annotation.text).flatMap((span) => {
      const overlap = findOverlappingRange(rows, span.start, span.end)
      return overlap ? [{ start: overlap.firstIdx, end: overlap.lastIdx }] : []
    })
    const unique = [...new Map(ranges.map((range) => [rangeKey(range), range])).values()]
    if (unique.length !== 1) {
      errors.push({
        side,
        index,
        code: annotation.code,
        type: unique.length === 0 ? "unresolved" : "ambiguous",
        text: annotation.text,
        candidateRanges: unique,
      })
      return
    }
    findings.push({ index, code: annotation.code, text: annotation.text, range: unique[0] })
  })

  const seen = new Set<string>()
  const deduplicated = findings.filter((finding) => {
    const key = `${finding.code}:${rangeKey(finding.range)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { findings: deduplicated, errors, duplicates: findings.length - deduplicated.length }
}

export const sentenceIoU = (a: SentenceRange, b: SentenceRange): number => {
  const intersection = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start) + 1)
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start) + 1
  return intersection / union
}

interface Edge {
  to: number
  reverse: number
  capacity: number
  cost: number
  prediction?: number
  gold?: number
}

const addEdge = (
  graph: Edge[][],
  from: number,
  to: number,
  capacity: number,
  cost: number,
  labels?: { prediction: number; gold: number }
): void => {
  const forward: Edge = {
    to,
    reverse: graph[to].length,
    capacity,
    cost,
    ...labels,
  }
  const reverse: Edge = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost }
  graph[from].push(forward)
  graph[to].push(reverse)
}

const maximumWeightMatches = (
  predictions: readonly ResolvedFinding[],
  gold: readonly ResolvedFinding[],
  threshold: number
): FindingMatch[] => {
  const source = 0
  const predictionStart = 1
  const goldStart = predictionStart + predictions.length
  const sink = goldStart + gold.length
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => [])
  predictions.forEach((_, index) => addEdge(graph, source, predictionStart + index, 1, 0))
  gold.forEach((_, index) => addEdge(graph, goldStart + index, sink, 1, 0))
  predictions.forEach((prediction, predictionIndex) => {
    gold.forEach((expected, goldIndex) => {
      const iou = sentenceIoU(prediction.range, expected.range)
      if (iou >= threshold)
        addEdge(graph, predictionStart + predictionIndex, goldStart + goldIndex, 1, -iou, {
          prediction: predictionIndex,
          gold: goldIndex,
        })
    })
  })

  while (true) {
    const distance = Array(graph.length).fill(Number.POSITIVE_INFINITY) as number[]
    const previous = Array<Edge | undefined>(graph.length)
    const previousNode = Array<number | undefined>(graph.length)
    distance[source] = 0
    for (let pass = 0; pass < graph.length - 1; pass++) {
      let changed = false
      for (let from = 0; from < graph.length; from++) {
        if (!Number.isFinite(distance[from])) continue
        for (const edge of graph[from]) {
          const next = distance[from] + edge.cost
          if (edge.capacity > 0 && next < distance[edge.to] - 1e-12) {
            distance[edge.to] = next
            previous[edge.to] = edge
            previousNode[edge.to] = from
            changed = true
          }
        }
      }
      if (!changed) break
    }
    if (!Number.isFinite(distance[sink]) || distance[sink] >= -1e-12) break
    for (let node = sink; node !== source; ) {
      const edge = previous[node]
      const from = previousNode[node]
      if (!edge || from === undefined) throw new Error("Invalid matching path")
      edge.capacity = 0
      graph[node][edge.reverse].capacity = 1
      node = from
    }
  }

  return graph
    .slice(predictionStart, goldStart)
    .flatMap((edges) =>
      edges.flatMap((edge) => {
        if (edge.prediction === undefined || edge.gold === undefined || edge.capacity !== 0)
          return []
        const prediction = predictions[edge.prediction]
        const expected = gold[edge.gold]
        const iou = sentenceIoU(prediction.range, expected.range)
        return [{ prediction, gold: expected, iou, exact: iou === 1 }]
      })
    )
    .sort(
      (a, b) =>
        a.prediction.index - b.prediction.index ||
        a.gold.index - b.gold.index ||
        a.prediction.code.localeCompare(b.prediction.code)
    )
}

export const scoreTotals = (tp: number, fp: number, fn: number): ScoreTotals => {
  const precision = tp + fp === 0 ? (fn === 0 ? 1 : 0) : tp / (tp + fp)
  const recall = tp + fn === 0 ? (fp === 0 ? 1 : 0) : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { tp, fp, fn, precision, recall, f1 }
}

const annotationsOf = (markdown: string, label: string): Annotation[] => {
  const blocks = findBlocksByLanguage(markdown, "json-annotations")
  const parsed = getBlocksStrict(markdown, "json-annotations", AnnotationsBlockSchema)
  if (blocks.length !== 1 || parsed.length !== 1)
    throw new Error(`${label} must contain one schema-valid json-annotations block`)
  return parsed[0].annotations
}

export const compareCodingDocuments = (
  predictionMarkdown: string,
  goldMarkdown: string
): CodingDocumentComparison => {
  // The pipeline reads a stripped, trimmed copy of the gold document and writes its block back
  // with no trailing newline, so the two proses differ around the fence even when every
  // sentence matches. Trimming compares the text itself; sentence indices are unaffected.
  if (proseOf(predictionMarkdown).trim() !== proseOf(goldMarkdown).trim())
    throw new Error("Prediction and gold document prose differ")
  const prediction = resolveAnnotations(
    annotationsOf(predictionMarkdown, "Prediction"),
    predictionMarkdown,
    "prediction"
  )
  const gold = resolveAnnotations(annotationsOf(goldMarkdown, "Gold"), goldMarkdown, "gold")
  const codes = [
    ...new Set(
      [
        ...prediction.findings.map((item) => item.code),
        ...gold.findings.map((item) => item.code),
        ...prediction.errors.flatMap((error) => error.code ?? []),
        ...gold.errors.flatMap((error) => error.code ?? []),
      ].filter((code): code is string => typeof code === "string")
    ),
  ].sort()
  const matches = codes.flatMap((code) =>
    maximumWeightMatches(
      prediction.findings.filter((item) => item.code === code),
      gold.findings.filter((item) => item.code === code),
      0.5
    )
  )
  const exactMatches = codes.flatMap((code) =>
    maximumWeightMatches(
      prediction.findings.filter((item) => item.code === code),
      gold.findings.filter((item) => item.code === code),
      1
    )
  )
  const matchedPrediction = new Set(matches.map((match) => match.prediction.index))
  const matchedGold = new Set(matches.map((match) => match.gold.index))
  const falsePositives = prediction.findings.filter((item) => !matchedPrediction.has(item.index))
  const falseNegatives = gold.findings.filter((item) => !matchedGold.has(item.index))
  const predictionErrors = prediction.errors.length
  const goldErrors = gold.errors.length
  const relaxed = scoreTotals(
    matches.length,
    falsePositives.length + predictionErrors,
    falseNegatives.length + goldErrors
  )
  const exact = scoreTotals(
    exactMatches.length,
    prediction.findings.length + predictionErrors - exactMatches.length,
    gold.findings.length + goldErrors - exactMatches.length
  )
  const perCode = codes.map((code) => {
    const tp = matches.filter((match) => match.prediction.code === code).length
    const fp =
      falsePositives.filter((item) => item.code === code).length +
      prediction.errors.filter((error) => error.code === code).length
    const fn =
      falseNegatives.filter((item) => item.code === code).length +
      gold.errors.filter((error) => error.code === code).length
    return { code, ...scoreTotals(tp, fp, fn) }
  })
  return {
    matches,
    falsePositives,
    falseNegatives,
    errors: [...prediction.errors, ...gold.errors],
    duplicatePredictions: prediction.duplicates,
    duplicateGold: gold.duplicates,
    relaxed,
    exact,
    meanIoU:
      matches.length === 0
        ? null
        : matches.reduce((total, match) => total + match.iou, 0) / matches.length,
    perCode,
    goldIsEmpty: gold.findings.length === 0 && gold.errors.length === 0,
  }
}
