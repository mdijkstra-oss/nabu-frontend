import type { SectionResult } from "./types"

export interface CodingVector {
  sentenceIndex: number
  code: string
}

export interface AgreementMatrix {
  codes: string[]
  sentences: number
  ratings: boolean[][]
}

export interface KappaResult {
  observedAgreement: number
  expectedAgreement: number
  kappa: number
}

export interface AlphaResult {
  observedDisagreement: number
  expectedDisagreement: number
  alpha: number
}

export interface F1Result {
  precision: number
  recall: number
  f1: number
}

export interface OverlapComparison {
  overall: F1Result
  perCode: { code: string; f1: number; count: number }[]
}

export interface ComparisonResult {
  fleiss: KappaResult
  alpha: AlphaResult
  cuAlpha: AlphaResult
  overlapF1: OverlapComparison
  perCode: { code: string; kappa: number; prevalence: number }[]
  volatility: { code: string; disagreementRate: number }[]
  raters: number
  items: number
}

const toCodingSet = (sections: SectionResult[]): Set<string> => {
  const set = new Set<string>()
  for (const section of sections) {
    for (const r of section.results) {
      for (let s = r.start; s <= r.end; s++) {
        set.add(`${section.startLine}:${s}:${r.analysis_source_id}`)
      }
    }
  }
  return set
}

const collectAllKeys = (runs: Set<string>[]): string[] => {
  const union = new Set<string>()
  for (const run of runs) for (const key of run) union.add(key)
  return [...union].sort()
}

const toBinaryMatrix = (keys: string[], runs: Set<string>[]): boolean[][] =>
  keys.map((key) => runs.map((run) => run.has(key)))

export const buildAgreementMatrix = (allRuns: SectionResult[][]): AgreementMatrix => {
  const runSets = allRuns.map(toCodingSet)
  const allKeys = collectAllKeys(runSets)
  const ratings = toBinaryMatrix(allKeys, runSets)

  const codes = new Set<string>()
  for (const key of allKeys) {
    const parts = key.split(":")
    codes.add(parts[parts.length - 1])
  }

  return { codes: [...codes].sort(), sentences: allKeys.length, ratings }
}

export const computeCohenKappa = (ratingsA: boolean[], ratingsB: boolean[]): KappaResult => {
  const n = ratingsA.length
  if (n === 0) return { observedAgreement: 1, expectedAgreement: 1, kappa: 1 }

  let agree = 0
  let aYes = 0
  let bYes = 0

  for (let i = 0; i < n; i++) {
    if (ratingsA[i] === ratingsB[i]) agree++
    if (ratingsA[i]) aYes++
    if (ratingsB[i]) bYes++
  }

  const po = agree / n
  const pYesA = aYes / n
  const pYesB = bYes / n
  const pe = pYesA * pYesB + (1 - pYesA) * (1 - pYesB)

  if (pe === 1) return { observedAgreement: po, expectedAgreement: pe, kappa: 1 }

  return {
    observedAgreement: po,
    expectedAgreement: pe,
    kappa: (po - pe) / (1 - pe),
  }
}

export const computeFleissKappa = (matrix: boolean[][]): KappaResult => {
  const n = matrix.length
  if (n === 0) return { observedAgreement: 1, expectedAgreement: 1, kappa: 1 }

  const k = matrix[0].length
  if (k <= 1) return { observedAgreement: 1, expectedAgreement: 1, kappa: 1 }

  let poSum = 0
  let pYesSum = 0

  for (let i = 0; i < n; i++) {
    const yesCount = matrix[i].filter(Boolean).length
    poSum += (yesCount * (yesCount - 1) + (k - yesCount) * (k - yesCount - 1)) / (k * (k - 1))
    pYesSum += yesCount
  }

  const po = poSum / n
  const pBar = pYesSum / (n * k)
  const pe = pBar * pBar + (1 - pBar) * (1 - pBar)

  if (pe === 1) return { observedAgreement: po, expectedAgreement: pe, kappa: 1 }

  return {
    observedAgreement: po,
    expectedAgreement: pe,
    kappa: (po - pe) / (1 - pe),
  }
}

