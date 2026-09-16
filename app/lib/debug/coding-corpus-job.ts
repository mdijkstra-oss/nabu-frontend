import type { CodingCorpusInput } from "./coding-eval"

type JsonRecord = Record<string, unknown>

const record = (value: unknown, label: string): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as JsonRecord
}

const source = (value: unknown, label: string): { path: string; markdown: string } => {
  const parsed = record(value, label)
  if (typeof parsed.path !== "string" || parsed.path.length === 0)
    throw new Error(`${label}.path must be a non-empty string`)
  if (typeof parsed.markdown !== "string") throw new Error(`${label}.markdown must be a string`)
  return { path: parsed.path, markdown: parsed.markdown }
}

export const parseCodingCorpusJob = (value: unknown): CodingCorpusInput => {
  const parsed = record(value, "Coding job")
  if (!Array.isArray(parsed.documents) || parsed.documents.length === 0)
    throw new Error("Coding job.documents must be a non-empty array")
  if (!Array.isArray(parsed.dimensions) || parsed.dimensions.length === 0)
    throw new Error("Coding job.dimensions must be a non-empty array")
  const framework = source(parsed.framework, "Coding job.framework")
  return {
    frameworkPath: framework.path,
    frameworkMarkdown: framework.markdown,
    dimensions: parsed.dimensions.map((item, index) =>
      source(item, `Coding job.dimensions[${index}]`)
    ),
    documents: parsed.documents.map((item, index) =>
      source(item, `Coding job.documents[${index}]`)
    ),
  }
}
