import { describe, expect, it } from "vitest"
import type { RecordedCall } from "./recorder"
import { render, type RunReport } from "./report"

const ENDPOINT = "/v1/messages"
const REFUSED = "fetch rejected: connect ECONNREFUSED 127.0.0.1:8081"

const answered = (index: number): RecordedCall => ({
  index,
  endpoint: ENDPOINT,
  request: JSON.stringify({ call: index, messages: [{ role: "user", content: `unit ${index}` }] }),
  reply: `reply text ${index}`,
})

const failed = (index: number, failure = REFUSED): RecordedCall => ({
  index,
  endpoint: ENDPOINT,
  request: JSON.stringify({ call: index }),
  failure,
})

const reportOf = (overrides: Partial<RunReport>): RunReport => ({
  agent: { name: "region-finder", constructedLabel: "hits" },
  path: "scripts/fixtures/try-prompt/transcript.md",
  calls: [answered(1)],
  constructed: [{ kind: "person", quote: "Ada", value: "Ada Lovelace" }],
  outcome: { kind: "completed" },
  view: "both",
  showRequests: false,
  ...overrides,
})

const headerOf = (text: string): string => text.split("\n\n")[0]

const sectionOf = (text: string, title: string): string | undefined =>
  text
    .split("\n== ")
    .map((section) => `== ${section}`)
    .find((section) => section.startsWith(`== ${title}`))

const indexOfLine = (text: string, needle: string): number =>
  text.split("\n").findIndex((line) => line.includes(needle))