export const computeKrippendorffAlpha = (matrix: boolean[][]): AlphaResult => {
  const n = matrix.length
  if (n === 0) return { observedDisagreement: 0, expectedDisagreement: 0, alpha: 1 }

  const R = matrix[0].length
  if (R <= 1) return { observedDisagreement: 0, expectedDisagreement: 0, alpha: 1 }

  const N = n * R
  let totalYes = 0
  let disagreementSum = 0

  for (let i = 0; i < n; i++) {
    const k = matrix[i].filter(Boolean).length
    disagreementSum += k * (R - k)
    totalYes += k
  }

  const totalNo = N - totalYes
  const Do = (2 * disagreementSum) / (n * R * (R - 1))
  const De = (2 * totalYes * totalNo) / (N * (N - 1))

  if (De === 0) return { observedDisagreement: Do, expectedDisagreement: De, alpha: 1 }

  return {
    observedDisagreement: Do,
    expectedDisagreement: De,
    alpha: 1 - Do / De,
  }
}

const computePerCodeKappa = (
  allKeys: string[],
  runSets: Set<string>[],
  codes: string[]
): { code: string; kappa: number; prevalence: number }[] =>
  codes.map((code) => {
    const codeKeys = allKeys.filter((k) => k.endsWith(`:${code}`))
    if (codeKeys.length === 0) return { code, kappa: 1, prevalence: 0 }

    const codeMatrix = codeKeys.map((key) => runSets.map((run) => run.has(key)))
    const { kappa } = computeFleissKappa(codeMatrix)
    const totalRated = codeMatrix.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
    const prevalence = totalRated / (codeKeys.length * runSets.length)

    return { code, kappa, prevalence }
  })

const computeVolatility = (
  allKeys: string[],
  runSets: Set<string>[]
): { code: string; disagreementRate: number }[] => {
  const codeDisagreements = new Map<string, { disagree: number; total: number }>()

  for (const key of allKeys) {
    const parts = key.split(":")
    const code = parts[parts.length - 1]
    const ratings = runSets.map((run) => run.has(key))
    const allSame = ratings.every((r) => r === ratings[0])

    const prev = codeDisagreements.get(code) ?? { disagree: 0, total: 0 }
    codeDisagreements.set(code, {
      disagree: prev.disagree + (allSame ? 0 : 1),
      total: prev.total + 1,
    })
  }

  return [...codeDisagreements.entries()]
    .map(([code, { disagree, total }]) => ({
      code,
      disagreementRate: total > 0 ? disagree / total : 0,
    }))
    .sort((a, b) => b.disagreementRate - a.disagreementRate)
}

interface Span {
  sectionStart: number
  start: number
  end: number
  code: string
}

const toSpans = (sections: SectionResult[]): Span[] =>
  sections.flatMap((section) =>
    section.results.map((r) => ({
      sectionStart: section.startLine,
      start: r.start,
      end: r.end,
      code: r.analysis_source_id,
    }))
  )

const spansOverlap = (a: Span, b: Span): boolean =>
  a.sectionStart === b.sectionStart &&
  a.code === b.code &&
  a.start <= b.end &&
  b.start <= a.end

const computePairF1 = (spansA: Span[], spansB: Span[]): F1Result => {
  if (spansA.length === 0 && spansB.length === 0) return { precision: 1, recall: 1, f1: 1 }
  if (spansA.length === 0 || spansB.length === 0) return { precision: 0, recall: 0, f1: 0 }

  const matchedA = spansA.filter((a) => spansB.some((b) => spansOverlap(a, b))).length
  const matchedB = spansB.filter((b) => spansA.some((a) => spansOverlap(a, b))).length

  const recall = matchedA / spansA.length
  const precision = matchedB / spansB.length

  if (precision + recall === 0) return { precision: 0, recall: 0, f1: 0 }

  return {
    precision,
    recall,
    f1: (2 * precision * recall) / (precision + recall),
  }
}

const allPairs = <T>(items: T[]): [T, T][] => {
  const pairs: [T, T][] = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      pairs.push([items[i], items[j]])
    }
  }
  return pairs
}

export const computePairwiseOverlapF1 = (allRuns: SectionResult[][]): OverlapComparison => {
  const runSpans = allRuns.map(toSpans)
  const pairs = allPairs(runSpans)

  if (pairs.length === 0) return { overall: { precision: 1, recall: 1, f1: 1 }, perCode: [] }

  const pairResults = pairs.map(([a, b]) => computePairF1(a, b))
  const avgF1 = (results: F1Result[]): F1Result => ({
    precision: results.reduce((s, r) => s + r.precision, 0) / results.length,
    recall: results.reduce((s, r) => s + r.recall, 0) / results.length,
    f1: results.reduce((s, r) => s + r.f1, 0) / results.length,
  })

  const allCodes = new Set<string>()
  for (const spans of runSpans) for (const s of spans) allCodes.add(s.code)

  const perCode = [...allCodes].sort().map((code) => {
    const codeRunSpans = runSpans.map((spans) => spans.filter((s) => s.code === code))
    const codePairs = allPairs(codeRunSpans)
    const codePairResults = codePairs.map(([a, b]) => computePairF1(a, b))
    const f1 = codePairResults.length > 0
      ? codePairResults.reduce((s, r) => s + r.f1, 0) / codePairResults.length
      : 1
    const count = runSpans.reduce((s, spans) => s + spans.filter((sp) => sp.code === code).length, 0)
    return { code, f1, count }
  })

  return { overall: avgF1(pairResults), perCode }
}

