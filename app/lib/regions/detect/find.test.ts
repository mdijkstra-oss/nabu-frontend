import { describe, it, expect } from "vitest"
import type { KindDescriptor } from "~/lib/regions/kinds/registry"
import type { FindJob, FindWork, Hit } from "./types"
import type { ParseCall } from "./seam"
import { FIND_ENDPOINT, FIND_MAX_ITEMS, runFind } from "./find"
import {
  answering,
  answeringEach,
  answeringWhenReleased,
  failing,
  hasBreakpoint,
  textOf,
  throwing,
} from "./parse-call.fixture"

const person: KindDescriptor = {
  id: "person",
  rules: "A person is the person whose words a passage carries.",
  icon: "user",
  color: "indigo",
  valueType: "string",
}

const date: KindDescriptor = { ...person, id: "date", color: "amber", valueType: "datetime" }

const unitAt = (firstSentence: number, sentences: string[], file = "a.md"): FindWork => ({
  file,
  unit: {
    firstSentence,
    lastSentence: firstSentence + sentences.length - 1,
    charStart: 0,
    charEnd: 0,
    hash: `${file}#${firstSentence}`,
  },
  sentences,
})

interface RecordedJob {
  job: FindJob
  answered: { work: FindWork; hits: Hit[] }[]
  abandoned: FindWork[]
  knownValues: Set<string>
}

const jobFor = (kind: KindDescriptor, known: string[] = []): RecordedJob => {
  const knownValues = new Set(known)
  const answered: { work: FindWork; hits: Hit[] }[] = []
  const abandoned: FindWork[] = []
  return {
    job: {
      kind,
      knownValues,
      onAnswered: (work, hits) => answered.push({ work, hits }),
      onAbandoned: (work) => abandoned.push(work),
    },
    answered,
    abandoned,
    knownValues,
  }
}

const acknowledgedEmpty = (ids: number[]) =>
  ids.map((entry) => ({ entry, occurrences: [] as never[] }))

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe("the find payload", () => {
  const items = [
    unitAt(12, ["Rutte opened the meeting.", "The room went quiet."], "a.md"),
    unitAt(0, ["Kaag answered him directly."], "b.md"),
  ]

  it("packs units from two documents into one call of numbered entries", async () => {
    const { parse, calls } = answering({ results: acknowledgedEmpty([1, 2]) })
    await runFind(items, jobFor(person, ["rutte"]).job, parse)

    expect(calls).toHaveLength(1)
    expect(calls[0].endpoint).toBe(FIND_ENDPOINT)
    expect(calls[0].messages.map((m) => m.role)).toEqual([
      "system",
      "system",
      "system",
      "system",
      "user",
    ])

    const text = calls[0].messages.map(textOf)
    expect(text[0]).toBe(person.rules)
    expect(text[1]).toContain("rutte")
    expect(text[2]).toContain('<entry id="1" file="a.md">')
    expect(text[2]).toContain("[1.1] Rutte opened the meeting.")
    expect(text[2]).toContain("[1.2] The room went quiet.")
    expect(text[3]).toContain('<entry id="2" file="b.md">')
    expect(text[3]).toContain("[2.1] Kaag answered him directly.")
    expect(text[4]).toMatch(/every entry/i)
  })

  it("puts the prompt cache breakpoint on the rules message and nowhere else", async () => {
    const { parse, calls } = answering({ results: acknowledgedEmpty([1, 2]) })
    await runFind(items, jobFor(person, ["rutte"]).job, parse)

    expect(calls[0].messages.map(hasBreakpoint)).toEqual([true, false, false, false, false])
  })

  it("sorts the known-value list so the rendered preamble does not shift", async () => {
    const { parse, calls } = answering({ results: acknowledgedEmpty([1, 2]) })
    await runFind(items, jobFor(person, ["timmermans", "kaag", "rutte"]).job, parse)

    const listed = textOf(calls[0].messages[1])
    expect(listed.indexOf("kaag")).toBeLessThan(listed.indexOf("rutte"))
    expect(listed.indexOf("rutte")).toBeLessThan(listed.indexOf("timmermans"))
  })

  it("tells a vocabulary kind with no known values to infer from the text alone", async () => {
    const { parse, calls } = answering({ results: acknowledgedEmpty([1, 2]) })
    await runFind(items, jobFor(person).job, parse)

    expect(textOf(calls[0].messages[1])).toMatch(/infer/i)
  })

  it("sends no known-values message for a self-contained kind", async () => {
    const { parse, calls } = answering({ results: acknowledgedEmpty([1, 2]) })
    await runFind(items, jobFor(date).job, parse)

    expect(calls[0].messages.map((m) => m.role)).toEqual(["system", "system", "system", "user"])
    expect(textOf(calls[0].messages[1])).toContain('<entry id="1"')
  })
})