describe("render", () => {
  it("carries the walking skeleton's surface: header, one reply, the hits", () => {
    const text = render(reportOf({}))

    expect(headerOf(text)).toContain("region-finder")
    expect(headerOf(text)).toContain("scripts/fixtures/try-prompt/transcript.md")
    expect(headerOf(text)).toContain("1 call")
    expect(text).toContain("reply text 1")
    expect(sectionOf(text, "hits")).toContain('"value": "Ada Lovelace"')
  })

  describe("a broken gateway does not read as an empty run", () => {
    const text = render(
      reportOf({ calls: [failed(1), failed(2), failed(3)], constructed: undefined })
    )

    it("says on the header that the run failed and names the reason", () => {
      expect(headerOf(text)).toContain("FAILED")
      expect(headerOf(text)).toContain("ECONNREFUSED")
    })

    it("says in words that nothing was constructed, never as a JSON literal", () => {
      expect(sectionOf(text, "hits")).toMatch(/nothing was constructed/i)
      expect(text).not.toContain("null")
      expect(text).not.toContain("{}")
      expect(text).not.toContain("[]")
    })
  })

  it("explains nothing about a completed run of zero calls", () => {
    const text = render(reportOf({ calls: [], constructed: undefined }))

    expect(headerOf(text)).toContain("0 calls")
    expect(headerOf(text)).not.toContain("FAILED")
    expect(sectionOf(text, "hits")).toMatch(/nothing was constructed/i)
    expect(text).not.toMatch(/because|precondition|reason|already|threshold/i)
    expect(text).not.toContain("null")
    expect(text).not.toContain("{}")
    expect(text).not.toContain("[]")
  })

  describe("partial failures keep the indices whole", () => {
    const calls = [
      answered(1),
      failed(2, "HTTP 502 — bad gateway"),
      answered(3),
      failed(4, "HTTP 502 — bad gateway"),
      answered(5),
    ]
    const text = render(reportOf({ calls }))

    it("carries both counts on the header", () => {
      expect(headerOf(text)).toContain("5 calls")
      expect(headerOf(text)).toContain("2 failed")
    })

    it("names both failures with their indices before the first reply", () => {
      const failures = sectionOf(text, "failures") ?? ""
      expect(failures).toContain(`#2 ${ENDPOINT}: HTTP 502 — bad gateway`)
      expect(failures).toContain(`#4 ${ENDPOINT}: HTTP 502 — bad gateway`)
      expect(indexOfLine(text, "== failures")).toBeLessThan(indexOfLine(text, "reply text 1"))
    })

    it("still shows five reply entries numbered one through five", () => {
      const replies = sectionOf(text, "replies") ?? ""
      const labels = replies.match(/-- reply #\d/g)
      expect(labels).toEqual([1, 2, 3, 4, 5].map((index) => `-- reply #${index}`))
      expect(replies).toContain("HTTP 502 — bad gateway")
    })

    // report.md: "how many calls went out, how many failed, and the outcome" — a partial
    // failure (not all calls failed, not a rejection) must still read as FAILED on the header,
    // and an identical reason repeated across failed calls must not be repeated in the sentence.
    it("says the run failed on the header and names the shared reason once", () => {
      expect(headerOf(text)).toContain("FAILED")
      const reasonOccurrences = headerOf(text).split("HTTP 502 — bad gateway").length - 1
      expect(reasonOccurrences).toBe(1)
    })
  })

  describe("requests", () => {
    it("prints no request body unless asked", () => {
      const text = render(reportOf({ calls: [answered(1), answered(2)] }))

      expect(text).not.toContain("== requests")
      expect(text).not.toContain('"messages"')
    })

    it("labels each request with the index of its reply and pretty-prints it", () => {
      const text = render(reportOf({ calls: [answered(1), answered(2)], showRequests: true }))
      const requests = sectionOf(text, "requests") ?? ""

      expect(requests).toContain(`-- request #1 ${ENDPOINT}`)
      expect(requests).toContain(`-- request #2 ${ENDPOINT}`)
      expect(requests).toContain('"content": "unit 2"')
      expect(indexOfLine(text, "== requests")).toBeLessThan(indexOfLine(text, "== replies"))
    })

    // recorder.md says `request` is "the JSON body exactly as sent", but nothing upstream
    // of render re-validates it — a body that failed to parse must still be printed, not throw.
    it("prints a request body that is not JSON as-is instead of throwing", () => {
      const call = { ...answered(1), request: "not json" }
      const text = render(reportOf({ calls: [call], showRequests: true }))
      const requests = sectionOf(text, "requests") ?? ""

      expect(requests).toContain("not json")
    })
  })

  describe("view", () => {
    const cases: { view: RunReport["view"]; replies: boolean; constructed: boolean }[] = [
      { view: "both", replies: true, constructed: true },
      { view: "replies-only", replies: true, constructed: false },
      { view: "constructed-only", replies: false, constructed: true },
    ]

    it.each(cases)("$view keeps the header", ({ view, replies, constructed }) => {
      const text = render(reportOf({ view }))

      expect(headerOf(text)).toContain("region-finder")
      expect(text.includes("reply text 1")).toBe(replies)
      expect(text.includes('"Ada Lovelace"')).toBe(constructed)
    })

    // report.md: "Failures, if any, next" is listed unconditionally, ahead of the
    // view-gated requests/replies/constructed sections — constructed-only must not hide it.
    it("constructed-only still shows the failures section", () => {
      const text = render(reportOf({ view: "constructed-only", calls: [failed(1)] }))

      expect(sectionOf(text, "failures")).toContain(`#1 ${ENDPOINT}: ${REFUSED}`)
    })
  })

  it("names the iteration and says nothing about the others", () => {
    const text = render(reportOf({ iteration: { number: 2, of: 3 } }))

    expect(text).toContain("iteration 2 of 3")
    expect(text).not.toMatch(/iteration [13]\b/)
    expect(text).not.toMatch(/previous|next|differ|stable|same/i)
    expect(indexOfLine(text, "iteration 2 of 3")).toBeLessThan(indexOfLine(text, "region-finder"))
  })

  it("shows both the text and the failure of a call that answered and then failed", () => {
    const text = render(
      reportOf({
        calls: [{ ...answered(1), failure: "model error: content_filter" }],
        constructed: undefined,
      })
    )

    expect(headerOf(text)).toContain("1 failed")
    expect(sectionOf(text, "replies")).toContain("reply text 1")
    expect(sectionOf(text, "replies")).toContain("(failed: model error: content_filter)")
  })

  it("prints an empty array from a run where every call succeeded", () => {
    const text = render(reportOf({ calls: [answered(1), answered(2)], constructed: [] }))

    expect(headerOf(text)).toContain("0 failed")
    expect(headerOf(text)).not.toContain("FAILED")
    expect(sectionOf(text, "hits")).toContain("[]")
    expect(sectionOf(text, "hits")).not.toMatch(/nothing was constructed/i)
  })

  it("does not read a rejection as a clean run because every call succeeded", () => {
    const text = render(
      reportOf({
        calls: [answered(1), answered(2)],
        constructed: undefined,
        outcome: { kind: "rejected", message: "hits file has no quote on row 3" },
      })
    )

    expect(headerOf(text)).toContain("FAILED")
    expect(headerOf(text)).toContain("hits file has no quote on row 3")
    expect(headerOf(text)).toContain("0 failed")
    expect(sectionOf(text, "hits")).toMatch(/nothing was constructed/i)
  })
})
