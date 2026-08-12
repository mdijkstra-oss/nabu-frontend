import type { RegionValueType } from "~/lib/regions/kinds/registry"
import type { Unit } from "~/lib/cutting/units"

// Every index here is a 0-based position in indexFileSentences(raw), over the whole
// document. The 1-based numbering a model sees exists only inside a request body and
// the response that comes back with it.

export type ScanUnit = Unit

export interface Hit {
  kind: string
  quote: string
  hitSentence: number
  value: string
}

export interface Mark extends Hit {
  startSentence: number
  endSentence: number
}

export interface SentenceWindow {
  start: number
  end: number
}

export interface WindowedHit {
  hit: Hit
  window: SentenceWindow
}

export interface FindInput {
  kind: string
  rules: string
  knownValues: string[]
  valueType: RegionValueType
  firstSentence: number
  sentences: string[]
}

export interface FindOutcome {
  hits: Hit[]
  errors: string[]
  dropped: number
}

export interface MarkInput {
  kind: string
  rules: string
  quote: string
  hitSentence: number
  value: string
  windowStart: number
  windowEnd: number
  sentences: string[]
}

export interface MarkOutcome {
  mark: Mark | null
  error?: string
}

export type FindCall = (input: FindInput) => Promise<FindOutcome>

export type MarkCall = (input: MarkInput) => Promise<MarkOutcome>

export interface DetectCalls {
  find: FindCall
  mark: MarkCall
}

export interface OverlapResolution {
  marks: Mark[]
  unranged: Hit[]
}
