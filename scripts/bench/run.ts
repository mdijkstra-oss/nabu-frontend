import { readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { resolve, basename, relative } from "node:path"
import { minimatch } from "minimatch"
import mri from "mri"
import { analyzeFile } from "./pipeline"
import { killOnPort, spawnServer, waitForPort } from "./server"
import { parseServerLog } from "./costs"
import type { BenchConfig, BenchMeta, CallRecord, RunOutput, SectionResult } from "./types"
import type { SourceFile } from "~/lib/agent/tools/apply-deep-analysis/def"

const PORT = 8081

const formatTimestamp = (date: Date): string =>
  date.toISOString().replace(/[:.]/g, "-").replace("Z", "")

const resolveGlobs = (patterns: string[]): string[] => {
  const results: string[] = []
  for (const pattern of patterns) {
    if (!pattern.includes("*") && !pattern.includes("?")) {
      results.push(resolve(pattern))
      continue
    }

    const dir = resolve(pattern.split("*")[0] || ".")
    const base = dir.endsWith("/") ? dir : resolve(dir, "..")
    try {
      const files = walkDir(base)
      const rel = (f: string) => relative(base, f)
      const globPart = pattern.includes("/") ? basename(pattern) : pattern
      for (const file of files) {
        if (minimatch(rel(file), globPart) || minimatch(basename(file), globPart)) {
          results.push(file)
        }
      }
    } catch {
      console.error(`[bench] glob pattern matched no files: ${pattern}`)
    }
  }
  return [...new Set(results)].sort()
}

const walkDir = (dir: string): string[] => {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((e) =>
    e.isDirectory() ? walkDir(resolve(dir, e.name)) : [resolve(dir, e.name)]
  )
}

const toStringArray = (val: unknown): string[] => {
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === "string") return [val]
  return []
}

const parseCliArgs = (): BenchConfig => {
  const args = mri(process.argv.slice(2), {
    string: ["target", "framework", "dimension", "label", "out", "host"],
    default: { runs: 3, host: `http://localhost:${PORT}`, out: "benchmarks", label: "bench" },
  })

  const target = args.target
  if (!target || typeof target !== "string") {
    console.error("Usage: npx tsx scripts/bench/run.ts --target <file> --framework <glob> --dimension <glob> [--runs N] [--label name] [--out dir]")
    process.exit(1)
  }

  return {
    label: String(args.label),
    target: resolve(target),
    framework: resolveGlobs(toStringArray(args.framework)),
    dimensions: resolveGlobs(toStringArray(args.dimension)),
    runs: Number(args.runs) || 3,
    host: String(args.host),
    outDir: String(args.out),
  }
}

const buildContentMap = (config: BenchConfig): Map<string, string> => {
  const map = new Map<string, string>()
  const allPaths = [config.target, ...config.framework, ...config.dimensions]
  for (const fullPath of allPaths) {
    const content = readFileSync(fullPath, "utf-8")
    map.set(fullPath, content)
  }
  return map
}

const buildSourceFiles = (config: BenchConfig): SourceFile[] => [
  ...config.framework.map((p) => ({ path: p, scope: "framework" as const })),
  ...config.dimensions.map((p) => ({ path: p, scope: "dimension" as const })),
]

const padIndex = (i: number): string => String(i).padStart(3, "0")

const main = async () => {
  const config = parseCliArgs()

  console.log(`[bench] target:     ${config.target}`)
  console.log(`[bench] framework:  ${config.framework.join(", ") || "(none)"}`)
  console.log(`[bench] dimensions: ${config.dimensions.join(", ") || "(none)"}`)
  console.log(`[bench] runs:       ${config.runs}`)
  console.log(`[bench] label:      ${config.label}`)
  console.log(`[bench] host:       ${config.host}`)

  const contentMap = buildContentMap(config)
  const targetContent = contentMap.get(config.target)!
  const sourceFiles = buildSourceFiles(config)
  const resolve_ = (path: string): string | undefined => contentMap.get(path)

  const timestamp = formatTimestamp(new Date())
  const outDir = resolve(config.outDir, `${timestamp}_${config.label}`)
  mkdirSync(outDir, { recursive: true })

  const logPath = resolve(outDir, "server.log")
  const isLocalServer = config.host.includes("localhost") || config.host.includes("127.0.0.1")

  let server: ReturnType<typeof spawnServer> | null = null
  if (isLocalServer) {
    console.log("[bench] starting server...")
    killOnPort(PORT)
    server = spawnServer(logPath, PORT)
    await waitForPort(PORT)
    console.log("[bench] server ready")
  }

  const startedAt = new Date()
  const runs: RunOutput[] = []

  try {
    for (let i = 0; i < config.runs; i++) {
      console.log(`\n[bench] === run ${i + 1}/${config.runs} ===`)
      const runStart = performance.now()
      const calls: CallRecord[] = []

      const sections = await analyzeFile({
        targetContent,
        sourceFiles,
        resolve: resolve_,
        host: config.host,
        calls,
      })

      const durationMs = Math.round(performance.now() - runStart)
      const run: RunOutput = { index: i, sections, calls, durationMs }
      runs.push(run)

      const runDir = resolve(outDir, `run-${padIndex(i)}`)
      mkdirSync(runDir, { recursive: true })
      writeFileSync(resolve(runDir, "codings.json"), JSON.stringify(sections, null, 2))
      writeFileSync(resolve(runDir, "calls.json"), JSON.stringify(calls, null, 2))

      const totalCodings = sections.reduce((sum, s) => sum + s.results.length, 0)
      console.log(`[bench] run ${i + 1}: ${totalCodings} codings in ${durationMs}ms`)
    }
  } finally {
    if (server) {
      console.log("[bench] stopping server...")
      server.kill()
    }
  }

  const completedAt = new Date()
  const durationMs = completedAt.getTime() - startedAt.getTime()

  const meta: BenchMeta = {
    label: config.label,
    target: config.target,
    framework: config.framework,
    dimensions: config.dimensions,
    runs: config.runs,
    host: config.host,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs,
  }
  writeFileSync(resolve(outDir, "meta.json"), JSON.stringify(meta, null, 2))

  if (isLocalServer) {
    try {
      const costs = parseServerLog(logPath)
      writeFileSync(resolve(outDir, "costs.json"), JSON.stringify(costs, null, 2))
      console.log(`\n[bench] costs: $${costs.total.costUsd.toFixed(4)} (${costs.total.calls} calls)`)
      for (const [endpoint, data] of Object.entries(costs.byEndpoint)) {
        console.log(`  ${endpoint}: $${data.costUsd.toFixed(4)} (${data.calls} calls)`)
      }
    } catch {
      console.log("[bench] could not parse server log for costs")
    }
  }

  console.log(`\n[bench] done — ${config.runs} runs in ${durationMs}ms`)
  console.log(`[bench] output: ${outDir}`)
}

main().catch((err) => {
  console.error("[bench] fatal:", err)
  process.exit(1)
})
