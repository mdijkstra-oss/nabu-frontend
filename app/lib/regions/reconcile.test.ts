import { describe, it, expect } from "vitest"
import { reconcileHits, reconcileMarks, hashSentenceRange, type StoredMark } from "./reconcile"
import type { Hit, ScanUnit } from "./detect/types"
import type { ScannedUnit } from "~/domain/data-blocks/regions/schema"

const toUnit = (firstSentence: number, sentences: string[]): ScanUnit => ({
  firstSentence,
  lastSentence: firstSentence + sentences.length - 1,
  charStart: 0,
  charEnd: 0,
  hash: hashSentenceRange(sentences, 0, sentences.length - 1),
})

const toEntry = (unit: ScanUnit): ScannedUnit => ({
  hash: unit.hash,
  firstSentence: unit.firstSentence,
})

const hit = (hitSentence: number, value = "rutte"): Hit => ({
  kind: "speaker",
  quote: "Rutte",
  hitSentence,
  value,
})

const A = ["Rutte opened.", "He continued."]
const B = ["Kaag replied.", "She paused."]
const C = ["Rutte closed.", "The room emptied."]

describe("reconcileHits", () => {
  const storedUnits = [toUnit(0, A), toUnit(2, B), toUnit(4, C)]
  const scanned = storedUnits.map(toEntry)

  const cases: {
    name: string
    scanned: ScannedUnit[]
    units: ScanUnit[]
    storedHits: Hit[]
    kept: Hit[]
    dropped: Hit[]
    unitsToFind: ScanUnit[]
    nextScanned: ScannedUnit[]
  }[] = [
    {
      name: "an unchanged document keeps every hit and finds nothing",
      scanned,
      units: storedUnits,
      storedHits: [hit(0), hit(2, "kaag"), hit(4)],
      kept: [hit(0), hit(2, "kaag"), hit(4)],
      dropped: [],
      unitsToFind: [],
      nextScanned: scanned,
    },
    {
      name: "a unit whose hash survives at a new index shifts its hits by the difference",
      scanned,
      units: [
        toUnit(0, ["A new opening.", "Another new one.", "And a third."]),
        toUnit(3, B),
        toUnit(5, C),
      ],
      storedHits: [hit(0), hit(3, "kaag"), hit(5)],
      kept: [hit(4, "kaag"), hit(6)],
      dropped: [hit(0)],
      unitsToFind: [toUnit(0, ["A new opening.", "Another new one.", "And a third."])],
      nextScanned: [
        { hash: scanned[1].hash, firstSentence: 3 },
        { hash: scanned[2].hash, firstSentence: 5 },
      ],
    },
    {
      name: "a unit whose text changed drops its hits and is re-found while its neighbours are kept",
      scanned,
      units: [
        storedUnits[0],
        toUnit(2, ["Kaag replied at length.", "She paused."]),
        storedUnits[2],
      ],
      storedHits: [hit(0), hit(2, "kaag"), hit(4)],
      kept: [hit(0), hit(4)],
      dropped: [hit(2, "kaag")],
      unitsToFind: [toUnit(2, ["Kaag replied at length.", "She paused."])],
      nextScanned: [scanned[0], scanned[2]],
    },
    {
      name: "a document with no scanned record finds every unit and keeps nothing",
      scanned: [],
      units: storedUnits,
      storedHits: [hit(0)],
      kept: [],
      dropped: [hit(0)],
      unitsToFind: storedUnits,
      nextScanned: [],
    },
    {
      name: "two units carrying the same hash each claim the one nearest their stored index",
      scanned: [
        { hash: toUnit(0, A).hash, firstSentence: 0 },
        { hash: toUnit(0, A).hash, firstSentence: 4 },
      ],
      units: [toUnit(0, A), toUnit(2, B), toUnit(4, A)],
      storedHits: [hit(0), hit(4)],
      kept: [hit(0), hit(4)],
      dropped: [],
      unitsToFind: [toUnit(2, B)],
      nextScanned: [
        { hash: toUnit(0, A).hash, firstSentence: 0 },
        { hash: toUnit(0, A).hash, firstSentence: 4 },
      ],
    },
  ]

  it.each(cases)("$name", ({ scanned: stored, units, storedHits, ...expected }) => {
    const result = reconcileHits(storedHits, stored, units)
    expect(result.kept).toEqual(expected.kept)
    expect(result.dropped).toEqual(expected.dropped)
    expect(result.unitsToFind).toEqual(expected.unitsToFind)
    expect(result.nextScanned).toEqual(expected.nextScanned)
  })
})

