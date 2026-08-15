// Adversarial pins for regions.md's durability contract: an entry enters `scanned`
// only via explicit acknowledgment in an answered call, and untrusted answer content
// never widens what a call recorded. Each test cites the spec line it enforces.

import { describe, it, expect } from "vitest"
import type { KindDescriptor } from "~/lib/regions/kinds/registry"
import type { FindJob, FindWork, Hit, Mark, MarkJob, MarkWork, SentenceWindow } from "./types"
import { FIND_MAX_ITEMS, runFind } from "./find"
import { runMark } from "./mark"
import { answering, answeringEach, textOf } from "./parse-call.fixture"

const person: KindDescriptor = {
  id: "person",
  rules: "A person is the person whose words a passage carries.",
  icon: "user",
  color: "indigo",
  valueType: "string",
}

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

interface RecordedFindJob {
  job: FindJob
  answered: { work: FindWork; hits: Hit[] }[]
  abandoned: FindWork[]
  knownValues: Set<string>
}

const findJob = (known: string[] = []): RecordedFindJob => {
  const knownValues = new Set(known)
  const answered: { work: FindWork; hits: Hit[] }[] = []
  const abandoned: FindWork[] = []
  return {
    job: {
      kind: person,
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

describe("acknowledgment forgery", () => {
  // regions.md:13 — "a unit enters `scanned`" only when "the answer acknowledges every
  // entry"; regions.md:14 — "a stray ref never converts silence into an acknowledgment".
  const strayRows: { name: string; results: unknown[] }[] = [
    {
      name: "an answer acknowledging only an entry id not in the call",
      results: [{ entry: 99, occurrences: [] }],
    },
    {
      name: "a stray acknowledgment whose occurrence ref resolves into the real entry",
      results: [
        { entry: 99, occurrences: [{ quote: "Rutte opened", ref: "1.1", value: "Rutte" }] },
      ],
    },
  ]

  it.each(strayRows)("never answers the real entry for $name", async ({ results }) => {
    const items = [unitAt(0, ["Rutte opened the meeting."])]
    const { parse, calls } = answering({ results })
    const { job, answered, abandoned } = findJob()
    const result = await runFind(items, job, parse)

    expect(answered).toEqual([])
    expect(abandoned).toEqual([items[0]])
    expect(result.unrecorded).toEqual([])
    expect(calls).toHaveLength(3)
  })

  // calling.md outcomes table — a response failing the zod schema is unanswered: none
  // recorded, none counted toward a miss, all pending.
  const invalidIds: { name: string; entry: number }[] = [
    { name: "zero", entry: 0 },
    { name: "negative", entry: -3 },
  ]

  it.each(invalidIds)(
    "classifies a call acknowledging entry id $name as unanswered, not as a miss",
    async ({ entry }) => {
      const items = [unitAt(0, ["Rutte opened the meeting."])]
      const { parse, calls } = answering({ results: [{ entry, occurrences: [] }] })
      const { job, answered, abandoned } = findJob()
      const result = await runFind(items, job, parse)

      expect(answered).toEqual([])
      expect(abandoned).toEqual([])
      expect(result.unrecorded).toEqual(items)
      expect(calls).toHaveLength(1)
    }
  )
})

describe("cross-entry occurrences between acknowledged entries", () => {
  // regions.md:14 — "An occurrence's entry is the one its ref resolves into": the hit
  // lands in the ref's entry with that unit's offset, never the acknowledging row's.
  it("routes an occurrence into the acknowledged entry its ref names", async () => {
    const items = [
      unitAt(12, ["Rutte opened the meeting.", "The room went quiet."], "a.md"),
      unitAt(5, ["Kaag answered him directly."], "b.md"),
    ]
    const { parse } = answering({
      results: [
        { entry: 1, occurrences: [{ quote: "Kaag answered", ref: "2.1", value: "Kaag" }] },
        { entry: 2, occurrences: [] },
      ],
    })
    const { job, answered } = findJob()
    await runFind(items, job, parse)

    const byFile = new Map(answered.map(({ work, hits }) => [work.file, hits]))
    expect(byFile.get("a.md")).toEqual([])
    expect(byFile.get("b.md")).toEqual([
      { kind: "person", quote: "Kaag answered", hitSentence: 5, value: "kaag" },
    ])
  })
})

describe("a failed call beside an answered sibling", () => {
  // spec.md pinned case + calling.md rounds step 5 — the failed call's entries are not
  // recorded, carry no miss, and the run ends through the no-progress rule.
  it("answers the first batch and leaves the failed batch's unit unrecorded", async () => {
    const items = Array.from({ length: FIND_MAX_ITEMS + 1 }, (_, i) =>
      unitAt(i, [`Filler sentence ${i}.`])
    )
    const { parse, calls } = answeringEach([
      { results: acknowledgedEmpty(Array.from({ length: FIND_MAX_ITEMS }, (_, i) => i + 1)) },
      "unparseable",
      "unparseable",
    ])
    const { job, answered, abandoned } = findJob()
    const result = await runFind(items, job, parse)

    expect(calls).toHaveLength(3)
    expect(answered.map(({ work }) => work)).toEqual(items.slice(0, FIND_MAX_ITEMS))
    expect(abandoned).toEqual([])
    expect(result.unrecorded).toEqual([items[FIND_MAX_ITEMS]])
  })
})

describe("the vocabulary and acknowledged-empty entries", () => {
  // regions.md:15 — the known list grows through values found; an acknowledged-empty
  // entry carries no occurrences, so it adds nothing.
  it("adds nothing to the known values for acknowledged-empty entries", async () => {
    const items = [unitAt(0, ["Rutte opened the meeting."]), unitAt(1, ["The room went quiet."])]
    const { parse } = answering({ results: acknowledgedEmpty([1, 2]) })
    const { job, knownValues } = findJob(["rutte"])
    await runFind(items, job, parse)

    expect([...knownValues]).toEqual(["rutte"])
  })

  // regions.md:14 — a quote locating nowhere drops the occurrence, not the entry's
  // acknowledgment; the entry is still answered (and so still enters scanned).
  it("keeps the acknowledgment when every occurrence's quote fails to locate", async () => {
    const items = [unitAt(0, ["Rutte opened the meeting."])]
    const { parse } = answering({
      results: [
        { entry: 1, occurrences: [{ quote: "Timmermans left", ref: "1.1", value: "Timmermans" }] },
      ],
    })
    const { job, answered, abandoned } = findJob()
    await runFind(items, job, parse)

    expect(answered).toEqual([{ work: items[0], hits: [] }])
    expect(abandoned).toEqual([])
  })
})

const markSentences = Array.from({ length: 60 }, (_, i) => `Sentence number ${i}.`)

const markWorkOf = (hitSentence: number, window: SentenceWindow): MarkWork => ({
  file: "talk.md",
  sentences: markSentences,
  hit: { kind: "person", quote: `quote ${hitSentence}`, hitSentence, value: "rutte" },
  window,
})

interface RecordedMarkJob {
  job: MarkJob
  answered: { work: MarkWork; mark: Mark }[]
  failed: MarkWork[]
}

const markJob = (): RecordedMarkJob => {
  const answered: { work: MarkWork; mark: Mark }[] = []
  const failed: MarkWork[] = []
  return {
    job: {
      kind: person,
      onAnswered: (work, mark) => answered.push({ work, mark }),
      onFailed: (work) => failed.push(work),
    },
    answered,
    failed,
  }
}

describe("mark occurrence identity across re-stretching", () => {
  // regions.md:25 — the miss count is keyed on the occurrence's identity, "which
  // survives re-stretching; after three misses it is abandoned".
  it("accumulates misses for one occurrence across differently shaped stretches", async () => {
    const works = [markWorkOf(10, { start: 8, end: 16 }), markWorkOf(13, { start: 10, end: 18 })]
    const { parse, calls } = answeringEach([
      { results: [{ entry: 1, n: 2, start: "1.6", end: "1.6" }] },
      { results: [] },
      { results: [] },
    ])
    const { job, answered, failed } = markJob()
    await runMark(works, job, parse)

    expect(calls).toHaveLength(3)
    expect(answered.map(({ work }) => work.hit.hitSentence)).toEqual([13])
    expect(failed).toEqual([works[0]])

    const secondPayload = textOf(calls[1].messages[1])
    expect(secondPayload.split("<occurrence ")).toHaveLength(2)
    expect(secondPayload).not.toContain("Sentence number 17.")
  })
})

describe("mark repair through the run", () => {
  // regions.md:24 — repairRange runs per occurrence: "always include the hit".
  it("extends a range that excludes its hit sentence to include it", async () => {
    const works = [markWorkOf(10, { start: 8, end: 16 })]
    const { parse } = answering({ results: [{ entry: 1, n: 1, start: "1.5", end: "1.7" }] })
    const { job, answered } = markJob()
    await runMark(works, job, parse)

    expect(answered[0].mark).toMatchObject({ startSentence: 10, endSentence: 14 })
  })

  // calling.md outcomes — an ordinal failing the schema classifies the call unanswered;
  // regions.md:25 — hits left unrecorded by the no-progress exit join the failure path.
  it("treats an answer with ordinal zero as unanswered and fails the hit unranged", async () => {
    const works = [markWorkOf(10, { start: 8, end: 16 })]
    const { parse, calls } = answering({
      results: [{ entry: 1, n: 0, start: "1.3", end: "1.3" }],
    })
    const { job, answered, failed } = markJob()
    await runMark(works, job, parse)

    expect(calls).toHaveLength(1)
    expect(answered).toEqual([])
    expect(failed).toEqual(works)
  })

  // regions.md:24 — "An (entry, n) pair naming no occurrence in the call is dropped,
  // and the occurrence stays pending, one miss" — here for an entry id not in the call.
  it("drops an answer naming an entry id outside the call and abandons after three", async () => {
    const works = [markWorkOf(10, { start: 8, end: 16 })]
    const { parse, calls } = answering({
      results: [{ entry: 99, n: 1, start: "1.3", end: "1.3" }],
    })
    const { job, answered, failed } = markJob()
    await runMark(works, job, parse)

    expect(calls).toHaveLength(3)
    expect(answered).toEqual([])
    expect(failed).toEqual(works)
  })
})
