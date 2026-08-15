import { describe, it, expect } from "vitest"
import type { KindDescriptor } from "~/lib/regions/kinds/registry"
import type { Hit, Mark, MarkJob, MarkWork, SentenceWindow } from "./types"
import { MARK_ENDPOINT, runMark } from "./mark"
import {
  answering,
  answeringEach,
  answeringWhenReleased,
  failing,
  hasBreakpoint,
  textOf,
} from "./parse-call.fixture"

const person: KindDescriptor = {
  id: "person",
  rules: "A person is the person whose words a passage carries.",
  icon: "user",
  color: "indigo",
  valueType: "string",
}

const sentences = Array.from({ length: 60 }, (_, i) => `Sentence number ${i}.`)

const hitAt = (hitSentence: number, value = "rutte"): Hit => ({
  kind: "person",
  quote: `quote ${hitSentence}`,
  hitSentence,
  value,
})

const workOf = (hitSentence: number, window: SentenceWindow, value = "rutte"): MarkWork => ({
  file: "talk.md",
  sentences,
  hit: hitAt(hitSentence, value),
  window,
})

interface RecordedJob {
  job: MarkJob
  answered: { work: MarkWork; mark: Mark }[]
  failed: MarkWork[]
}

const jobFor = (): RecordedJob => {
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

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe("the mark payload", () => {
  const works = [workOf(10, { start: 8, end: 16 }), workOf(13, { start: 10, end: 18 })]

  it("renders one stretch entry with occurrence children before its numbered content", async () => {
    const { parse, calls } = answering({
      results: [
        { entry: 1, n: 1, start: "1.2", end: "1.4" },
        { entry: 1, n: 2, start: "1.5", end: "1.8" },
      ],
    })
    await runMark(works, jobFor().job, parse)

    expect(calls).toHaveLength(1)
    expect(calls[0].endpoint).toBe(MARK_ENDPOINT)
    expect(calls[0].messages.map((m) => m.role)).toEqual(["system", "system", "user"])
    expect(calls[0].messages.map(hasBreakpoint)).toEqual([true, false, false])
    expect(textOf(calls[0].messages[0])).toBe(person.rules)

    const lines = textOf(calls[0].messages[1]).split("\n")
    expect(lines[0]).toBe('<entry id="1" file="talk.md">')
    expect(lines[1]).toBe('<occurrence n="1" ref="1.3">quote 10</occurrence>')
    expect(lines[2]).toBe('<occurrence n="2" ref="1.6">quote 13</occurrence>')
    expect(lines[3]).toBe("[1.1] Sentence number 8.")
    expect(lines.at(-2)).toBe("[1.11] Sentence number 18.")
    expect(lines.at(-1)).toBe("</entry>")

    expect(calls[0].messages.map(textOf).at(-1)).toMatch(/not in doubt/i)
  })

  it("sends the text between two coalesced hits exactly once", async () => {
    const { parse, calls } = answering({
      results: [
        { entry: 1, n: 1, start: "1.3", end: "1.3" },
        { entry: 1, n: 2, start: "1.6", end: "1.6" },
      ],
    })
    await runMark(works, jobFor().job, parse)

    const payload = calls[0].messages.map(textOf).join("\n")
    expect(payload.split("Sentence number 11.")).toHaveLength(2)
  })

  it("packs stretches of at most ten occurrences into one call", async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      workOf(i * 2, { start: Math.max(0, i * 2 - 1), end: i * 2 + 1 })
    )
    const { parse, calls } = answeringEach([{ results: [] }, { results: [] }, { results: [] }])
    await runMark(many, jobFor().job, parse)

    const entryCounts = calls[0].messages
      .map(textOf)
      .filter((text) => text.startsWith("<entry "))
      .map((text) => text.split("<occurrence ").length - 1)
    expect(entryCounts).toEqual([10, 10, 5])
  })
})

