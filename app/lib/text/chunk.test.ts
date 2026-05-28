import { describe, it, expect } from "vitest"
import { chunk } from "./chunk"
import type { Segment, TextChunk, ChunkConfig } from "./types"

const seg = (text: string, start: number): Segment => ({
  text,
  start,
  end: start + text.length,
})

const buildSegments = (texts: string[]): Segment[] => {
  const segments: Segment[] = []
  let offset = 0
  for (const text of texts) {
    segments.push(seg(text, offset))
    offset += text.length
  }
  return segments
}

describe("chunk", () => {
  const cases: {
    name: string
    segments: Segment[]
    config: ChunkConfig
    check: (result: TextChunk[]) => void
  }[] = [
    {
      name: "empty segments → empty chunks",
      segments: [],
      config: { target: 100, min: 50 },
      check: (r) => expect(r).toEqual([]),
    },
    {
      name: "single small segment → one chunk",
      segments: buildSegments(["hello world"]),
      config: { target: 100, min: 50 },
      check: (r) => {
        expect(r).toHaveLength(1)
        expect(r[0].text).toBe("hello world")
      },
    },
    {
      name: "segments accumulate within target",
      segments: buildSegments(["aaa", "bbb", "ccc"]),
      config: { target: 20, min: 5 },
      check: (r) => {
        expect(r).toHaveLength(1)
        expect(r[0].text).toBe("aaabbbccc")
      },
    },
    {
      name: "flush when target exceeded and buffer >= min",
      segments: buildSegments(["a".repeat(60), "b".repeat(60)]),
      config: { target: 100, min: 50 },
      check: (r) => {
        expect(r).toHaveLength(2)
        expect(r[0].text).toBe("a".repeat(60))
        expect(r[1].text).toBe("b".repeat(60))
      },
    },
    {
      name: "breakBefore flushes buffer",
      segments: buildSegments(["content", "# heading", "more"]),
      config: {
        target: 1000,
        min: 1,
        breakBefore: (s) => s.text.startsWith("#"),
      },
      check: (r) => {
        expect(r).toHaveLength(2)
        expect(r[0].text).toBe("content")
        expect(r[1].text).toBe("# headingmore")
      },
    },
    {
      name: "force-split oversized segment at word boundary",
      segments: buildSegments(["the quick brown fox jumps over the lazy dog"]),
      config: { target: 20, min: 5 },
      check: (r) => {
        expect(r.length).toBeGreaterThanOrEqual(2)
        for (const c of r) {
          expect(c.text.length).toBeLessThanOrEqual(25)
        }
      },
    },
    {
      name: "force-split with space at exact target boundary does not recurse infinitely",
      segments: buildSegments(["abcde fghij klmno"]),
      config: { target: 5, min: 1 },
      check: (r) => {
        const reassembled = r.map((c) => c.text).join("")
        expect(reassembled).toBe("abcde fghij klmno")
        for (const c of r) {
          expect(c.text.length).toBeLessThanOrEqual(6)
        }
      },
    },
    {
      name: "merge tiny tail into previous",
      segments: buildSegments(["a".repeat(80), "b".repeat(80), "xy"]),
      config: { target: 100, min: 50 },
      check: (r) => {
        const last = r[r.length - 1]
        expect(last.text).toContain("xy")
        expect(last.text.length).toBeGreaterThan(2)
      },
    },
    {
      name: "custom sizeOf controls accumulation",
      segments: buildSegments(["large", "tiny", "large2"]),
      config: {
        target: 10,
        min: 3,
        sizeOf: (s) => (s.text === "tiny" ? 0 : s.text.length),
      },
      check: (r) => {
        expect(r).toHaveLength(2)
        expect(r[0].text).toBe("largetiny")
      },
    },
    {
      name: "maxSegment raises force-split threshold",
      segments: buildSegments(["a".repeat(30)]),
      config: { target: 20, min: 5, maxSegment: 40 },
      check: (r) => {
        expect(r).toHaveLength(1)
        expect(r[0].text).toBe("a".repeat(30))
      },
    },
    {
      name: "maxSegment still force-splits above threshold",
      segments: buildSegments(["the quick brown fox jumps over the lazy dog"]),
      config: { target: 20, min: 5, maxSegment: 25 },
      check: (r) => {
        expect(r.length).toBeGreaterThanOrEqual(2)
      },
    },
  ]

  it.each(cases)("$name", ({ segments, config, check }) => {
    check(chunk(segments, config))
  })

  it("offset correctness: chunks cover original text range", () => {
    const text = "Hello world. This is a test. Another sentence here."
    const segments = buildSegments(["Hello world. ", "This is a test. ", "Another sentence here."])
    const result = chunk(segments, { target: 30, min: 10 })
    for (const c of result) {
      expect(c.start).toBeGreaterThanOrEqual(0)
      expect(c.end).toBeLessThanOrEqual(text.length)
      expect(c.end).toBeGreaterThan(c.start)
    }
  })
})
