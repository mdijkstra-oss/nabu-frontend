import { describe, it, expect } from "vitest"
import { fnvHash } from "~/lib/utils/hash"
import { indexProseSentences, type SentenceRow } from "~/lib/text/halo"
import {
  documentOfSentences,
  fixtureDocument,
  ruleWith,
  sentenceOfLength,
  type Document,
} from "./test-documents"
import { BOUNDARY_MASK, UNIT_CEILING_CHARS, UNIT_FLOOR_CHARS } from "./constants"
import { boundaryTestForMask, cutUnits, type BoundaryTest, type Unit } from "./units"

const MULTI_UNIT_FIXTURES = [
  "links-and-code.md",
  "long-sentence-prose.md",
  "tables-and-lists.md",
  "transcript-short-turns.md",
]

const documentOf = (prose: string): Document => ({ prose, rows: indexProseSentences(prose) })

const documentOfLengths = (lengths: readonly number[]): Document =>
  documentOfSentences(lengths.map((length, index) => sentenceOfLength(index, length)))

const cut = (document: Document, isBoundary?: BoundaryTest): Unit[] =>
  cutUnits(document.prose, document.rows, isBoundary && ruleWith(isBoundary))

const hashesOf = (units: readonly Unit[]): string[] => units.map((unit) => unit.hash)

const sizeOf = (unit: Unit): number => unit.charEnd - unit.charStart

const sharedSuffixLength = (before: readonly string[], after: readonly string[]): number => {
  let shared = 0
  while (
    shared < before.length &&
    shared < after.length &&
    before[before.length - 1 - shared] === after[after.length - 1 - shared]
  )
    shared++
  return shared
}

const isClosedByCeiling = (rows: readonly SentenceRow[], unit: Unit): boolean => {
  const next = rows[unit.lastSentence + 1]
  return next !== undefined && next.end - unit.charStart > UNIT_CEILING_CHARS
}

const expectCoversEverySentenceOnce = (
  rows: readonly SentenceRow[],
  units: readonly Unit[]
): void => {
  expect(units.map((unit) => unit.firstSentence)).toEqual(
    units.map((_, index) => (index === 0 ? 0 : units[index - 1].lastSentence + 1))
  )
  for (const unit of units) {
    expect(unit.lastSentence).toBeGreaterThanOrEqual(unit.firstSentence)
    expect(unit.charStart).toBe(rows[unit.firstSentence].start)
    expect(unit.charEnd).toBe(rows[unit.lastSentence].end)
  }
  expect(units.at(-1)?.lastSentence ?? -1).toBe(rows.length - 1)
}

const expectSizesWithinBounds = (rows: readonly SentenceRow[], units: readonly Unit[]): void => {
  units.forEach((unit, index) => {
    if (sizeOf(unit) > UNIT_CEILING_CHARS) expect(unit.firstSentence).toBe(unit.lastSentence)
    if (sizeOf(unit) < UNIT_FLOOR_CHARS)
      expect(index === units.length - 1 || isClosedByCeiling(rows, unit)).toBe(true)
  })
}

const expectHashesRecomputeFromProse = (prose: string, units: readonly Unit[]): void => {
  for (const unit of units)
    expect(unit.hash).toBe(fnvHash(prose.slice(unit.charStart, unit.charEnd)))
}