describe("routing occurrences back", () => {
  it("lands each occurrence in its own entry's document, offset by that unit", async () => {
    const items = [
      unitAt(12, ["Rutte opened the meeting.", "The room went quiet."], "a.md"),
      unitAt(0, ["Kaag answered him directly."], "b.md"),
    ]
    const { parse } = answering({
      results: [
        { entry: 1, occurrences: [{ quote: "Rutte opened", ref: "1.1", value: "Rutte" }] },
        { entry: 2, occurrences: [{ quote: "Kaag answered", ref: "2.1", value: "Kaag" }] },
      ],
    })
    const { job, answered } = jobFor(person)
    await runFind(items, job, parse)

    expect(answered).toHaveLength(2)
    const byFile = new Map(answered.map(({ work, hits }) => [work.file, hits]))
    expect(byFile.get("a.md")).toEqual([
      { kind: "person", quote: "Rutte opened", hitSentence: 12, value: "rutte" },
    ])
    expect(byFile.get("b.md")).toEqual([
      { kind: "person", quote: "Kaag answered", hitSentence: 0, value: "kaag" },
    ])
  })

  it("drops an occurrence whose ref runs past its entry and keeps the acknowledgment", async () => {
    const items = [unitAt(4, ["Rutte opened the meeting.", "The room went quiet."])]
    const { parse } = answering({
      results: [{ entry: 1, occurrences: [{ quote: "Rutte opened", ref: "1.9", value: "Rutte" }] }],
    })
    const { job, answered, abandoned } = jobFor(person)
    const result = await runFind(items, job, parse)

    expect(answered).toEqual([{ work: items[0], hits: [] }])
    expect(abandoned).toEqual([])
    expect(result.unrecorded).toEqual([])
  })

  it("drops an occurrence whose ref reaches into an entry the answer left silent", async () => {
    const items = [
      unitAt(0, ["Rutte opened the meeting."], "a.md"),
      unitAt(9, ["Kaag answered him directly."], "b.md"),
    ]
    const raws = [
      {
        results: [
          { entry: 1, occurrences: [{ quote: "Kaag answered", ref: "2.1", value: "Kaag" }] },
        ],
      },
      { results: [] },
      { results: [] },
    ]
    const { parse } = answeringEach(raws)
    const { job, answered, abandoned } = jobFor(person)
    await runFind(items, job, parse)

    expect(answered.map(({ work, hits }) => [work.file, hits])).toEqual([["a.md", []]])
    expect(abandoned).toEqual([items[1]])
  })

  it("ignores an entry id in the answer that names no entry in the call", async () => {
    const items = [unitAt(0, ["Rutte opened the meeting."])]
    const { parse } = answering({
      results: [
        { entry: 7, occurrences: [{ quote: "Rutte opened", ref: "7.1", value: "Rutte" }] },
        { entry: 1, occurrences: [] },
      ],
    })
    const { job, answered } = jobFor(person)
    await runFind(items, job, parse)

    expect(answered).toEqual([{ work: items[0], hits: [] }])
  })

  it("collapses duplicate occurrences of one entry across answer rows", async () => {
    const items = [unitAt(0, ["Rutte opened the meeting at nine."])]
    const { parse } = answering({
      results: [
        { entry: 1, occurrences: [{ quote: "Rutte opened", ref: "1.1", value: "Rutte" }] },
        { entry: 1, occurrences: [{ quote: "at nine", ref: "1.1", value: "rutte" }] },
      ],
    })
    const { job, answered } = jobFor(person)
    await runFind(items, job, parse)

    expect(answered).toHaveLength(1)
    expect(answered[0].hits).toHaveLength(1)
  })
})

