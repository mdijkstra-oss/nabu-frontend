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
import type { CodingCorpusResult, CodingFileResult } from "~/lib/debug/coding-eval"

const writeJson = (path: string, value: unknown): void =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n")

const runWorker = (
  goldDir: string,
  gateway: string,
  resultPath: string
): Promise<{ result: CodingCorpusResult; diagnostics: string }> =>
  new Promise((finish) => {
    const started = performance.now()
    const cli = resolve("node_modules/vite-node/vite-node.mjs")
    const worker = resolve("scripts/eval-coding-worker.ts")
    const child = spawn(process.execPath, [
      cli,
      worker,
      "--gold-dir",
      goldDir,
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
        const result = JSON.parse(readFileSync(resultPath, "utf8")) as CodingCorpusResult
        finish({ result, diagnostics: diagnostics.trim() })
        return
      }
      finish({
        result: {
          documents: [],
          latencyMs: Math.round(performance.now() - started),
          requests: [],
          retries: 0,
        },
        diagnostics: diagnostics.trim() || "Worker exited without a result",
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

  const workerResultPath = resolve(workerDir, "corpus.json")
  const { result, diagnostics } = await runWorker(dataset.root, parsed.gateway, workerResultPath)
  const resultByPath = new Map(result.documents.map((document) => [document.path, document]))
  const missingResult = (path: string): CodingFileResult => ({
    path,
    status: "failed",
    generatedMarkdown: "",
    annotationCount: null,
    warnings: [],
    failures: [diagnostics || `Worker returned no result for ${path}`],
  })
  const outcomes: CodingDocumentOutcome[] = dataset.documents.map((document, index) => {
    const generated = resultByPath.get(document.name) ?? missingResult(document.name)
    let status = generated.status
    let comparison
    const failures = [...generated.failures]
    if (status === "success" || status === "empty") {
      try {
        comparison = compareCodingDocuments(generated.generatedMarkdown, document.markdown)
      } catch (error) {
        status = "malformed"
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    const outcome: CodingDocumentOutcome = {
      name: document.name,
      status,
      annotationCount: generated.annotationCount,
      warnings: [...generated.warnings],
      failures,
      ...(comparison ? { comparison } : {}),
    }
    const stem = basename(document.name, ".md")
    writeFileSync(resolve(output, `${stem}.generated.md`), generated.generatedMarkdown)
    writeJson(resolve(output, `${stem}.outcome.json`), {
      ...outcome,
      comparison: undefined,
    })
    writeJson(
      resolve(output, `${stem}.items.json`),
      comparison ?? { matches: [], errors: [...outcome.warnings, ...outcome.failures] }
    )
    console.log(`[${index + 1}/${dataset.documents.length}] ${document.name}: ${status}`)
    return outcome
  })
  rmSync(workerDir, { recursive: true })
  const results = aggregateCodingResults(
    outcomes,
    dataset.dimensions.map((dimension) => dimension.id),
    {
      latencyMs: result.latencyMs,
      requests: result.requests,
      retries: result.retries,
      diagnostics: diagnostics ? [diagnostics] : [],
    }
  )
  writeJson(resolve(output, "results.json"), results)
  console.log(formatCodingSummary(results))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
