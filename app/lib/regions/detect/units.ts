import { CHUNK_CHARS } from "~/lib/embeddings/constants"
import { fnvHash } from "~/lib/utils/hash"
import type { ScanUnit } from "./types"

const joinSentences = (sentences: string[]): string => sentences.join(" ")

// The one recipe. A unit's hash and a mark's rangeHash are the same function over
// different ranges, and the writer and the re-deriver have to agree on the separator.
export const hashSentences = (sentences: string[]): string => fnvHash(joinSentences(sentences))

const lengthWith = (joinedLength: number, next: string): number =>
  joinedLength === 0 ? next.length : joinedLength + 1 + next.length

const toUnit = (sentences: string[], firstSentence: number): ScanUnit => ({
  firstSentence,
  lastSentence: firstSentence + sentences.length - 1,
  sentences,
  hash: hashSentences(sentences),
})

export const accumulateScanUnits = (sentences: string[]): ScanUnit[] => {
  const units: ScanUnit[] = []
  let current: string[] = []
  let firstSentence = 0
  let joinedLength = 0

  sentences.forEach((sentence, index) => {
    if (current.length > 0 && lengthWith(joinedLength, sentence) > CHUNK_CHARS) {
      units.push(toUnit(current, firstSentence))
      current = []
      firstSentence = index
      joinedLength = 0
    }
    joinedLength = lengthWith(joinedLength, sentence)
    current.push(sentence)
  })

  if (current.length > 0) units.push(toUnit(current, firstSentence))
  return units
}
