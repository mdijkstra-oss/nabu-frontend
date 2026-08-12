import { findMatchOffset } from "~/lib/text/find"
import { neutralizeMarkdown } from "~/lib/text/mark"
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

interface Located {
  hitSentence: number
  quote: string
}

// The model quotes what reads as text, so a quote spanning a link would never match the
// sentence's own tokens. Neutralizing puts the reader's words in front of the tokenizer,
// and neutralizing preserves length, so the offsets it returns are valid in the original.
const locateIn = (sentence: string, quote: string): string | null => {
  const match = findMatchOffset(neutralizeMarkdown(sentence), quote, STRICT)
  return match === null ? null : sentence.slice(match.start, match.end)
}

const locateQuote = (scan: FindInput, named: number, quote: string): Located | null => {
  const inNamed = locateIn(scan.sentences[named - scan.firstSentence], quote)
  if (inNamed !== null) return { hitSentence: named, quote: inNamed }

  for (let i = 0; i < scan.sentences.length; i++) {
    const elsewhere = locateIn(scan.sentences[i], quote)
    if (elsewhere !== null) return { hitSentence: scan.firstSentence + i, quote: elsewhere }
  }
  return null
}

const toHit = (scan: FindInput, found: FindResult): Hit | null => {
  const named = toSentenceIndex(found.sentence)
  if (!isInsideUnit(scan, named)) return null

  const located = locateQuote(scan, named, found.quote)
  if (located === null) return null

  const value = normalizeValue(scan.valueType, found.value)
  if (value === null) return null

  return { kind: scan.kind, quote: located.quote, hitSentence: located.hitSentence, value }
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
