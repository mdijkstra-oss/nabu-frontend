import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import mri from "mri"
import { compareRuns, formatComparison, type ComparisonResult } from "./kappa"
import type { SectionResult, CostSummary } from "./types"

const loadRunSections = (runDir: string): SectionResult[] => {
  const codingsPath = resolve(runDir, "codings.json")
  return JSON.parse(readFileSync(codingsPath, "utf-8")) as SectionResult[]
}

const findRunDirs = (benchDir: string): string[] =>
  readdirSync(benchDir)
    .filter((name) => name.startsWith("run-"))
    .sort()
    .map((name) => resolve(benchDir, name))

const loadAllRuns = (benchDir: string): SectionResult[][] =>
  findRunDirs(benchDir).map(loadRunSections)

const loadCosts = (benchDir: string): CostSummary | null => {
  const costsPath = resolve(benchDir, "costs.json")
  if (!existsSync(costsPath)) return null
  return JSON.parse(readFileSync(costsPath, "utf-8")) as CostSummary
}

const loadMeta = (benchDir: string): Record<string, unknown> | null => {
  const metaPath = resolve(benchDir, "meta.json")
  if (!existsSync(metaPath)) return null
  return JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>
}

const printBenchSummary = (dir: string): void => {
  const meta = loadMeta(dir)
  const costs = loadCosts(dir)
  if (meta) {
    console.log(`  Label: ${meta.label}`)
    console.log(`  Runs:  ${meta.runs}`)
  }
  if (costs) {
    console.log(`  Cost:  $${costs.total.costUsd.toFixed(4)} (${costs.total.calls} calls)`)
  }
}

const compareWithinBatch = (benchDir: string): ComparisonResult => {
  const allRuns = loadAllRuns(benchDir)
  if (allRuns.length < 2) {
    console.error(`[compare] need at least 2 runs, found ${allRuns.length} in ${benchDir}`)
    process.exit(1)
  }
  return compareRuns(allRuns)
}

const compareAcrossBatches = (dirs: string[]): ComparisonResult => {
  const allRuns = dirs.map((dir) => {
    const runs = loadAllRuns(dir)
    if (runs.length === 0) {
      console.error(`[compare] no runs found in ${dir}`)
      process.exit(1)
    }

    const merged: SectionResult[] = []
    const sectionMap = new Map<string, SectionResult>()
    for (const run of runs) {
      for (const section of run) {
        const key = `${section.startLine}-${section.endLine}`
        const existing = sectionMap.get(key)
        if (!existing || section.results.length > (existing.results.length)) {
          sectionMap.set(key, section)
        }
      }
    }
    return [...sectionMap.values()]
  })

  return compareRuns(allRuns)
}

const main = () => {
  const args = mri(process.argv.slice(2), {
    string: ["out"],
  })

  const dirs = (args._ as string[]).map((d) => resolve(d))

  if (dirs.length === 0) {
    console.error("Usage: npx tsx scripts/bench/compare.ts <dir1> [dir2] [dir3...]")
    console.error("  One dir:  compare runs within a batch (intra-rater reliability)")
    console.error("  Multiple: compare across batches (inter-config reliability)")
    process.exit(1)
  }

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      console.error(`[compare] directory not found: ${dir}`)
      process.exit(1)
    }
  }

  console.log("=== Benchmark Comparison ===\n")

  for (const dir of dirs) {
    console.log(`Batch: ${dir}`)
    printBenchSummary(dir)
    console.log()
  }

  const result = dirs.length === 1
    ? compareWithinBatch(dirs[0])
    : compareAcrossBatches(dirs)

  console.log(formatComparison(result))

  if (args.out) {
    writeFileSync(resolve(args.out), JSON.stringify(result, null, 2))
    console.log(`\nResults written to: ${args.out}`)
  }
}

main()
