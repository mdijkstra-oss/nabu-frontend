import { describe, it, expect } from "vitest"
import { extractProse } from "~/lib/data-blocks/parse"
import { MAX_SENTENCE_CHARS } from "./constants"
import { readCorpus } from "./fixtures/corpus"
import {
  buildHalo,
  buildHaloForRows,
  indexFileSentences,
  indexProseSentences,
  proseOf,
  type HaloResult,
} from "./halo"

const corpus = readCorpus()

const FILE = [
  "First sentence.",
  "Second sentence.",
  "Third sentence.",
  "Fourth sentence.",
  "Fifth sentence.",
  "Sixth sentence.",
  "Seventh sentence.",
].join(" ")

const must = (h: HaloResult | null): HaloResult => {
  if (h === null) throw new Error("expected halo, got null")
  return h
}

describe("indexFileSentences", () => {
  it("splits prose into sentence rows with offsets", () => {
    const rows = indexFileSentences(FILE)
    expect(rows.length).toBe(7)
    expect(rows[0].text).toContain("First sentence")
    expect(rows[6].text).toContain("Seventh sentence")
    expect(rows[0].start).toBe(0)
    expect(rows[1].start).toBeGreaterThan(rows[0].end)
  })

  it("returns empty for empty input", () => {
    expect(indexFileSentences("")).toEqual([])
  })

  it.each(corpus)("$name — every row is a slice of the prose it addresses", ({ raw }) => {
    const prose = proseOf(raw)
    const rows = indexFileSentences(raw)

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(prose.slice(row.start, row.end)).toBe(row.text)
    }
  })

  it.each(corpus)("$name — rows ascend and never overlap", ({ raw }) => {
    const rows = indexFileSentences(raw)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].end).toBeLessThanOrEqual(rows[i].start)
    }
  })
})

describe("indexFileSentences — fenced code blocks", () => {
  const withBlock = (code: string): string =>
    `Before the block.\n\n\`\`\`ts\n${code}\n\`\`\`\n\nAfter the block. And one more.`

  it("yields no sentence from inside the block", () => {
    const rows = indexFileSentences(withBlock("const x = 1 // A sentence. Another one."))
    expect(rows.some((r) => r.text.includes("A sentence."))).toBe(false)
    expect(rows.map((r) => r.text)).toContain("Before the block.")
  })

  it("leaves the offsets after it unmoved when the block's content changes", () => {
    const short = indexFileSentences(withBlock("const x = 1"))
    const long = indexFileSentences(
      withBlock("const x = 1 // A much longer body. With sentences.\nconst y = 2")
    )
    expect(long).toEqual(short)
  })
})

describe("buildHaloForRows", () => {
  const rows = indexFileSentences(FILE)

  it("returns null when range doesn't overlap any sentence", () => {
    expect(buildHaloForRows(rows, 10000, 10001, 2)).toBeNull()
  })

  it("halo around middle sentence includes ±N", () => {
    const target = rows[3]
    const out = must(buildHaloForRows(rows, target.start, target.end, 2))
    expect(out.haloSentences.length).toBe(5)
    expect(out.markedStart).toBe(3)
    expect(out.markedEnd).toBe(3)
  })

  it("halo clamped at start of file", () => {
    const target = rows[0]
    const out = must(buildHaloForRows(rows, target.start, target.end, 3))
    expect(out.haloSentences.length).toBe(4)
    expect(out.markedStart).toBe(1)
  })

  it("halo clamped at end of file", () => {
    const target = rows[6]
    const out = must(buildHaloForRows(rows, target.start, target.end, 3))
    expect(out.haloSentences.length).toBe(4)
    expect(out.markedStart).toBe(4)
    expect(out.markedEnd).toBe(4)
  })

  it("multi-sentence match: markedStart/End span the matched range", () => {
    const start = rows[2].start
    const end = rows[4].end
    const out = must(buildHaloForRows(rows, start, end, 2))
    expect(out.markedStart).toBe(3)
    expect(out.markedEnd).toBe(5)
  })

  it("zero halo returns only marked sentences", () => {
    const target = rows[3]
    const out = must(buildHaloForRows(rows, target.start, target.end, 0))
    expect(out.haloSentences.length).toBe(1)
    expect(out.markedStart).toBe(1)
    expect(out.markedEnd).toBe(1)
  })
})

describe("buildHalo (raw file)", () => {
  it("strips and indexes then builds halo", () => {
    const out = must(buildHalo(FILE, 0, 16, 1))
    expect(out.markedStart).toBe(1)
  })

  it("returns null when range can't be located", () => {
    expect(buildHalo(FILE, 1000000, 1000001, 1)).toBeNull()
  })
})

describe("proseOf", () => {
  it("is extractProse and nothing more", () => {
    const raw =
      "# Title\n\nSee [the report](https://ex.com/a) and **this**.\n\n```ts\nconst x = 1\n```\n"
    expect(proseOf(raw)).toBe(extractProse(raw))
  })

  it("leaves a row's inline markdown in the text it returns", () => {
    const rows = indexFileSentences("See [the report](https://ex.com/a.b.c) next.")
    expect(rows.map((r) => r.text)).toEqual(["See [the report](https://ex.com/a.b.c) next."])
  })
})

describe("indexFileSentences over a fence with no info string", () => {
  const withBlock = (code: string): string =>
    `Before the block.\n\n\`\`\`\n${code}\n\`\`\`\n\nAfter the block. And one more.`

  it("takes no sentence from inside it", () => {
    const rows = indexFileSentences(withBlock("const x = 1 // A sentence. Another one."))
    expect(rows.map((row) => row.text)).toEqual([
      "Before the block.",
      "After the block.",
      "And one more.",
    ])
  })

  it("moves no offset when the code inside it is edited", () => {
    const short = indexFileSentences(withBlock("const x = 1"))
    const long = indexFileSentences(
      withBlock("const x = 1 // A much longer body. With sentences.\nconst y = 2")
    )
    expect(long).toEqual(short)
  })
})

describe("indexProseSentences over text the segmenter cannot break up", () => {
  const cases: { name: string; prose: string }[] = [
    { name: "no terminal punctuation at all", prose: "word ".repeat(10_000) },
    {
      name: "one very long sentence among ordinary ones",
      prose: `Ordinary opening. ${"x".repeat(40_000)}. Ordinary close.`,
    },
    { name: "a run with no whitespace to break at", prose: "A1b2C3d4".repeat(10_000) },
  ]

  it.each(cases)("bounds every row: $name", ({ prose }) => {
    const rows = indexProseSentences(prose)

    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) expect(row.end - row.start).toBeLessThanOrEqual(MAX_SENTENCE_CHARS)
  })

  it.each(cases)("keeps every row a slice of the prose in order: $name", ({ prose }) => {
    const rows = indexProseSentences(prose)

    for (const row of rows) expect(prose.slice(row.start, row.end)).toBe(row.text)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].end).toBeLessThanOrEqual(rows[i].start)
  })

  it("breaks at a word boundary where the text has one", () => {
    const rows = indexProseSentences("alpha ".repeat(10_000))

    for (const row of rows) {
      expect(
        row.text
          .trim()
          .split(/\s+/)
          .every((word) => word === "alpha")
      ).toBe(true)
    }
  })
})
