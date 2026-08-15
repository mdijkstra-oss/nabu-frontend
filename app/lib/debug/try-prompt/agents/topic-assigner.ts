import { z } from "zod"
import { classifyDocument, type Classification } from "~/lib/corpus/classify"
import { planClassifyFilePass } from "~/lib/corpus/sync-topics"
import { defineAgent } from "./types"
import { commaSeparatedFlag } from "./flags"
import { onlyFileOf } from "./document"

const extras = z.object({
  types: commaSeparatedFlag(
    "document types already in use, as the app would collect them"
  ).optional(),
  subjects: commaSeparatedFlag("subjects already in use, as the app would collect them").optional(),
})

export const topicAssigner = defineAgent({
  name: "topic-assigner",
  summary: "classify a file's type and subject from its excerpt, one call",
  input: "file",
  extras,
  constructedLabel: "classification",
  run: async ({ files, extras: { types, subjects } }) => {
    const { file, raw } = onlyFileOf(files)
    let captured: Classification | undefined
    const capture = (_content: string, classification: Classification): void => {
      captured = classification
    }
    const existing = { types: types ?? [], subjects: subjects ?? [] }
    await planClassifyFilePass(file, raw, existing, classifyDocument, capture).run()
    return captured
  },
})