describe("resolving mark answers", () => {
  it("converts entry-local refs through the stretch's window start", async () => {
    const works = [workOf(10, { start: 8, end: 16 }), workOf(13, { start: 10, end: 18 })]
    const { parse } = answering({
      results: [
        { entry: 1, n: 1, start: "1.2", end: "1.4" },
        { entry: 1, n: 2, start: "1.5", end: "1.8" },
      ],
    })
    const { job, answered, failed } = jobFor()
    await runMark(works, job, parse)

    expect(failed).toEqual([])
    expect(answered.map(({ work, mark }) => [work.hit.hitSentence, mark])).toEqual([
      [10, { ...hitAt(10), startSentence: 9, endSentence: 11 }],
      [13, { ...hitAt(13), startSentence: 12, endSentence: 15 }],
    ])
  })

  it("collapses an inverted range to the occurrence's own sentence", async () => {
    const works = [workOf(10, { start: 8, end: 16 })]
    const { parse } = answering({ results: [{ entry: 1, n: 1, start: "1.6", end: "1.2" }] })
    const { job, answered } = jobFor()
    await runMark(works, job, parse)

    expect(answered[0].mark).toMatchObject({ startSentence: 10, endSentence: 10 })
  })

  it("drops an answer naming an occurrence the call does not hold", async () => {
    const works = [workOf(10, { start: 8, end: 16 })]
    const { parse, calls } = answeringEach([
      { results: [{ entry: 1, n: 5, start: "1.2", end: "1.4" }] },
      { results: [{ entry: 1, n: 1, start: "1.2", end: "1.4" }] },
    ])
    const { job, answered } = jobFor()
    await runMark(works, job, parse)

    expect(calls).toHaveLength(2)
    expect(answered).toHaveLength(1)
  })

  it("drops an answer whose range refs resolve outside its own entry", async () => {
    const works = [workOf(2, { start: 0, end: 4 }), workOf(30, { start: 28, end: 34 })]
    const { parse, calls } = answeringEach([
      {
        results: [
          { entry: 1, n: 1, start: "2.1", end: "2.2" },
          { entry: 2, n: 1, start: "2.2", end: "2.4" },
        ],
      },
      { results: [{ entry: 1, n: 1, start: "1.3", end: "1.3" }] },
    ])
    const { job, answered } = jobFor()
    await runMark(works, job, parse)

    expect(calls).toHaveLength(2)
    expect(answered.map(({ work }) => work.hit.hitSentence).sort((a, b) => a - b)).toEqual([2, 30])
  })
})

describe("per-occurrence requeue", () => {
  it("re-coalesces only the pending occurrences, so the next stretch is smaller", async () => {
    const works = [workOf(10, { start: 8, end: 16 }), workOf(13, { start: 10, end: 18 })]
    const { parse, calls } = answeringEach([
      { results: [{ entry: 1, n: 1, start: "1.3", end: "1.3" }] },
      { results: [{ entry: 1, n: 1, start: "1.4", end: "1.4" }] },
    ])
    const { job, answered, failed } = jobFor()
    await runMark(works, job, parse)

    expect(calls).toHaveLength(2)
    const retried = textOf(calls[1].messages[1])
    expect(retried).toContain("[1.1] Sentence number 10.")
    expect(retried).not.toContain("Sentence number 8.")
    expect(retried.split("<occurrence ")).toHaveLength(2)

    expect(failed).toEqual([])
    expect(answered.map(({ work, mark }) => [work.hit.hitSentence, mark.startSentence])).toEqual([
      [10, 10],
      [13, 13],
    ])
  })

  it("abandons an occurrence to the failure path after three silent answers", async () => {
    const works = [workOf(10, { start: 8, end: 16 })]
    const { parse, calls } = answeringEach([{ results: [] }, { results: [] }, { results: [] }])
    const { job, answered, failed } = jobFor()
    await runMark(works, job, parse)

    expect(calls).toHaveLength(3)
    expect(answered).toEqual([])
    expect(failed).toEqual(works)
  })

  it("fails every occurrence of a run whose calls never answer", async () => {
    const works = [workOf(10, { start: 8, end: 16 }), workOf(30, { start: 28, end: 34 })]
    const { job, answered, failed } = jobFor()
    await runMark(works, job, failing("LLM returned invalid JSON"))

    expect(answered).toEqual([])
    expect(failed).toEqual(works)
  })
})

describe("mark concurrency", () => {
  it("dispatches both batches before either resolves", async () => {
    const works = Array.from({ length: 11 }, (_, i) =>
      workOf(i * 5, { start: i * 5, end: i * 5 + 1 })
    )
    const { parse, calls, held } = answeringWhenReleased()
    const { job } = jobFor()
    const run = runMark(works, job, parse)

    await flushMicrotasks()
    expect(calls).toHaveLength(2)

    for (const call of held) call.fail("gateway down")
    await run
  })
})
