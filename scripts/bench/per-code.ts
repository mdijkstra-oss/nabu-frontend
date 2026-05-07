import { readFileSync, readdirSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import mri from "mri"
import type { SectionResult } from "./types"

interface CodeSpans {
  codeId: string
  runs: Set<number>[]
}

interface CodeMetrics {
  codeId: string
  meanF1: number
  minF1: number
  counts: number[]
  meanSentences: number
}

interface CoverageMetrics {
  totalSentences: number
  codedSentencesPerRun: number[]
  meanCoded: number
  meanCoverage: number
  codesPerSentencePerRun: number[]
}

const findRunDirs = (benchDir: string): string[] =>
  readdirSync(benchDir)
    .filter((name) => name.startsWith("run-"))
    .sort()
    .map((name) => resolve(benchDir, name))

const loadRun = (runDir: string): SectionResult[] =>
  JSON.parse(readFileSync(resolve(runDir, "codings.json"), "utf-8")) as SectionResult[]

const spanSetForCode = (run: SectionResult[], codeId: string): Set<number> => {
  const spans = new Set<number>()
  for (const section of run) {
    for (const r of section.results) {
      if (r.analysis_source_id === codeId) {
        for (let s = r.start; s <= r.end; s++) spans.add(s)
      }
    }
  }
  return spans
}

const allCodedSentences = (run: SectionResult[]): Set<number> => {
  const coded = new Set<number>()
  for (const section of run) {
    for (const r of section.results) {
      for (let s = r.start; s <= r.end; s++) coded.add(s)
    }
  }
  return coded
}

const totalAnnotationsPerSentence = (run: SectionResult[]): number => {
  const counts = new Map<number, number>()
  for (const section of run) {
    for (const r of section.results) {
      for (let s = r.start; s <= r.end; s++) {
        counts.set(s, (counts.get(s) ?? 0) + 1)
      }
    }
  }
  const coded = [...counts.values()]
  return coded.length === 0 ? 0 : coded.reduce((a, b) => a + b, 0) / coded.length
}

const totalSentences = (runs: SectionResult[][]): number => {
  let max = 0
  for (const run of runs) {
    for (const section of run) {
      max = Math.max(max, section.startLine + section.sentenceCount - 1)
    }
  }
  return max
}

const pairwiseF1 = (a: Set<number>, b: Set<number>): number => {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  for (const s of a) if (b.has(s)) overlap++
  const p = overlap / b.size
  const r = overlap / a.size
  return p + r === 0 ? 0 : (2 * p * r) / (p + r)
}

const computePerCode = (runs: SectionResult[][]): CodeMetrics[] => {
  const allCodes = new Set<string>()
  for (const run of runs) {
    for (const section of run) {
      for (const r of section.results) allCodes.add(r.analysis_source_id)
    }
  }

  const metrics: CodeMetrics[] = []
  for (const codeId of allCodes) {
    const runSpans = runs.map((run) => spanSetForCode(run, codeId))
    const f1s: number[] = []
    for (let i = 0; i < runSpans.length; i++) {
      for (let j = i + 1; j < runSpans.length; j++) {
        f1s.push(pairwiseF1(runSpans[i], runSpans[j]))
      }
    }
    const counts = runSpans.map((s) => s.size)
    metrics.push({
      codeId,
      meanF1: f1s.reduce((a, b) => a + b, 0) / f1s.length,
      minF1: Math.min(...f1s),
      counts,
      meanSentences: counts.reduce((a, b) => a + b, 0) / counts.length,
    })
  }

  return metrics.sort((a, b) => b.meanF1 - a.meanF1)
}

const computeCoverage = (runs: SectionResult[][]): CoverageMetrics => {
  const total = totalSentences(runs)
  const codedPerRun = runs.map((run) => allCodedSentences(run).size)
  const codesPerSentence = runs.map((run) => totalAnnotationsPerSentence(run))
  const meanCoded = codedPerRun.reduce((a, b) => a + b, 0) / codedPerRun.length

  return {
    totalSentences: total,
    codedSentencesPerRun: codedPerRun,
    meanCoded,
    meanCoverage: total === 0 ? 0 : meanCoded / total,
    codesPerSentencePerRun: codesPerSentence,
  }
}

const pad = (s: string, n: number) => s.padEnd(n)
const rpad = (s: string, n: number) => s.padStart(n)

const formatMetrics = (metrics: CodeMetrics[], coverage: CoverageMetrics): string => {
  const lines: string[] = []

  lines.push("=== Per-Code Pairwise F1 ===\n")
  lines.push(
    `${pad("Code", 24)} ${rpad("F1", 6)} ${rpad("minF1", 6)} ${rpad("Mean#", 6)}   Counts`
  )
  lines.push("-".repeat(80))

  for (const m of metrics) {
    const countStr = m.counts.map((c) => String(c).padStart(3)).join(" ")
    lines.push(
      `${pad(m.codeId, 24)} ${rpad(m.meanF1.toFixed(3), 6)} ${rpad(m.minF1.toFixed(3), 6)} ${rpad(m.meanSentences.toFixed(1), 6)}   [${countStr}]`
    )
  }

  lines.push("")
  lines.push("=== Coverage ===\n")
  lines.push(`Total sentences:       ${coverage.totalSentences}`)
  lines.push(
    `Coded per run:         [${coverage.codedSentencesPerRun.map((c) => String(c).padStart(4)).join(" ")}]`
  )
  lines.push(`Mean coded:            ${coverage.meanCoded.toFixed(1)}`)
  lines.push(`Mean coverage:         ${(coverage.meanCoverage * 100).toFixed(1)}%`)
  lines.push(
    `Codes/coded-sentence:  [${coverage.codesPerSentencePerRun.map((c) => c.toFixed(2)).join(" ")}]`
  )

  return lines.join("\n")
}

const main = () => {
  const args = mri(process.argv.slice(2))
  const dirs = args._ as string[]

  if (dirs.length === 0) {
    console.error("Usage: npx tsx scripts/bench/per-code.ts <bench-dir>")
    process.exit(1)
  }

  const benchDir = resolve(dirs[0])
  if (!existsSync(benchDir)) {
    console.error(`Directory not found: ${benchDir}`)
    process.exit(1)
  }

  const runDirs = findRunDirs(benchDir)
  if (runDirs.length < 2) {
    console.error(`Need at least 2 runs, found ${runDirs.length}`)
    process.exit(1)
  }

  const runs = runDirs.map(loadRun)
  const metrics = computePerCode(runs)
  const coverage = computeCoverage(runs)

  console.log(`Bench: ${benchDir}`)
  console.log(`Runs:  ${runs.length}\n`)
  console.log(formatMetrics(metrics, coverage))
}

main()
