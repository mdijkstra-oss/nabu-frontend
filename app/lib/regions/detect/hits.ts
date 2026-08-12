import { findMatchOffset } from "~/lib/text/find"
import { neutralizeMarkdown } from "~/lib/text/mark"
import type { RegionValueType } from "~/lib/regions/kinds/registry"
import { normalizeValue } from "./normalize"
import type { FindWork, Hit } from "./types"

// One reported occurrence after its ref resolved: the quote, the 0-based sentence
// index within the entry the ref named, and the raw value.
export interface OccurrenceCandidate {
  quote: string
  sentenceIndex: number
  value: string
}

export const gateOccurrences = (
  kind: string,
  valueType: RegionValueType,
  work: FindWork,
  occurrences: OccurrenceCandidate[]
): Hit[] => {
  const hits: Hit[] = []
  const seen = new Set<string>()

  for (const candidate of occurrences) {
    const hit = toHit(kind, valueType, work, candidate)
    if (!hit || seen.has(occurrenceOf(hit))) continue
    seen.add(occurrenceOf(hit))
    hits.push(hit)
  }

  return hits
}

const STRICT = true

interface Located {
  localIndex: number
  quote: string
}

// The model quotes what reads as text, so a quote spanning a link would never match the
// sentence's own tokens. Neutralizing puts the reader's words in front of the tokenizer,
// and neutralizing preserves length, so the offsets it returns are valid in the original.
const locateIn = (sentence: string, quote: string): string | null => {
  const match = findMatchOffset(neutralizeMarkdown(sentence), quote, STRICT)
  return match === null ? null : sentence.slice(match.start, match.end)
}

const locateQuote = (sentences: string[], named: number, quote: string): Located | null => {
  const inNamed = locateIn(sentences[named], quote)
  if (inNamed !== null) return { localIndex: named, quote: inNamed }

  for (let i = 0; i < sentences.length; i++) {
    const elsewhere = locateIn(sentences[i], quote)
    if (elsewhere !== null) return { localIndex: i, quote: elsewhere }
  }
  return null
}

const toHit = (
  kind: string,
  valueType: RegionValueType,
  work: FindWork,
  candidate: OccurrenceCandidate
): Hit | null => {
  const located = locateQuote(work.sentences, candidate.sentenceIndex, candidate.quote)
  if (located === null) return null

  const value = normalizeValue(valueType, candidate.value)
  if (value === null) return null

  return {
    kind,
    quote: located.quote,
    hitSentence: work.unit.firstSentence + located.localIndex,
    value,
  }
}

// A separator no value can contain, so two occurrences can only collide by genuinely
// naming the same sentence and the same value.
export const occurrenceOf = (hit: Hit): string => `${hit.hitSentence}\u0000${hit.value}`
