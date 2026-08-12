import { describe, it, expect } from "vitest"
import type { FindWork } from "./types"
import { gateOccurrences, type OccurrenceCandidate } from "./hits"

const UNIT_SENTENCES = [
  "Rutte opened the meeting at nine.",
  "The room went quiet.",
  "Kaag answered him directly.",
  "Nobody else spoke for a while.",
]

const workAt = (firstSentence: number, sentences: string[] = UNIT_SENTENCES): FindWork => ({
  file: "talk.md",
  unit: {
    firstSentence,
    lastSentence: firstSentence + sentences.length - 1,
    charStart: 0,
    charEnd: 0,
    hash: "irrelevant",
  },
  sentences,
})

const work = workAt(10)

const candidate = (over: Partial<OccurrenceCandidate> = {}): OccurrenceCandidate => ({
  quote: "Rutte opened the meeting",
  sentenceIndex: 0,
  value: "Rutte",
  ...over,
})

const gate = (target: FindWork, occurrences: OccurrenceCandidate[]) =>
  gateOccurrences("speaker", "string", target, occurrences)

describe("the numbering map-back", () => {
  const cases: { name: string; firstSentence: number; sentenceIndex: number; expected: number }[] =
    [
      {
        name: "a unit starting at the document's first sentence",
        firstSentence: 0,
        sentenceIndex: 0,
        expected: 0,
      },
      { name: "a unit deep in the document", firstSentence: 10, sentenceIndex: 0, expected: 10 },
      {
        name: "a later sentence of a deep unit",
        firstSentence: 10,
        sentenceIndex: 3,
        expected: 13,
      },
    ]

  it.each(cases)("offsets $name by its unit's first sentence", (row) => {
    const quote = UNIT_SENTENCES[row.sentenceIndex].slice(0, 12)
    const hits = gate(workAt(row.firstSentence), [
      candidate({ quote, sentenceIndex: row.sentenceIndex, value: "Kaag" }),
    ])
    expect(hits[0].hitSentence).toBe(row.expected)
  })
})

describe("the quote gate", () => {
  it("retargets a hit to the sentence of the entry where the quote actually occurs", () => {
    const hits = gate(work, [
      candidate({ quote: "Kaag answered him directly", sentenceIndex: 0, value: "Kaag" }),
    ])

    expect(hits).toHaveLength(1)
    expect(hits[0].hitSentence).toBe(12)
  })

  it("locates a quote differing only in case, punctuation and diacritics", () => {
    const hits = gate(work, [candidate({ quote: "rutte, opened the meeting!" })])
    expect(hits[0].hitSentence).toBe(10)
  })

  it("drops a hit whose quote occurs nowhere in the entry", () => {
    expect(gate(work, [candidate({ quote: "Timmermans left the room" })])).toEqual([])
  })

  it("drops a ten-token quote sharing nine tokens in order with the sentence it names", () => {
    const sentences = ["alpha bravo charlie delta echo foxtrot golf hotel india kilo."]
    const hits = gate(workAt(0, sentences), [
      candidate({
        quote: "alpha bravo charlie delta echo foxtrot golf hotel india juliet",
        sentenceIndex: 0,
      }),
    ])

    expect(hits).toEqual([])
  })
})