describe("cutUnits stability", () => {
  const MAX_UNITS_DESYNCED_BY_AN_INSERT = 2

  // A delete knocks the floor out of step, and how long it stays out of step depends on
  // how many gaps the floor is suppressing. Prose re-syncs after one unit. A document of
  // table rows and list items does not re-sync at all: its sentences average a fifteenth
  // of UNIT_FLOOR_CHARS, so the floor — not the content test — picks every boundary, and
  // one sentence fewer picks a different one every time.
  const UNITS_DESYNCED_BY_A_DELETE: Record<string, number | "never re-syncs"> = {
    "links-and-code.md": 1,
    "long-sentence-prose.md": 1,
    "tables-and-lists.md": "never re-syncs",
    "transcript-short-turns.md": 1,
  }

  const INSERTED = "Dit is een ingevoegde zin over hetzelfde onderwerp. "

  it.each(MULTI_UNIT_FIXTURES)(
    "leaves later unit hashes alone when a sentence is inserted into the first unit of %s",
    (name) => {
      const original = fixtureDocument(name)
      const units = cut(original)
      const insertAt = units[0].charStart
      const edited = documentOf(
        original.prose.slice(0, insertAt) + INSERTED + original.prose.slice(insertAt)
      )

      const before = hashesOf(units)
      const after = hashesOf(cut(edited))

      expect(before.length).toBeGreaterThan(MAX_UNITS_DESYNCED_BY_AN_INSERT)
      expect(sharedSuffixLength(before, after)).toBeGreaterThanOrEqual(
        before.length - MAX_UNITS_DESYNCED_BY_AN_INSERT
      )
    }
  )

  it.each(MULTI_UNIT_FIXTURES)(
    "re-syncs after a sentence is deleted from the middle of %s",
    (name) => {
      const original = fixtureDocument(name)
      const units = cut(original)
      const middle = units[Math.floor(units.length / 2)]
      const dropped = original.rows[middle.firstSentence]
      const edited = documentOf(
        original.prose.slice(0, dropped.start) + original.prose.slice(dropped.end)
      )

      const before = hashesOf(units)
      const editedUnits = cut(edited)

      const untouched = units.filter((unit) => unit.charEnd <= dropped.start)
      expect(untouched.length).toBeGreaterThan(0)
      untouched.forEach((unit, index) => {
        expect(editedUnits[index].hash).toBe(unit.hash)
        expect(editedUnits[index].charStart).toBe(unit.charStart)
      })

      const reSynced = sharedSuffixLength(before, hashesOf(editedUnits))
      const expected = UNITS_DESYNCED_BY_A_DELETE[name]
      if (expected === "never re-syncs") expect(reSynced).toBe(0)
      else expect(before.length - untouched.length - reSynced).toBe(expected)
    }
  )

  it("gives two documents that end in the same text a shared suffix of unit hashes", () => {
    const tail = fixtureDocument("links-and-code.md")
    const prefixSource = fixtureDocument("tables-and-lists.md")
    const withPrefix = (rowCount: number): Document => {
      const prefix = prefixSource.prose.slice(0, prefixSource.rows[rowCount].end)
      return documentOf(prefix + "\n\n" + tail.prose)
    }

    const shortPrefix = withPrefix(20)
    const longPrefix = withPrefix(60)
    const shared = sharedSuffixLength(hashesOf(cut(shortPrefix)), hashesOf(cut(longPrefix)))

    // Two different prefixes onto one tail: the tail's units re-sync all but the one the
    // join falls inside, whatever the prefix was.
    const unitsInTail = cut(tail).length
    expect(shared).toBeGreaterThanOrEqual(unitsInTail - 1)
  })

  it("does not cut after every occurrence of a sentence that repeats twenty times", () => {
    const REPEATED = "Ja."
    const turns = Array.from({ length: 20 }, (_, index) => [
      `De cijfers over week ${index} laten hetzelfde beeld zien als de weken daarvoor.`,
      `Wij kijken daarbij naar de sectoren waar de omzet in week ${index} het hardst terugliep.`,
      REPEATED,
    ])
    const document = documentOf(turns.flat().join(" "))
    const units = cut(document)

    const repeats = document.rows.filter((row) => row.text === REPEATED)
    const unitEnds = new Set(units.map((unit) => unit.charEnd))
    const cutAfterRepeat = repeats.filter((row) => unitEnds.has(row.end))

    expect(repeats.length).toBe(20)
    expect(units.length).toBeGreaterThan(1)
    expect(cutAfterRepeat.length).toBeLessThan(repeats.length)
    expectSizesWithinBounds(document.rows, units)
  })
})