interface UnitInterval {
  offset: number
  length: number
  isUnit: boolean
}

const toUnitIntervals = (
  spans: { start: number; end: number }[],
  continuumLength: number
): UnitInterval[] => {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const result: UnitInterval[] = []
  let pos = 0

  for (const span of sorted) {
    const offset = span.start - 1
    const length = span.end - span.start + 1
    if (offset > pos) {
      result.push({ offset: pos, length: offset - pos, isUnit: false })
    }
    result.push({ offset, length, isUnit: true })
    pos = offset + length
  }

  if (pos < continuumLength) {
    result.push({ offset: pos, length: continuumLength - pos, isUnit: false })
  }

  return result
}

const measureUnitizingDistance = (
  o1: number, l1: number, u1: boolean,
  o2: number, l2: number, u2: boolean
): number => {
  const bd = o1 - o2
  const ld = l1 - l2
  if (u1 && u2 && -l1 < bd && bd < l2) {
    return bd * bd + (bd + ld) * (bd + ld)
  }
  if (u1 && !u2 && bd >= 0 && -ld >= bd) {
    return l1 * l1
  }
  if (!u1 && u2 && bd <= 0 && -ld <= bd) {
    return l2 * l2
  }
  return 0
}

const observedCategoryDisagreement = (
  raterSubjects: UnitInterval[][],
  L: number
): number => {
  const R = raterSubjects.length
  if (R <= 1 || L === 0) return 0

  let sum = 0
  for (let r1 = 0; r1 < R; r1++) {
    for (let r2 = r1 + 1; r2 < R; r2++) {
      for (const s1 of raterSubjects[r1]) {
        for (const s2 of raterSubjects[r2]) {
          sum += measureUnitizingDistance(
            s1.offset, s1.length, s1.isUnit,
            s2.offset, s2.length, s2.isUnit
          )
        }
      }
    }
  }

  return (2 * sum) / (R * (R - 1) * L * L)
}

const expectedCategoryDisagreement = (
  raterSubjects: UnitInterval[][],
  L: number
): number => {
  const R = raterSubjects.length
  if (R <= 1 || L === 0) return 0

  const unitLengths: number[] = []
  let squaredLengths = 0
  for (const subjects of raterSubjects) {
    for (const s of subjects) {
      if (s.isUnit) {
        unitLengths.push(s.length)
        squaredLengths += s.length * (s.length - 1)
      }
    }
  }

  const Nc = unitLengths.length
  if (Nc === 0) return 0

  const gapLengths: number[] = []
  for (const subjects of raterSubjects) {
    for (const s of subjects) {
      if (!s.isUnit) gapLengths.push(s.length)
    }
  }
  gapLengths.sort((a, b) => b - a)

  let sum = 0
  for (const l of unitLengths) {
    sum += (Nc - 1) * (2 * l * l * l - 3 * l * l + l) / 3

    let gapSum = 0
    for (const gap of gapLengths) {
      if (gap >= l) {
        gapSum += gap - l + 1
      } else {
        break
      }
    }
    sum += l * l * gapSum
  }

  const denominator = R * L * (R * L - 1) - squaredLengths
  if (denominator === 0) return 0

  return (2 * sum) / (L * denominator)
}

export const computeUnitizingAlpha = (allRuns: SectionResult[][]): AlphaResult => {
  const R = allRuns.length
  if (R <= 1) return { observedDisagreement: 0, expectedDisagreement: 0, alpha: 1 }

  const allCodes = new Set<string>()
  const sectionKeys = new Set<number>()
  for (const run of allRuns) {
    for (const section of run) {
      sectionKeys.add(section.startLine)
      for (const r of section.results) allCodes.add(r.analysis_source_id)
    }
  }

  if (allCodes.size === 0) return { observedDisagreement: 0, expectedDisagreement: 0, alpha: 1 }

  const codes = [...allCodes].sort()
  let totalDo = 0
  let totalDe = 0

  for (const code of codes) {
    let codeDo = 0
    let codeDe = 0

    for (const startLine of sectionKeys) {
      const sectionsByRun = allRuns.map((run) =>
        run.find((s) => s.startLine === startLine)
      )

      const hasAll = sectionsByRun.every((s) => s !== undefined)
      if (!hasAll) continue

      const L = sectionsByRun[0]!.sentenceCount

      const raterSubjects = sectionsByRun.map((section) => {
        const codeSpans = section!.results
          .filter((r) => r.analysis_source_id === code)
          .map((r) => ({ start: r.start, end: r.end }))
        return toUnitIntervals(codeSpans, L)
      })

      codeDo += observedCategoryDisagreement(raterSubjects, L)
      codeDe += expectedCategoryDisagreement(raterSubjects, L)
    }

    totalDo += codeDo
    totalDe += codeDe
  }

  const Do = totalDo / codes.length
  const De = totalDe / codes.length

  if (De === 0) return { observedDisagreement: Do, expectedDisagreement: De, alpha: 1 }

  return {
    observedDisagreement: Do,
    expectedDisagreement: De,
    alpha: 1 - Do / De,
  }
}

