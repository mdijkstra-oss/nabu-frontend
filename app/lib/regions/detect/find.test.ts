import { describe, it, expect } from "vitest"
import type { ParseCall } from "./seam"
import type { KindDescriptor } from "~/lib/regions/kinds/registry"
import type { ScanUnit } from "./types"
import { FIND_ENDPOINT, runFind, toFindInput } from "./find"
import { answering, failing, hasBreakpoint, textOf, throwing } from "./parse-call.fixture"

const speaker: KindDescriptor = {
  id: "speaker",
  rules: "A speaker is the person whose words a passage carries.",
  icon: "mic",
  color: "indigo",
  valueType: "string",
}

const unit: ScanUnit = {
  firstSentence: 12,
  lastSentence: 14,
  sentences: ["Rutte opened the meeting.", "The room went quiet.", "Kaag answered him directly."],
  hash: "irrelevant",
}

const input = toFindInput(speaker, unit, ["rutte"])

describe("toFindInput", () => {
  it("carries the kind's id, rules and value type beside the unit", () => {
    expect(input).toEqual({
      kind: "speaker",
      rules: speaker.rules,
      knownValues: ["rutte"],
      valueType: "string",
      firstSentence: 12,
      sentences: unit.sentences,
    })
  })
})

describe("runFind", () => {
  it("converts a response numbered from 1 into array positions", async () => {
    const { parse } = answering({
      results: [{ quote: "Rutte opened", sentence: 13, value: "Rutte" }],
    })
    const outcome = await runFind(input, parse)

    expect(outcome.hits).toEqual([
      { kind: "speaker", quote: "Rutte opened", hitSentence: 12, value: "rutte" },
    ])
    expect(outcome.errors).toEqual([])
  })

  it("calls the region finder with the rules, the known values and the numbered unit", async () => {
    const { parse, calls } = answering({ results: [] })
    await runFind(input, parse)

    expect(calls[0].endpoint).toBe(FIND_ENDPOINT)
    expect(calls[0].messages.map((m) => m.role)).toEqual(["system", "system", "system", "user"])

    const text = calls[0].messages.map(textOf)
    expect(text[0]).toBe(speaker.rules)
    expect(text[1]).toContain("rutte")
    expect(text[2]).toBe(
      "[13] Rutte opened the meeting.\n[14] The room went quiet.\n[15] Kaag answered him directly."
    )
  })

  it("puts the prompt cache breakpoint on the rules message and nowhere else", async () => {
    const { parse, calls } = answering({ results: [] })
    await runFind(input, parse)

    expect(calls[0].messages.map(hasBreakpoint)).toEqual([true, false, false, false])
  })

  it("sorts the known-value list so the cached prefix does not shift", async () => {
    const { parse, calls } = answering({ results: [] })
    await runFind(toFindInput(speaker, unit, ["timmermans", "kaag", "rutte"]), parse)

    const listed = textOf(calls[0].messages[1])
    expect(listed.indexOf("kaag")).toBeLessThan(listed.indexOf("rutte"))
    expect(listed.indexOf("rutte")).toBeLessThan(listed.indexOf("timmermans"))
  })

  it("tells a self-contained kind there is no list to reuse from", async () => {
    const { parse, calls } = answering({ results: [] })
    await runFind(toFindInput(speaker, unit, []), parse)

    expect(textOf(calls[0].messages[1])).toMatch(/infer/i)
  })

  const failures: { name: string; parse: ParseCall }[] = [
    { name: "a response that is not JSON at all", parse: failing("LLM returned invalid JSON") },
    {
      name: "a response that is JSON of the wrong shape",
      parse: failing("Schema validation failed"),
    },
    { name: "a transport failure", parse: throwing("LLM request failed: 502") },
  ]

  it.each(failures)("returns $name as an error rather than throwing", async ({ parse }) => {
    const outcome = await runFind(input, parse)

    expect(outcome.hits).toEqual([])
    expect(outcome.errors).toHaveLength(1)
    expect(outcome.dropped).toBe(0)
  })

  it("leaves a sibling unit's hits untouched when one unit fails", async () => {
    const sibling: ScanUnit = { ...unit, firstSentence: 20, lastSentence: 22 }
    const { parse } = answering({
      results: [{ quote: "Kaag answered him", sentence: 23, value: "Kaag" }],
    })
    const [failed, survived] = await Promise.all([
      runFind(input, failing("LLM returned invalid JSON")),
      runFind(toFindInput(speaker, sibling, ["rutte"]), parse),
    ])

    expect(failed.hits).toEqual([])
    expect(survived.hits).toEqual([
      { kind: "speaker", quote: "Kaag answered him", hitSentence: 22, value: "kaag" },
    ])
  })

  it("counts the results a gate refused", async () => {
    const { parse } = answering({
      results: [
        { quote: "Rutte opened", sentence: 13, value: "Rutte" },
        { quote: "Rutte opened", sentence: 99, value: "Rutte" },
      ],
    })
    const outcome = await runFind(input, parse)

    expect(outcome.hits).toHaveLength(1)
    expect(outcome.dropped).toBe(1)
  })

  it("constrains a datetime kind's value to an ISO-8601 shape at the schema", async () => {
    const date: KindDescriptor = { ...speaker, id: "date", color: "amber", valueType: "datetime" }
    const { parse } = answering({
      results: [{ quote: "Rutte opened", sentence: 13, value: "last spring" }],
    })
    const outcome = await runFind(toFindInput(date, unit, []), parse)

    expect(outcome.hits).toEqual([])
    expect(outcome.errors).toHaveLength(1)
  })
})