describe("cutUnits shape", () => {
  const SHORT = Math.floor(UNIT_FLOOR_CHARS / 4)
  const LONG = UNIT_CEILING_CHARS + 1

  const documents: { name: string; document: Document }[] = [
    ...MULTI_UNIT_FIXTURES.map((name) => ({ name, document: fixtureDocument(name) })),
    { name: "mostly-code.md", document: fixtureDocument("mostly-code.md") },
    { name: "uniform short sentences", document: documentOfLengths(Array(120).fill(SHORT)) },
    {
      name: "sentences the size of the floor",
      document: documentOfLengths(Array(20).fill(UNIT_FLOOR_CHARS)),
    },
    {
      name: "a sentence longer than the ceiling among short ones",
      document: documentOfLengths([SHORT, SHORT, LONG, SHORT, SHORT, LONG]),
    },
    {
      name: "sentences that alone breach the ceiling",
      document: documentOfLengths([LONG, LONG, LONG]),
    },
  ]

  const boundaryTests = (rows: readonly SentenceRow[]): { name: string; test: BoundaryTest }[] => {
    const everyThirdGap = new Set(rows.filter((_, index) => index % 3 === 2).map((row) => row.end))
    return [
      { name: "the content test", test: boundaryTestForMask(BOUNDARY_MASK) },
      { name: "no gap passing", test: () => false },
      { name: "every gap passing", test: () => true },
      { name: "every third gap passing", test: (_prose, gap) => everyThirdGap.has(gap) },
    ]
  }

  const cases = documents.flatMap(({ name, document }) =>
    boundaryTests(document.rows).map((boundary) => ({
      name: `${name} with ${boundary.name}`,
      document,
      test: boundary.test,
    }))
  )

  it.each(cases)("covers every sentence exactly once: $name", ({ document, test }) => {
    expectCoversEverySentenceOnce(document.rows, cut(document, test))
  })

  it.each(cases)("respects the floor and the ceiling: $name", ({ document, test }) => {
    expectSizesWithinBounds(document.rows, cut(document, test))
  })

  it.each(cases)("hashes the prose its offsets name: $name", ({ document, test }) => {
    expectHashesRecomputeFromProse(document.prose, cut(document, test))
  })

  it("keeps a sentence longer than the ceiling whole", () => {
    const document = documentOfLengths([LONG])
    expect(cut(document)).toEqual([
      expect.objectContaining({ firstSentence: 0, lastSentence: 0, charEnd: LONG }),
    ])
  })

  it("closes a below-floor unit when the next sentence would breach the ceiling", () => {
    const document = documentOfLengths([SHORT, SHORT, LONG])
    const units = cut(document, () => false)

    expect(units.map((unit) => [unit.firstSentence, unit.lastSentence])).toEqual([
      [0, 1],
      [2, 2],
    ])
    expect(sizeOf(units[0])).toBeLessThan(UNIT_FLOOR_CHARS)
    expect(sizeOf(units[1])).toBeGreaterThan(UNIT_CEILING_CHARS)
  })

  const pairSummingTo = (total: number): number[] => [
    Math.floor((total - 1) / 2),
    total - 1 - Math.floor((total - 1) / 2),
  ]

  const edgeCases = [
    {
      name: "a pair landing exactly on the ceiling stays one unit",
      lengths: pairSummingTo(UNIT_CEILING_CHARS),
      test: () => false,
      expected: [[0, 1]],
    },
    {
      name: "a pair one character past the ceiling is cut apart",
      lengths: pairSummingTo(UNIT_CEILING_CHARS + 1),
      test: () => false,
      expected: [
        [0, 0],
        [1, 1],
      ],
    },
    {
      name: "a gap exactly on the floor may become a boundary",
      lengths: [UNIT_FLOOR_CHARS, UNIT_FLOOR_CHARS],
      test: () => true,
      expected: [
        [0, 0],
        [1, 1],
      ],
    },
    {
      name: "a gap one character short of the floor is suppressed",
      lengths: [UNIT_FLOOR_CHARS - 1, UNIT_FLOOR_CHARS],
      test: () => true,
      expected: [[0, 1]],
    },
  ]

  it.each(edgeCases)("$name", ({ lengths, test, expected }) => {
    const units = cut(documentOfLengths(lengths), test)
    expect(units.map((unit) => [unit.firstSentence, unit.lastSentence])).toEqual(expected)
  })

  it("makes one unit of a document shorter than the floor", () => {
    const document = documentOfLengths([SHORT, SHORT, SHORT])
    expect(cut(document, () => true).length).toBe(1)
  })

  it("produces no units for an empty sentence array", () => {
    expect(cutUnits("", [])).toEqual([])
    expect(cutUnits("Text nothing indexed.", [])).toEqual([])
  })
})

describe("boundaryTestForMask near the start of the document", () => {
  it("hashes what there is when the gap sits inside the first window", () => {
    const prose = "The quick brown fox jumps over the lazy dog. ".repeat(100)
    const gap = 6
    const expected = (parseInt(fnvHash(prose.slice(0, gap)).slice(-4), 16) & BOUNDARY_MASK) === 0

    expect(boundaryTestForMask(BOUNDARY_MASK)(prose, gap)).toBe(expected)
  })
})
