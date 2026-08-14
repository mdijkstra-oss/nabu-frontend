import type { FileStore } from "~/lib/files/store"
import { extractProse } from "~/lib/data-blocks/parse"
import { buildExcerpt } from "~/lib/text/excerpt"
import { shouldReclassify, contentHash } from "~/domain/data-blocks/attributes/topics/selectors"
import { executeFileAction } from "~/lib/data-blocks/file-action"
import type { classifyDocument, Classification, ExistingClassifications } from "./classify"
import { collectTypeCounts, collectSubjectCounts } from "./tree"
import type { StagePassPlan } from "~/lib/engine/types"

export const collectExisting = (files: FileStore): ExistingClassifications => ({
  types: [...collectTypeCounts(files).keys()],
  subjects: [...collectSubjectCounts(files).keys()],
})

export const planClassifyFilePass = (
  filename: string,
  content: string,
  existing: ExistingClassifications,
  classify: typeof classifyDocument,
  writeClassification: typeof writeClassificationToAttributes = writeClassificationToAttributes
): StagePassPlan => {
  if (!shouldReclassify(content)) return { dirty: false, run: () => Promise.resolve() }

  return {
    dirty: true,
    run: async () => {
      const excerpt = toExcerpt(content)
      if (excerpt.length === 0) return

      const classification = await classify(excerpt, existing)
      if (!classification) {
        console.warn(`[classify] no classification for ${filename}`)
        return
      }

      writeClassification(content, classification, filename)
    },
  }
}

const TOKENS_PER_SECTION = 250

const toExcerpt = (raw: string): string => {
  const prose = extractProse(raw)
  return buildExcerpt(prose, TOKENS_PER_SECTION)
}

export const writeClassificationToAttributes = (
  content: string,
  classification: Classification,
  filename: string
): void => {
  executeFileAction({
    patches: [
      {
        path: filename,
        language: "json-attributes",
        ops: [
          { op: "add", path: "/type", value: classification.type },
          { op: "add", path: "/subject", value: classification.subject },
          { op: "add", path: "/hash", value: contentHash(content) },
        ],
      },
    ],
    skipPendingRefs: true,
  })
}