describe("the quote gate against markdown", () => {
  const MARKED_UP = [
    "[the report](https://ex.com/a) is good.",
    "**Rutte** opened the meeting.",
    "- Kaag replied at **length** to the point.",
    "The `total.count` value was wrong.",
  ]

  const markedUpWork = workAt(0, MARKED_UP)

  const cases: {
    name: string
    quote: string
    sentenceIndex: number
    hitSentence: number
    stored: string
  }[] = [
    {
      name: "a quote spanning a link",
      quote: "the report is good",
      sentenceIndex: 0,
      hitSentence: 0,
      stored: "the report](https://ex.com/a) is good.",
    },
    {
      name: "a quote inside a bold run",
      quote: "Rutte",
      sentenceIndex: 1,
      hitSentence: 1,
      stored: "Rutte",
    },
    {
      name: "a quote spanning a bullet marker and a bold run",
      quote: "Kaag replied at length",
      sentenceIndex: 2,
      hitSentence: 2,
      stored: "Kaag replied at **length",
    },
    {
      name: "a quote spanning a code span",
      quote: "The total.count value",
      sentenceIndex: 3,
      hitSentence: 3,
      stored: "The `total.count` value",
    },
    {
      name: "a quote naming one sentence and reading as another's bold run",
      quote: "Rutte opened",
      sentenceIndex: 0,
      hitSentence: 1,
      stored: "Rutte** opened",
    },
  ]

  it.each(cases)("accepts $name and stores the characters it covered", (row) => {
    const hits = gate(markedUpWork, [
      candidate({ quote: row.quote, sentenceIndex: row.sentenceIndex }),
    ])

    expect(hits).toHaveLength(1)
    expect(hits[0].hitSentence).toBe(row.hitSentence)
    expect(hits[0].quote).toBe(row.stored)
    expect(MARKED_UP[hits[0].hitSentence]).toContain(hits[0].quote)
  })

  it("drops a quote no sentence of the marked-up entry holds and stores nothing", () => {
    expect(gate(markedUpWork, [candidate({ quote: "Timmermans left the room" })])).toEqual([])
  })
})

describe("string value gating", () => {
  const cases: { name: string; value: string; expected: string | null }[] = [
    {
      name: "a value in another case with trailing space",
      value: "Rutte ",
      expected: "rutte",
    },
    {
      name: "a long form of a value",
      value: "President Rutte ",
      expected: "president rutte",
    },
    { name: "a plain value", value: "Kaag", expected: "kaag" },
    { name: "a value that normalizes to nothing", value: "  ", expected: null },
  ]

  it.each(cases)("resolves $name", ({ value, expected }) => {
    const hits = gate(work, [candidate({ value })])
    expect(hits[0]?.value ?? null).toBe(expected)
  })
})

describe("datetime value gating", () => {
  const gateDate = (occurrences: OccurrenceCandidate[]) =>
    gateOccurrences("date", "datetime", work, occurrences)

  it("drops a hit whose value does not parse to an instant", () => {
    expect(gateDate([candidate({ value: "some time last spring" })])).toEqual([])
  })

  it("keeps a hit whose value resolves to start of day in UTC", () => {
    const hits = gateDate([candidate({ value: "2024-03-05" })])
    expect(hits[0].value).toBe("2024-03-05T00:00:00.000Z")
  })
})

describe("dedup within one entry", () => {
  it("collapses two occurrences naming the same sentence and value to one hit", () => {
    const hits = gate(work, [
      candidate({ quote: "Rutte opened the meeting" }),
      candidate({ quote: "at nine", value: "rutte" }),
    ])

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      hitSentence: 10,
      value: "rutte",
      quote: "Rutte opened the meeting",
    })
  })

  it("keeps two occurrences of the same value in different sentences", () => {
    const hits = gate(work, [
      candidate({ quote: "Rutte opened the meeting", sentenceIndex: 0 }),
      candidate({ quote: "Nobody else spoke", sentenceIndex: 3 }),
    ])
    expect(hits.map((h) => h.hitSentence)).toEqual([10, 13])
  })

  it("keeps two occurrences of different values in one sentence", () => {
    const hits = gate(work, [
      candidate({ quote: "Kaag answered", sentenceIndex: 2, value: "Kaag" }),
      candidate({ quote: "answered him directly", sentenceIndex: 2, value: "Rutte" }),
    ])
    expect(hits.map((h) => h.value)).toEqual(["kaag", "rutte"])
  })
})

describe("the hit shape", () => {
  it("stamps every hit with the kind the call was made for", () => {
    const hits = gateOccurrences("date", "string", work, [candidate()])
    expect(hits[0].kind).toBe("date")
  })
})
