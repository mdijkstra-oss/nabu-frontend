import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import mri from "mri"
import { setLlmHostForProcess } from "~/lib/agent/env"
import { stripBlocksByLanguage } from "~/lib/data-blocks/parse"
import { loadCodingEvalDataset } from "~/lib/debug/coding-eval-dataset"
import { runCodingDocument, type CodingDocumentResult } from "~/lib/debug/coding-eval"

const args = mri(process.argv.slice(2), {
  string: ["gold-dir", "document", "gateway", "result"],
})
const required = (name: string): string => {
  const value = args[name]
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing --${name}`)
  return value
}

const resultPath = resolve(required("result"))
let fallbackMarkdown = ""
try {
  const dataset = loadCodingEvalDataset(required("gold-dir"))
  const documentName = required("document")
  const document = dataset.documents.find((item) => item.name === documentName)
  if (!document) throw new Error(`Dataset has no document named ${documentName}`)
  fallbackMarkdown = stripBlocksByLanguage(document.markdown, "json-annotations")
  setLlmHostForProcess(required("gateway"))
  const result = await runCodingDocument({
    inputPath: document.name,
    inputMarkdown: fallbackMarkdown,
    frameworkPath: "codebook.framework.md",
    frameworkMarkdown: dataset.frameworkMarkdown,
    dimensions: dataset.dimensions.map((dimension) => ({
      path: `codes/${dimension.id}.md`,
      markdown: dimension.markdown,
    })),
  })
  writeFileSync(resultPath, JSON.stringify(result))
} catch (error) {
  const result: CodingDocumentResult = {
    status: "failed",
    generatedMarkdown: fallbackMarkdown,
    annotationCount: null,
    latencyMs: 0,
    requests: [],
    retries: 0,
    warnings: [],
    failures: [error instanceof Error ? error.message : String(error)],
  }
  writeFileSync(resultPath, JSON.stringify(result))
  process.exitCode = 1
}
