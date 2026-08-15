import { z } from "zod"
import { describeGroup } from "~/lib/corpus/describe"
import { proseOf } from "~/lib/text/halo"
import { defineAgent } from "./types"
import { textFlag } from "./flags"

const extras = z.object({
  language: textFlag("<name>", "the language the description is written in"),
  corpus: textFlag("<name>", "the corpus the directory's files belong to"),
})

export const corpusDescriber = defineAgent({
  name: "corpus-describer",
  summary: "describe a directory of files from their prose, one call above 500 words",
  input: "directory",
  extras,
  constructedLabel: "description",
  run: ({ files, extras: { language, corpus } }) =>
    describeGroup(Object.values(files).map(proseOf), language, corpus),
})
