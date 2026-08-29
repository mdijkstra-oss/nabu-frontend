import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { basename, resolve } from "node:path"
import type { Annotation } from "~/domain/data-blocks/attributes/schema"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { CalloutSchema, type CalloutBlock } from "~/domain/data-blocks/callout/schema"
import { getBlocksStrict } from "~/lib/data-blocks/query"
import {
  findBlocksByLanguage,
  formatBlock,
  formatBlockJson,
  stripBlocksByLanguage,
} from "~/lib/data-blocks/parse"
import { proseOf } from "~/lib/text/halo"

export interface CodingEvalDimension {
  id: string
  markdown: string
}

export interface CodingEvalDocument {
  name: string
  path: string
  markdown: string
  prose: string
  annotations: Annotation[]
  hash: string
}

export interface CodingEvalDataset {
  root: string
  codebookPath: string
  codebookMarkdown: string
  codebookHash: string
  frameworkMarkdown: string
  dimensions: CodingEvalDimension[]
  documents: CodingEvalDocument[]
  datasetHash: string
}

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")

export const parseCombinedCodebook = (
  markdown: string
): { frameworkMarkdown: string; dimensions: CodingEvalDimension[] } => {
  const calloutBlocks = findBlocksByLanguage(markdown, "json-callout")
  const callouts = getBlocksStrict(markdown, "json-callout", CalloutSchema)
  if (calloutBlocks.length === 0 || callouts.length !== calloutBlocks.length)
    throw new Error("codebook.md contains a malformed json-callout block")

  const ids = callouts.map((callout) => callout.id)
  if (new Set(ids).size !== ids.length)
    throw new Error("codebook.md contains duplicate callout IDs")

  return {
    frameworkMarkdown: stripBlocksByLanguage(markdown, "json-callout"),
    dimensions: callouts.map((callout: CalloutBlock) => ({
      id: callout.id,
      markdown: formatBlock("json-callout", formatBlockJson(callout)),
    })),
  }
}

const readGoldAnnotations = (markdown: string, name: string): Annotation[] => {
  const blocks = findBlocksByLanguage(markdown, "json-annotations")
  const parsed = getBlocksStrict(markdown, "json-annotations", AnnotationsBlockSchema)
  if (blocks.length !== 1 || parsed.length !== 1)
    throw new Error(`${name} must contain one schema-valid json-annotations block`)
  return parsed[0].annotations
}

export const loadCodingEvalDataset = (goldDir: string): CodingEvalDataset => {
  const root = resolve(goldDir)
  const codebookPath = resolve(root, "codebook.md")
  const codebookMarkdown = readFileSync(codebookPath, "utf8")
  const { frameworkMarkdown, dimensions } = parseCombinedCodebook(codebookMarkdown)
  const corpusDir = resolve(root, "corpus")
  const paths = readdirSync(corpusDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => resolve(corpusDir, entry.name))
    .sort((a, b) => basename(a).localeCompare(basename(b)))
  if (paths.length === 0) throw new Error(`${corpusDir} contains no Markdown documents`)

  const documents = paths.map((path): CodingEvalDocument => {
    const name = basename(path)
    const markdown = readFileSync(path, "utf8")
    return {
      name,
      path,
      markdown,
      prose: proseOf(markdown),
      annotations: readGoldAnnotations(markdown, name),
      hash: sha256(markdown),
    }
  })
  const datasetHash = sha256(
    documents.map((document) => `${document.name}\0${document.hash}`).join("\n")
  )
  return {
    root,
    codebookPath,
    codebookMarkdown,
    codebookHash: sha256(codebookMarkdown),
    frameworkMarkdown,
    dimensions,
    documents,
    datasetHash,
  }
}