describe("acknowledgment and rounds", () => {
  const units = (count: number, file = "a.md"): FindWork[] =>
    Array.from({ length: count }, (_, i) => unitAt(i, [`Filler sentence ${i}.`], file))

  it("scans acknowledged entries, empty or not, and abandons a persistently silent one", async () => {
    const items = units(5)
    const { parse, calls } = answeringEach([
      {
        results: [
          { entry: 1, occurrences: [{ quote: "Filler sentence 0", ref: "1.1", value: "Rutte" }] },
          ...acknowledgedEmpty([2, 3, 4]),
        ],
      },
      { results: [] },
      { results: [] },
    ])
    const { job, answered, abandoned } = jobFor(person)
    const result = await runFind(items, job, parse)

    expect(answered.map(({ work }) => work)).toEqual(items.slice(0, 4))
    expect(answered[0].hits).toHaveLength(1)
    expect(answered.slice(1).every(({ hits }) => hits.length === 0)).toBe(true)
    expect(abandoned).toEqual([items[4]])
    expect(result.unrecorded).toEqual([])

    expect(calls).toHaveLength(3)
    const retriedPayload = calls[1].messages.map(textOf).join("\n")
    expect(retriedPayload).toContain("Filler sentence 4.")
    expect(retriedPayload).not.toContain("Filler sentence 3.")
  })

  const failures: { name: string; parse: ParseCall }[] = [
    { name: "a response that is not JSON at all", parse: failing("LLM returned invalid JSON") },
    {
      name: "a response that is JSON of the wrong shape",
      parse: failing("Schema validation failed"),
    },
    { name: "a transport failure", parse: throwing("LLM request failed: 502") },
  ]

  it.each(failures)(
    "records none of ten units when their one call fails with $name",
    async ({ parse }) => {
      const items = units(10)
      const { job, answered, abandoned } = jobFor(person)
      const result = await runFind(items, job, parse)

      expect(answered).toEqual([])
      expect(abandoned).toEqual([])
      expect(result.unrecorded).toEqual(items)
    }
  )

  it("classifies a datetime answer failing the ISO shape as unanswered", async () => {
    const items = units(1)
    const { parse } = answering({
      results: [
        {
          entry: 1,
          occurrences: [{ quote: "Filler sentence 0", ref: "1.1", value: "last spring" }],
        },
      ],
    })
    const { job, answered } = jobFor(date)
    const result = await runFind(items, job, parse)

    expect(answered).toEqual([])
    expect(result.unrecorded).toEqual(items)
  })

  it("repacks entries a failed call left pending with whatever else is pending", async () => {
    const items = units(FIND_MAX_ITEMS + 1)
    const { parse, calls } = answeringEach([
      "unparseable",
      { results: acknowledgedEmpty([1]) },
      { results: acknowledgedEmpty(items.slice(0, FIND_MAX_ITEMS).map((_, i) => i + 1)) },
    ])
    const { job, answered } = jobFor(person)
    const result = await runFind(items, job, parse)

    expect(calls).toHaveLength(3)
    expect(answered).toHaveLength(items.length)
    expect(result.unrecorded).toEqual([])
  })
})

describe("the person vocabulary", () => {
  it("renders the value found by one call into the next call's preamble", async () => {
    const count = FIND_MAX_ITEMS + 1
    const items = Array.from({ length: count }, (_, i) =>
      unitAt(i, [i === 0 ? "Kaag answered him directly." : `Filler sentence ${i}.`])
    )
    const { parse, calls } = answeringEach([
      {
        results: [
          { entry: 1, occurrences: [{ quote: "Kaag", ref: "1.1", value: "Kaag" }] },
          ...acknowledgedEmpty(Array.from({ length: FIND_MAX_ITEMS - 1 }, (_, i) => i + 2)),
        ],
      },
      { results: acknowledgedEmpty([1]) },
    ])
    const { job, knownValues } = jobFor(person)
    await runFind(items, job, parse)

    expect(calls).toHaveLength(2)
    expect(textOf(calls[0].messages[1])).toMatch(/infer/i)
    expect(textOf(calls[1].messages[1])).toContain("kaag")
    expect(knownValues.has("kaag")).toBe(true)
  })

  it("dispatches person calls one at a time", async () => {
    const items = Array.from({ length: FIND_MAX_ITEMS + 1 }, (_, i) =>
      unitAt(i, [`Filler sentence ${i}.`])
    )
    const { parse, calls, held } = answeringWhenReleased()
    const run = runFind(items, jobFor(person).job, parse)

    await flushMicrotasks()
    expect(calls).toHaveLength(1)

    held[0].release({
      results: acknowledgedEmpty(Array.from({ length: FIND_MAX_ITEMS }, (_, i) => i + 1)),
    })
    await flushMicrotasks()
    expect(calls).toHaveLength(2)

    held[1].release({ results: acknowledgedEmpty([1]) })
    await run
  })

  it("dispatches a self-contained kind's calls concurrently", async () => {
    const items = Array.from({ length: FIND_MAX_ITEMS + 1 }, (_, i) =>
      unitAt(i, [`Filler sentence ${i}.`])
    )
    const { parse, calls, held } = answeringWhenReleased()
    const run = runFind(items, jobFor(date).job, parse)

    await flushMicrotasks()
    expect(calls).toHaveLength(2)

    held[0].release({
      results: acknowledgedEmpty(Array.from({ length: FIND_MAX_ITEMS }, (_, i) => i + 1)),
    })
    held[1].release({ results: acknowledgedEmpty([1]) })
    await run
  })
})