describe("reconcileMarks", () => {
  const document = [
    "Rutte opened the meeting.",
    "He set out the agenda.",
    "Kaag replied.",
    "She raised an objection.",
    "The room emptied.",
  ]

  const storedMark = (
    startSentence: number,
    endSentence: number,
    hitSentence: number,
    sentences: string[] = document
  ): StoredMark => ({
    kind: "speaker",
    quote: "Rutte",
    value: "rutte",
    hitSentence,
    startSentence,
    endSentence,
    rangeHash: hashSentenceRange(sentences, startSentence, endSentence),
  })

  const cases: {
    name: string
    stored: StoredMark[]
    sentences: string[]
    kept: StoredMark[]
    deleted: StoredMark[]
  }[] = [
    {
      name: "an unchanged document keeps every mark where it stood",
      stored: [storedMark(0, 1, 0), storedMark(2, 3, 2)],
      sentences: document,
      kept: [storedMark(0, 1, 0), storedMark(2, 3, 2)],
      deleted: [],
    },
    {
      name: "an insertion above shifts range and hit sentence alike",
      stored: [storedMark(0, 1, 0), storedMark(2, 3, 2)],
      sentences: ["A new first.", "A new second.", ...document],
      kept: [
        { ...storedMark(0, 1, 0), startSentence: 2, endSentence: 3, hitSentence: 2 },
        { ...storedMark(2, 3, 2), startSentence: 4, endSentence: 5, hitSentence: 4 },
      ],
      deleted: [],
    },
    {
      name: "a hit sentence outside its own range travels with the range",
      stored: [{ ...storedMark(0, 1, 2) }],
      sentences: ["A new first.", ...document],
      kept: [{ ...storedMark(0, 1, 2), startSentence: 1, endSentence: 2, hitSentence: 3 }],
      deleted: [],
    },
    {
      name: "a word changed inside a range deletes that mark and leaves its neighbours",
      stored: [storedMark(0, 1, 0), storedMark(2, 3, 2), storedMark(4, 4, 4)],
      sentences: [document[0], document[1], "Kaag replied sharply.", ...document.slice(3)],
      kept: [storedMark(0, 1, 0), storedMark(4, 4, 4)],
      deleted: [storedMark(2, 3, 2)],
    },
    {
      name: "a range that runs past the end of the document is deleted",
      stored: [storedMark(3, 4, 3)],
      sentences: document.slice(0, 3),
      kept: [],
      deleted: [storedMark(3, 4, 3)],
    },
  ]

  it.each(cases)("$name", ({ stored, sentences, kept, deleted }) => {
    const result = reconcileMarks(stored, sentences)
    expect(result.kept).toEqual(kept)
    expect(result.deleted).toEqual(deleted)
  })

  const repeated = Array.from({ length: 20 }, () => "Yeah.")

  it("relocates each mark of an ambiguous run to the candidate nearest its stored index", () => {
    const before = [...repeated, "The meeting closed."]
    const after = [...repeated, "The meeting closed at noon."]
    const stored = repeated.map((_, i) => storedMark(i, i, i, before))

    const result = reconcileMarks(stored, after)

    expect(result.deleted).toEqual([])
    expect(result.kept.map((m) => m.startSentence)).toEqual(repeated.map((_, i) => i))
  })

  it("resolves an exact tie to the earlier candidate on every run", () => {
    const sentences = ["Yeah.", "Distinct filler.", "Yeah."]
    const stored: StoredMark[] = [storedMark(1, 1, 1, ["x", "Yeah."])]

    for (let run = 0; run < 3; run++) {
      const result = reconcileMarks(stored, sentences)
      expect(result.kept.map((m) => m.startSentence)).toEqual([0])
    }
  })
})
