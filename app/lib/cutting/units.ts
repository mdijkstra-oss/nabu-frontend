import { fnvHash } from "~/lib/utils/hash"
import type { SentenceRow } from "~/lib/text/halo"
import {
  BOUNDARY_WINDOW_CHARS,
  LOOSE_BOUNDARY_MASK,
  STRICT_BOUNDARY_MASK,
  UNIT_CEILING_CHARS,
  UNIT_FLOOR_CHARS,
  UNIT_TARGET_CHARS,
} from "./constants"

export interface Unit {
  firstSentence: number
  lastSentence: number
  charStart: number
  charEnd: number
  hash: string
}

export type BoundaryTest = (prose: string, gap: number) => boolean

// fnvHash returns 64 bits as hex, and a mask is only ever a handful of them, so the low
// four digits are read as a number rather than the whole string.
const LOW_BITS = 4

const lowBitsOf = (hash: string): number => parseInt(hash.slice(-LOW_BITS), 16)

export const boundaryTestForMask =
  (mask: number, window: number = BOUNDARY_WINDOW_CHARS): BoundaryTest =>
  (prose, gap) =>
    (lowBitsOf(fnvHash(prose.slice(Math.max(0, gap - window), gap))) & mask) === 0

// The knobs travel together because a gap's verdict needs all of them, and setting one
// without the others is how a caller ends up measuring a rule nobody runs.
export interface CutRule {
  strict: BoundaryTest
  loose: BoundaryTest
  target: number
  floor: number
  ceiling: number
}

export const DEFAULT_CUT_RULE: CutRule = {
  strict: boundaryTestForMask(STRICT_BOUNDARY_MASK),
  loose: boundaryTestForMask(LOOSE_BOUNDARY_MASK),
  target: UNIT_TARGET_CHARS,
  floor: UNIT_FLOOR_CHARS,
  ceiling: UNIT_CEILING_CHARS,
}

const toUnit = (
  prose: string,
  rows: readonly SentenceRow[],
  firstSentence: number,
  lastSentence: number
): Unit => {
  const charStart = rows[firstSentence].start
  const charEnd = rows[lastSentence].end
  return {
    firstSentence,
    lastSentence,
    charStart,
    charEnd,
    hash: fnvHash(prose.slice(charStart, charEnd)),
  }
}

// What the gap after a sentence does to the unit accumulating into it. The order is the
// contract: the ceiling outranks the floor, because reversing them leaves splitting a
// sentence as the only way to close a unit an oversized sentence follows. "floor" answers
// before the content test is asked, which is why a suppressed gap has to ask separately.
export type GapVerdict = "ceiling" | "floor" | "content test" | "open"

export const verdictAt = (
  prose: string,
  rows: readonly SentenceRow[],
  firstSentence: number,
  index: number,
  rule: CutRule = DEFAULT_CUT_RULE
): GapVerdict => {
  const start = rows[firstSentence].start
  const accumulated = rows[index].end - start
  if (rows[index + 1].end - start > rule.ceiling) return "ceiling"
  if (accumulated < rule.floor) return "floor"
  const isBoundary = accumulated < rule.target ? rule.strict : rule.loose
  return isBoundary(prose, rows[index].end) ? "content test" : "open"
}

const closesHere = (
  prose: string,
  rows: readonly SentenceRow[],
  firstSentence: number,
  index: number,
  rule: CutRule
): boolean => {
  const verdict = verdictAt(prose, rows, firstSentence, index, rule)
  return verdict === "ceiling" || verdict === "content test"
}

// The last sentence always closes a unit, so a document ending in a short one leaves a
// stub the floor never got to judge — a whole embedding request and a whole find call for
// a line of text. Tacking it onto the unit before cannot move a boundary above it, because
// it only ever touches the end.
const withTailMerged = (
  prose: string,
  rows: readonly SentenceRow[],
  units: Unit[],
  rule: CutRule
): Unit[] => {
  if (units.length < 2) return units

  const last = units[units.length - 1]
  const previous = units[units.length - 2]
  if (last.charEnd - last.charStart >= rule.floor) return units
  if (last.charEnd - previous.charStart > rule.ceiling) return units

  return [...units.slice(0, -2), toUnit(prose, rows, previous.firstSentence, last.lastSentence)]
}

export const cutUnits = (
  prose: string,
  rows: readonly SentenceRow[],
  rule: CutRule = DEFAULT_CUT_RULE
): Unit[] => {
  const units: Unit[] = []
  let firstSentence = 0

  for (let index = 0; index < rows.length; index++) {
    const isLast = index === rows.length - 1
    if (!isLast && !closesHere(prose, rows, firstSentence, index, rule)) continue
    units.push(toUnit(prose, rows, firstSentence, index))
    firstSentence = index + 1
  }

  return withTailMerged(prose, rows, units, rule)
}
