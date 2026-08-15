import { z } from "zod"
import { runFind } from "~/lib/regions/detect/find"
import type { FindWork, Hit } from "~/lib/regions/detect/types"
import { defineAgent } from "./types"
import { commaSeparatedFlag, kindFlag } from "./flags"
import { onlyFileOf, scanDocument, type ScannedDocument } from "./document"

const extras = z.object({
  kind: kindFlag,
  known: commaSeparatedFlag("values already known, as the app would seed them").optional(),
})

export const findWorksOf = (doc: ScannedDocument): FindWork[] =>
  doc.units.map((unit) => ({
    file: doc.file,
    unit,
    sentences: doc.sentences.slice(unit.firstSentence, unit.lastSentence + 1),
  }))

export const regionFinder = defineAgent({
  name: "region-finder",
  summary: "find every occurrence of a region kind, one call per batch of scan units",
  input: "file",
  extras,
  constructedLabel: "hits",
  run: async ({ files, extras: { kind, known } }) => {
    const { file, raw } = onlyFileOf(files)
    const hits: Hit[] = []
    await runFind(findWorksOf(scanDocument(file, raw)), {
      kind,
      knownValues: new Set(known ?? []),
      onAnswered: (_, found) => hits.push(...found),
    })
    return hits
  },
})
