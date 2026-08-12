import { describe, it, expect } from "vitest"
import type { ParseCall } from "./seam"
import type { Hit, MarkInput } from "./types"
import { MARK_ENDPOINT, runMark, toMarkInput } from "./mark"
import { computeWindows } from "./window"
import { answering, failing, textOf, throwing } from "./parse-call.fixture"

const RULES = "A speaker is the person whose words a passage carries."

const sentences = Array.from({ length: 40 }, (_, i) => `Sentence number ${i}.`)

const hit = (hitSentence: number, value = "rutte"): Hit => ({
  kind: "speaker",
  quote: `quote ${hitSentence}`,
  hitSentence,
  value,
})

const markInput = (over: Partial<MarkInput> = {}): MarkInput => ({
  kind: "speaker",
  rules: RULES,
  quote: "Rutte opened",
  hitSentence: 10,
  value: "rutte",
  windowStart: 5,
  windowEnd: 20,
  sentences: sentences.slice(5, 21),
  ...over,
})

describe("toMarkInput", () => {
  it("carries exactly one quote, one hit sentence and one window per hit", () => {
    const hits = [hit(2), hit(9), hit(17), hit(25), hit(33)]
    const inputs = computeWindows(hits, sentences).map((w) => toMarkInput(w, RULES, sentences))

    expect(inputs).toHaveLength(5)
    expect(inputs.map((i) => i.quote)).toEqual(hits.map((h) => h.quote))
    expect(inputs.map((i) => i.hitSentence)).toEqual(hits.map((h) => h.hitSentence))
    expect(new Set(inputs.map((i) => `${i.windowStart}-${i.windowEnd}`)).size).toBe(5)
    for (const input of inputs) {
      expect(input.sentences).toEqual(sentences.slice(input.windowStart, input.windowEnd + 1))
    }
  })

  it("carries the hit's value without rendering it into the payload", async () => {
    const [windowed] = computeWindows([hit(10, "rutte")], sentences)
    const input = toMarkInput(windowed, RULES, sentences)
    const { parse, calls } = answering({ results: [] })
    await runMark(input, parse)

    expect(input.value).toBe("rutte")
    expect(calls[0].messages.map(textOf).join("\n")).not.toContain("rutte")
  })
})

describe("runMark", () => {
  it("converts a response numbered from 1 into array positions", async () => {
    const { parse } = answering({ results: [{ start: 3, end: 5 }] })
    const outcome = await runMark(
      markInput({ hitSentence: 3, windowStart: 0, windowEnd: 20 }),
      parse
    )

    expect(outcome.mark).toEqual({
      kind: "speaker",
      quote: "Rutte opened",
      hitSentence: 3,
      value: "rutte",
      startSentence: 2,
      endSentence: 4,
    })
    expect(outcome.error).toBeUndefined()
  })

  it("calls the region marker with the rules, the numbered window and the hit", async () => {
    const { parse, calls } = answering({ results: [{ start: 6, end: 12 }] })
    await runMark(markInput(), parse)

    expect(calls[0].endpoint).toBe(MARK_ENDPOINT)
    expect(calls[0].messages.map((m) => m.role)).toEqual(["system", "system", "user"])

    const text = calls[0].messages.map(textOf)
    expect(text[0]).toBe(RULES)
    expect(text[1]).toContain("[6] Sentence number 5.")
    expect(text[1]).toContain("[21] Sentence number 20.")

    const hitLine = text[1].trim().split("\n").at(-1) ?? ""
    expect(hitLine).toContain("11")
    expect(hitLine).toContain("Rutte opened")
  })

  const emptyAnswers: { name: string; parse: ParseCall }[] = [
    { name: "a call that failed after its retry", parse: failing("LLM returned invalid JSON") },
    { name: "a transport failure", parse: throwing("LLM request failed: 502") },
    { name: "a response with no entry to read", parse: answering({ results: [] }).parse },
  ]

  it.each(emptyAnswers)("yields no range and an error for $name", async ({ parse }) => {
    const outcome = await runMark(markInput(), parse)

    expect(outcome.mark).toBeNull()
    expect(outcome.error).toBeTruthy()
  })

  it("leaves a sibling hit's region untouched when one mark fails", async () => {
    const { parse } = answering({ results: [{ start: 6, end: 12 }] })
    const [failed, survived] = await Promise.all([
      runMark(markInput(), failing("LLM returned invalid JSON")),
      runMark(markInput({ quote: "Kaag answered", value: "kaag" }), parse),
    ])

    expect(failed.mark).toBeNull()
    expect(survived.mark).toMatchObject({ value: "kaag", startSentence: 5, endSentence: 11 })
  })

  it("reads only the first entry when the model returns several", async () => {
    const { parse } = answering({
      results: [
        { start: 6, end: 12 },
        { start: 1, end: 21 },
      ],
    })
    const outcome = await runMark(markInput(), parse)

    expect(outcome.mark).toMatchObject({ startSentence: 5, endSentence: 11 })
  })
})
