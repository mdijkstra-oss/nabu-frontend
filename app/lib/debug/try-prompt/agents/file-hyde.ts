import { z } from "zod"
import { generateFileHydes } from "~/lib/corpus/generate-file-hydes"
import { defineAgent } from "./types"
import { textFlag } from "./flags"
import { onlyFileOf } from "./document"

const extras = z.object({
  language: textFlag("<name>", "the language the passages are written in"),
})

export const fileHyde = defineAgent({
  name: "file-hyde",
  summary: "generate hypothetical passages for a whole file, one call",
  input: "file",
  extras,
  constructedLabel: "passages",
  run: async ({ files, extras: { language } }) => {
    const { file, raw } = onlyFileOf(files)
    const { inclusions } = await generateFileHydes(raw, file, language)
    return inclusions
  },
})
