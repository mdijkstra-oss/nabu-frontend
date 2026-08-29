import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import {
  buildCodingRunManifest,
  CODING_BATCH_HELP,
  parseCodingBatchArgs,
  preflightCodingGateway,
} from "~/lib/debug/coding-eval-batch"
import { loadCodingEvalDataset } from "~/lib/debug/coding-eval-dataset"
import { compareCodingDocuments } from "~/lib/debug/coding-eval-comparison"
import {
  aggregateCodingResults,
  formatCodingSummary,
  type CodingDocumentOutcome,
} from "~/lib/debug/coding-eval-report"
import type { CodingDocumentResult } from "~/lib/debug/coding-eval"

const writeJson = (path: string, value: unknown): void =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n")

const runWorker = (
  goldDir: string,
  document: string,
  gateway: string,
  resultPath: string
): Promise<{ result: CodingDocumentResult; diagnostics: string }> =>
  new Promise((finish) => {
    const started = performance.now()
    const cli = resolve("node_modules/vite-node/vite-node.mjs")
    const worker = resolve("scripts/eval-coding-worker.ts")
    const child = spawn(process.execPath, [
      cli,
      worker,
      "--gold-dir",
      goldDir,
      "--document",
      document,
      "--gateway",
      gateway,
      "--result",
      resultPath,
    ])
    let diagnostics = ""
    child.stdout.on("data", (chunk) => (diagnostics += String(chunk)))
    child.stderr.on("data", (chunk) => (diagnostics += String(chunk)))
    child.on("error", (error) => (diagnostics += error.message))
    child.on("close", () => {
      if (existsSync(resultPath)) {
        const result = JSON.parse(readFileSync(resultPath, "utf8")) as CodingDocumentResult
        finish({ result, diagnostics: diagnostics.trim() })
        return
      }
      finish({
        result: {
          status: "failed",
          generatedMarkdown: "",
          annotationCount: null,
          latencyMs: Math.round(performance.now() - started),
          requests: [],
          retries: 0,
          warnings: [],
          failures: [diagnostics.trim() || "Worker exited without a result"],
        },
        diagnostics: diagnostics.trim(),
      })
    })
  })

const main = async (): Promise<void> => {
  const parsed = parseCodingBatchArgs(process.argv.slice(2))
  if ("help" in parsed) {
    console.log(CODING_BATCH_HELP)
    return
  }
  const output = resolve(parsed.output)
  if (existsSync(output)) throw new Error(`Output directory already exists: ${output}`)
  const dataset = loadCodingEvalDataset(parsed.goldDir)
  await preflightCodingGateway(parsed.gateway)
  mkdirSync(output, { recursive: true })
  const workerDir = resolve(output, ".workers")
  mkdirSync(workerDir)
  writeJson(resolve(output, "run.json"), buildCodingRunManifest(dataset, parsed))

  const outcomes: CodingDocumentOutcome[] = []
  let next = 0
  const consume = async (): Promise<void> => {
    while (next < dataset.documents.length) {
      const index = next++
      const document = dataset.documents[index]
      const stem = basename(document.name, ".md")
      const workerResultPath = resolve(workerDir, `${stem}.json`)
      const { result, diagnostics } = await runWorker(
        dataset.root,
        document.name,
        parsed.gateway,
        workerResultPath
      )
      let status = result.status
      let comparison
      const failures = [...result.failures]
      if (status === "success" || status === "empty") {
        try {
          comparison = compareCodingDocuments(result.generatedMarkdown, document.markdown)
        } catch (error) {
          status = "malformed"
          failures.push(error instanceof Error ? error.message : String(error))
        }
      }
      const outcome: CodingDocumentOutcome = {
        name: document.name,
        status,
        annotationCount: result.annotationCount,
        latencyMs: result.latencyMs,
        requests: result.requests,
        retries: result.retries,
        warnings: [...result.warnings, ...(diagnostics ? [diagnostics] : [])],
        failures,
        ...(comparison ? { comparison } : {}),
      }
      outcomes[index] = outcome
      writeFileSync(resolve(output, `${stem}.generated.md`), result.generatedMarkdown)
      writeJson(resolve(output, `${stem}.outcome.json`), {
        ...outcome,
        comparison: undefined,
      })
      writeJson(
        resolve(output, `${stem}.items.json`),
        comparison ?? { matches: [], errors: [...outcome.warnings, ...outcome.failures] }
      )
      console.log(`[${index + 1}/${dataset.documents.length}] ${document.name}: ${status}`)
    }
  }
  await Promise.all(Array.from({ length: parsed.documentsInFlight }, () => consume()))
  rmSync(workerDir, { recursive: true })
  const results = aggregateCodingResults(
    outcomes,
    dataset.dimensions.map((dimension) => dimension.id)
  )
  writeJson(resolve(output, "results.json"), results)
  console.log(formatCodingSummary(results))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
