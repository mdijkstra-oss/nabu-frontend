import { UNIT_CEILING_CHARS } from "~/lib/cutting/constants"
import type { KindDescriptor } from "~/lib/regions/kinds/registry"
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

export interface FindWork {
  file: string
  unit: ScanUnit
  sentences: string[]
}

export interface FindJob {
  kind: KindDescriptor
  knownValues: Set<string>
  onAnswered: (work: FindWork, hits: Hit[]) => void
  onAbandoned?: (work: FindWork) => void
}

export interface FindRunResult {
  unrecorded: FindWork[]
}

export type FindCall = (items: FindWork[], job: FindJob) => Promise<FindRunResult>

export interface MarkWork {
  file: string
  sentences: string[]
  hit: Hit
  window: SentenceWindow
}

export interface MarkJob {
  kind: KindDescriptor
  onAnswered: (work: MarkWork, mark: Mark) => void
  onFailed: (work: MarkWork) => void
}

export type MarkCall = (items: MarkWork[], job: MarkJob) => Promise<void>

export interface DetectCalls {
  find: FindCall
  mark: MarkCall
}

export interface Stretch {
  file: string
  sentences: string[]
  window: SentenceWindow
  works: MarkWork[]
}

export const FIND_MAX_ITEMS = 20

// One per-call character budget for both detect stages; find and mark diverge
// here first if they ever need to.
export const DETECT_CALL_MAX_CHARS = FIND_MAX_ITEMS * UNIT_CEILING_CHARS