export const compareRuns = (allRuns: SectionResult[][]): ComparisonResult => {
  const runSets = allRuns.map(toCodingSet)
  const allKeys = collectAllKeys(runSets)
  const matrix = toBinaryMatrix(allKeys, runSets)

  const codes = new Set<string>()
  for (const key of allKeys) {
    const parts = key.split(":")
    codes.add(parts[parts.length - 1])
  }
  const sortedCodes = [...codes].sort()

  const fleiss = computeFleissKappa(matrix)
  const alpha = computeKrippendorffAlpha(matrix)
  const cuAlpha = computeUnitizingAlpha(allRuns)
  const overlapF1 = computePairwiseOverlapF1(allRuns)
  const perCode = computePerCodeKappa(allKeys, runSets, sortedCodes)
  const volatility = computeVolatility(allKeys, runSets)

  return {
    fleiss,
    alpha,
    cuAlpha,
    overlapF1,
    perCode,
    volatility,
    raters: allRuns.length,
    items: allKeys.length,
  }
}

export const formatComparison = (result: ComparisonResult): string => {
  const lines: string[] = []
  const pad = (s: string, w = 30): string => s.padEnd(w)

  lines.push(`Raters: ${result.raters}  Items: ${result.items}`)
  lines.push("")
  lines.push("--- Agreement metrics ---")
  lines.push(`Fleiss' kappa (strict):    ${result.fleiss.kappa.toFixed(3)}  (Po=${result.fleiss.observedAgreement.toFixed(3)}, Pe=${result.fleiss.expectedAgreement.toFixed(3)})`)
  lines.push(`Krippendorff's alpha:      ${result.alpha.alpha.toFixed(3)}  (Do=${result.alpha.observedDisagreement.toFixed(3)}, De=${result.alpha.expectedDisagreement.toFixed(3)})`)
  lines.push(`Krippendorff's cu-alpha:   ${result.cuAlpha.alpha.toFixed(3)}  (Do=${result.cuAlpha.observedDisagreement.toFixed(3)}, De=${result.cuAlpha.expectedDisagreement.toFixed(3)})`)
  lines.push(`Overlap F1 (pairwise):     ${result.overlapF1.overall.f1.toFixed(3)}  (P=${result.overlapF1.overall.precision.toFixed(3)}, R=${result.overlapF1.overall.recall.toFixed(3)})`)
  lines.push("")

  lines.push("--- Per-code Fleiss' kappa (strict, per-sentence) ---")
  lines.push(`  ${pad("Code")} Kappa   Prevalence`)
  lines.push("  " + "-".repeat(50))
  for (const pc of result.perCode) {
    lines.push(`  ${pad(pc.code)} ${pc.kappa.toFixed(3)}   ${pc.prevalence.toFixed(3)}`)
  }
  lines.push("")

  lines.push("--- Per-code overlap F1 (span-level) ---")
  lines.push(`  ${pad("Code")} F1      Count`)
  lines.push("  " + "-".repeat(50))
  for (const pc of result.overlapF1.perCode) {
    lines.push(`  ${pad(pc.code)} ${pc.f1.toFixed(3)}   ${pc.count}`)
  }
  lines.push("")

  const volatile = result.volatility.filter((v) => v.disagreementRate > 0)
  if (volatile.length > 0) {
    lines.push("--- Volatility (codes with disagreement) ---")
    lines.push(`  ${pad("Code")} Disagreement rate`)
    lines.push("  " + "-".repeat(50))
    for (const v of volatile) {
      lines.push(`  ${pad(v.code)} ${(v.disagreementRate * 100).toFixed(1)}%`)
    }
  } else {
    lines.push("No volatility — perfect agreement across all codes.")
  }

  return lines.join("\n")
}
