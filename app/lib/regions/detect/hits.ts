import { findMatchOffset } from "~/lib/text/find"
import { normalizeValue } from "./normalize"
import { toSentenceIndex } from "./payload"
import type { FindResult } from "./schema"
import type { FindInput, Hit } from "./types"

export interface GatedHits {
  hits: Hit[]
  dropped: number
}

const isInsideUnit = (scan: FindInput, sentenceIndex: number): boolean =>
  sentenceIndex >= scan.firstSentence &&
  sentenceIndex <= scan.firstSentence + scan.sentences.length - 1

const STRICT = true

const occursIn = (sentence: string, quote: string): boolean =>
  findMatchOffset(sentence, quote, STRICT) !== null

const locateQuote = (scan: FindInput, named: number, quote: string): number | null => {
  if (occursIn(scan.sentences[named - scan.firstSentence], quote)) return named
  const elsewhere = scan.sentences.findIndex((sentence) => occursIn(sentence, quote))
  return elsewhere === -1 ? null : scan.firstSentence + elsewhere
}

const toHit = (scan: FindInput, found: FindResult): Hit | null => {
  const named = toSentenceIndex(found.sentence)
  if (!isInsideUnit(scan, named)) return null

  const hitSentence = locateQuote(scan, named, found.quote)
  if (hitSentence === null) return null

  const value = normalizeValue(scan.valueType, found.value)
  if (value === null) return null

  return { kind: scan.kind, quote: found.quote, hitSentence, value }
}

// A separator no value can contain, so two occurrences can only collide by genuinely
// naming the same sentence and the same value.
const occurrenceOf = (hit: Hit): string => `${hit.hitSentence}\u0000${hit.value}`

export const gateResults = (scan: FindInput, results: FindResult[]): GatedHits => {
  const hits: Hit[] = []
  const seen = new Set<string>()

  for (const found of results) {
    const hit = toHit(scan, found)
    if (!hit || seen.has(occurrenceOf(hit))) continue
    seen.add(occurrenceOf(hit))
    hits.push(hit)
  }

  return { hits, dropped: results.length - hits.length }
}
