import { readCorpusDocument } from "~/lib/text/fixtures/corpus"
import { indexProseSentences, proseOf, type SentenceRow } from "~/lib/text/halo"
import { DEFAULT_CUT_RULE, type BoundaryTest, type CutRule } from "./units"

export interface Document {
  prose: string
  rows: SentenceRow[]
}

export const fixtureDocument = (name: string): Document => {
  const prose = proseOf(readCorpusDocument(name))
  return { prose, rows: indexProseSentences(prose) }
}

// One space between sentences, so a row's offsets and the prose it indexes agree the way
// the real deriver's do without going through the segmenter.
export const documentOfSentences = (texts: readonly string[]): Document => {
  let cursor = 0
  const rows = texts.map((text) => {
    const start = cursor
    cursor = start + text.length + 1
    return { text, start, end: start + text.length }
  })
  return { prose: texts.join(" "), rows }
}

export const sentenceOfLength = (index: number, length: number): string =>
  `S${index} `.padEnd(length - 1, "x").slice(0, length - 1) + "."

// One predicate for both sides of the target, so a case about the floor, the ceiling or
// the shape of a unit is not also a case about which mask a gap was tested with. The bounds
// it is not exercising stay at their real values.
export const ruleWith = (isBoundary: BoundaryTest): CutRule => ({
  ...DEFAULT_CUT_RULE,
  strict: isBoundary,
  loose: isBoundary,
})
