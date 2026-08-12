import { describe, it, expect } from "vitest"
import type { FindInput } from "./types"
import type { FindResult } from "./schema"
import { gateResults } from "./hits"

const UNIT_SENTENCES = [
  "Rutte opened the meeting at nine.",
  "The room went quiet.",
  "Kaag answered him directly.",
  "Nobody else spoke for a while.",
]

const findInput = (over: Partial<FindInput> = {}): FindInput => ({
  kind: "speaker",
  rules: "A speaker is the person whose words a passage carries.",
  knownValues: ["rutte"],
  valueType: "string",
  firstSentence: 10,
  sentences: UNIT_SENTENCES,
  ...over,
})

const result = (over: Partial<FindResult> = {}): FindResult => ({
  quote: "Rutte opened the meeting",
  sentence: 11,
  value: "Rutte",
  ...over,
})

describe("the ref gate", () => {
  const cases: { name: string; sentence: number }[] = [
    { name: "below the unit's first sentence", sentence: 10 },
    { name: "far below the unit", sentence: 1 },
    { name: "above the unit's last sentence", sentence: 15 },
  ]

  it.each(cases)("drops a result naming a sentence $name", ({ sentence }) => {
    const survivor = result({ quote: "Kaag answered him", sentence: 13, value: "Kaag" })
    const outcome = gateResults(findInput(), [result({ sentence }), survivor])

    expect(outcome.hits).toHaveLength(1)
    expect(outcome.hits[0].value).toBe("kaag")
    expect(outcome.dropped).toBe(1)
  })

  it("keeps a result naming the unit's first sentence", () => {
    const outcome = gateResults(findInput(), [result({ sentence: 11 })])
    expect(outcome.hits[0].hitSentence).toBe(10)
    expect(outcome.dropped).toBe(0)
  })

  it("keeps a result naming the unit's last sentence", () => {
    const outcome = gateResults(findInput(), [
      result({ quote: "Nobody else spoke", sentence: 14, value: "Kaag" }),
    ])
    expect(outcome.hits[0].hitSentence).toBe(13)
  })
})

describe("the model numbering boundary in find", () => {
  it("turns sentence 1 of a unit starting at the document's first sentence into hitSentence 0", () => {
    const outcome = gateResults(findInput({ firstSentence: 0 }), [result({ sentence: 1 })])
    expect(outcome.hits[0].hitSentence).toBe(0)
  })
})

describe("the quote gate", () => {
  it("retargets a hit to the sentence where the quote actually occurs", () => {
    const outcome = gateResults(findInput(), [
      result({ quote: "Kaag answered him directly", sentence: 11, value: "Kaag" }),
    ])

    expect(outcome.hits).toHaveLength(1)
    expect(outcome.hits[0].hitSentence).toBe(12)
  })

  it("locates a quote differing only in case, punctuation and diacritics", () => {
    const outcome = gateResults(findInput(), [result({ quote: "rutte, opened the meeting!" })])
    expect(outcome.hits[0].hitSentence).toBe(10)
  })

  it("drops a hit whose quote occurs nowhere in the unit", () => {
    const outcome = gateResults(findInput(), [result({ quote: "Timmermans left the room" })])
    expect(outcome.hits).toEqual([])
    expect(outcome.dropped).toBe(1)
  })

  it("drops a ten-token quote sharing nine tokens in order with the sentence it names", () => {
    const sentences = ["alpha bravo charlie delta echo foxtrot golf hotel india kilo."]
    const outcome = gateResults(findInput({ firstSentence: 0, sentences }), [
      result({
        quote: "alpha bravo charlie delta echo foxtrot golf hotel india juliet",
        sentence: 1,
      }),
    ])

    expect(outcome.hits).toEqual([])
    expect(outcome.dropped).toBe(1)
  })
})

describe("string value gating", () => {
  const cases: { name: string; value: string; expected: string | null }[] = [
    {
      name: "a known value in another case with trailing space",
      value: "Rutte ",
      expected: "rutte",
    },
    {
      name: "a long form of a known value",
      value: "President Rutte ",
      expected: "president rutte",
    },
    { name: "a value absent from the list", value: "Kaag", expected: "kaag" },
    { name: "a value that normalizes to nothing", value: "  ", expected: null },
  ]

  it.each(cases)("resolves $name", ({ value, expected }) => {
    const outcome = gateResults(findInput(), [result({ value })])
    expect(outcome.hits[0]?.value ?? null).toBe(expected)
  })

  it("reuses the known value rather than creating a second one", () => {
    const input = findInput()
    const outcome = gateResults(input, [result({ value: "Rutte " })])
    expect(input.knownValues).toContain(outcome.hits[0].value)
  })

  it("accepts a value the known list does not hold", () => {
    const input = findInput()
    const outcome = gateResults(input, [
      result({ quote: "Kaag answered him", sentence: 13, value: "Kaag" }),
    ])
    expect(input.knownValues).not.toContain(outcome.hits[0].value)
  })
})

describe("datetime value gating", () => {
  const dateInput = findInput({ kind: "date", valueType: "datetime", knownValues: [] })

  it("drops a hit whose value does not parse to an instant", () => {
    const outcome = gateResults(dateInput, [result({ value: "some time last spring" })])
    expect(outcome.hits).toEqual([])
    expect(outcome.dropped).toBe(1)
  })

  it("keeps a hit whose value resolves to start of day in UTC", () => {
    const outcome = gateResults(dateInput, [result({ value: "2024-03-05" })])
    expect(outcome.hits[0].value).toBe("2024-03-05T00:00:00.000Z")
  })
})

describe("dedup within one response", () => {
  it("collapses two results naming the same sentence and value to one hit", () => {
    const outcome = gateResults(findInput(), [
      result({ quote: "Rutte opened the meeting" }),
      result({ quote: "at nine", value: "rutte" }),
    ])

    expect(outcome.hits).toHaveLength(1)
    expect(outcome.hits[0]).toMatchObject({
      hitSentence: 10,
      value: "rutte",
      quote: "Rutte opened the meeting",
    })
  })

  it("keeps two results of the same value in different sentences", () => {
    const outcome = gateResults(findInput(), [
      result({ quote: "Rutte opened the meeting", sentence: 11 }),
      result({ quote: "Nobody else spoke", sentence: 14 }),
    ])
    expect(outcome.hits.map((h) => h.hitSentence)).toEqual([10, 13])
  })

  it("keeps two results of different values in one sentence", () => {
    const outcome = gateResults(findInput(), [
      result({ quote: "Kaag answered", sentence: 13, value: "Kaag" }),
      result({ quote: "answered him directly", sentence: 13, value: "Rutte" }),
    ])
    expect(outcome.hits.map((h) => h.value)).toEqual(["kaag", "rutte"])
  })
})

describe("the hit shape", () => {
  it("stamps every hit with the kind the call was made for", () => {
    const outcome = gateResults(findInput({ kind: "date" }), [result()])
    expect(outcome.hits[0].kind).toBe("date")
  })
})
