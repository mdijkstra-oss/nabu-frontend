import { z } from "zod"
import type { SearchHit } from "~/domain/search/types"
import { verdict } from "~/lib/search/verdict"
import { noop } from "~/lib/utils/noop"
import { defineAgent } from "./types"
import { textFlag } from "./flags"
import { onlyFileOf, scanDocument, type ScannedDocument } from "./document"

const extras = z.object({
  intent: textFlag("<text>", "the search intent the filter judges each passage against"),
})

export const unitHitsOf = (doc: ScannedDocument): SearchHit[] =>
  doc.units.map((unit) => ({
    file: doc.file,
    text: doc.sentences.slice(unit.firstSentence, unit.lastSentence + 1).join(" "),
  }))

export const semanticFilter = defineAgent({
  name: "semantic-filter",
  summary: "ask which passages of the file satisfy a search intent, one scan unit per entry",
  input: "file",
  extras,
  constructedLabel: "kept hits",
  run: async ({ files, extras: { intent } }) => {
    const { file, raw } = onlyFileOf(files)
    const hits = unitHitsOf(scanDocument(file, raw))
    const { results } = await verdict(hits, intent, "", files, noop)
    return results
  },
})
