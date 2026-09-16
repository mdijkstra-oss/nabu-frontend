import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import mri from "mri"
import { setLlmHostForProcess } from "~/lib/agent/env"
import { stripBlocksByLanguage } from "~/lib/data-blocks/parse"
import { loadCodingEvalDataset } from "~/lib/debug/coding-eval-dataset"
import {
  parseBoolean,
  parseCoders,
  parsePassthrough,
  runCodingCorpus,
  type CodingCorpusResult,
} from "~/lib/debug/coding-eval"

const args = mri(process.argv.slice(2), {
  string: ["gold-dir", "gateway", "result", "passthrough", "coders", "adjudicate"],
})
const required = (name: string): string => {
  const value = args[name]
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing --${name}`)
  return value
}

const resultPath = resolve(required("result"))
let fallbackDocuments: { path: string; markdown: string }[] = []
try {
  const dataset = loadCodingEvalDataset(required("gold-dir"))
  fallbackDocuments = dataset.documents.map((document) => ({
    path: document.name,
    markdown: stripBlocksByLanguage(document.markdown, "json-annotations"),
  }))
  setLlmHostForProcess(required("gateway"))
  const result = await runCodingCorpus(
    {
      documents: fallbackDocuments,
      frameworkPath: "codebook.framework.md",
      frameworkMarkdown: dataset.frameworkMarkdown,
      dimensions: dataset.dimensions.map((dimension) => ({
        path: `codes/${dimension.id}.md`,
        markdown: dimension.markdown,
      })),
    },
    {},
    {
      passthrough: parsePassthrough(required("passthrough")),
      coders: parseCoders(required("coders")),
      adjudicate: parseBoolean(required("adjudicate"), "adjudicate"),
    }
  )
  writeFileSync(resultPath, JSON.stringify(result))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const result: CodingCorpusResult = {
    documents: fallbackDocuments.map((document) => ({
      path: document.path,
      status: "failed",
      generatedMarkdown: document.markdown,
      annotationCount: null,
      warnings: [],
      failures: [message],
    })),
    latencyMs: 0,
    requests: [],
    retries: 0,
  }
  writeFileSync(resultPath, JSON.stringify(result))
  process.exitCode = 1
}
