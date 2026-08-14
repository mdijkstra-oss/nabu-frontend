import { describe, it, expect } from "vitest"
import type { Node } from "prosemirror-model"
import { indexFileSentences } from "~/lib/text/halo"
import { stripMarkdown } from "~/lib/text/strip"
import { posToTextOffset } from "~/lib/editor/text"
import { createDoc, schema, type BlockDef } from "./fixtures"
import { iconSides, resolveRegions, type ResolvedRegion } from "./resolve"
import type { RenderableRegion } from "./types"

const region = (overrides: Partial<RenderableRegion> & { quote: string }): RenderableRegion => ({
  index: 0,
  kind: "speaker",
  kindOrder: 0,
  label: "Rutte",
  value: "rutte",
  colour: "indigo",
  icon: "mic",
  hitSentence: 0,
  startSentence: 0,
  endSentence: 0,
  ...overrides,
})

interface Rendered {
  covers: string
  label: string
}

const renderedOf = (doc: Node, resolved: ResolvedRegion[]): Rendered[] =>
  resolved.map((r) => ({
    covers: doc.textBetween(r.from, r.to, "\n"),
    label: doc.textBetween(r.labelFrom, r.labelTo),
  }))

const TRANSCRIPT: BlockDef[] = [
  "Rutte: yeah, it was quite the event.",
  "The room was full.",
  "This is great, said Rutte.",
]

const TRANSCRIPT_SOURCE = [
  "## Rutte: yeah, it was quite the event.",
  "The room was full.",
  "This is great, said Rutte.",
]

describe("resolveRegions", () => {
  const cases: {
    name: string
    blocks: BlockDef[]
    sentences: string[]
    regions: RenderableRegion[]
    expected: Rendered[]
  }[] = [
    {
      name: "draws the label on the words the region was found by",
      blocks: TRANSCRIPT,
      sentences: TRANSCRIPT_SOURCE,
      regions: [region({ quote: "Rutte", hitSentence: 0, startSentence: 0, endSentence: 1 })],
      expected: [
        {
          covers: "Rutte: yeah, it was quite the event.\nThe room was full.",
          label: "Rutte:",
        },
      ],
    },
    {
      name: "a trailing attribution anchors the label at the region's end",
      blocks: TRANSCRIPT,
      sentences: TRANSCRIPT_SOURCE,
      regions: [region({ quote: "said Rutte", hitSentence: 2, startSentence: 1, endSentence: 2 })],
      expected: [
        { covers: "The room was full.\nThis is great, said Rutte.", label: "said Rutte." },
      ],
    },
    {
      name: "a stale start moves the left edge to the first aligned sentence inside",
      blocks: TRANSCRIPT,
      sentences: ["A sentence the document no longer holds.", ...TRANSCRIPT_SOURCE.slice(1)],
      regions: [region({ quote: "said Rutte", hitSentence: 2, startSentence: 0, endSentence: 2 })],
      expected: [
        { covers: "The room was full.\nThis is great, said Rutte.", label: "said Rutte." },
      ],
    },
    {
      name: "a region whose hit sentence no longer aligns is omitted alone",
      blocks: TRANSCRIPT,
      sentences: [
        TRANSCRIPT_SOURCE[0],
        "A sentence the document no longer holds.",
        TRANSCRIPT_SOURCE[2],
      ],
      regions: [
        region({
          index: 0,
          quote: "room was full",
          hitSentence: 1,
          startSentence: 1,
          endSentence: 1,
        }),
        region({ index: 1, quote: "said Rutte", hitSentence: 2, startSentence: 2, endSentence: 2 }),
      ],
      expected: [{ covers: "This is great, said Rutte.", label: "said Rutte." }],
    },
    {
      name: "a quote that will not locate inside its hit sentence is omitted alone",
      blocks: TRANSCRIPT,
      sentences: TRANSCRIPT_SOURCE,
      regions: [
        region({ index: 0, quote: "Wilders", hitSentence: 0, startSentence: 0, endSentence: 0 }),
        region({ index: 1, quote: "said Rutte", hitSentence: 2, startSentence: 2, endSentence: 2 }),
      ],
      expected: [{ covers: "This is great, said Rutte.", label: "said Rutte." }],
    },
    {
      name: "indexes past the end of the sentence array render nothing",
      blocks: TRANSCRIPT,
      sentences: TRANSCRIPT_SOURCE,
      regions: [region({ quote: "Rutte", hitSentence: 40, startSentence: 40, endSentence: 41 })],
      expected: [],
    },
    {
      name: "a region none of whose sentences align renders nothing",
      blocks: TRANSCRIPT,
      sentences: ["Nothing here.", "Nor here.", "Nor over here."],
      regions: [region({ quote: "Rutte", hitSentence: 0, startSentence: 0, endSentence: 2 })],
      expected: [],
    },
    {
      name: "two labels in one sentence fall at their own offsets",
      blocks: ["John on Friday 2nd said so."],
      sentences: ["John on Friday 2nd said so."],
      regions: [
        region({ index: 0, quote: "John", hitSentence: 0, startSentence: 0, endSentence: 0 }),
        region({
          index: 1,
          kind: "date",
          kindOrder: 1,
          colour: "amber",
          icon: "calendar-days",
          label: "2 August 2026",
          quote: "Friday 2nd",
          hitSentence: 0,
          startSentence: 0,
          endSentence: 0,
        }),
      ],
      expected: [
        { covers: "John on Friday 2nd said so.", label: "John" },
        { covers: "John on Friday 2nd said so.", label: "Friday 2nd" },
      ],
    },
    {
      name: "two kinds quoting the same characters both resolve",
      blocks: ["John on Friday 2nd said so."],
      sentences: ["John on Friday 2nd said so."],
      regions: [
        region({ index: 0, quote: "John", hitSentence: 0, startSentence: 0, endSentence: 0 }),
        region({ index: 1, kind: "date", kindOrder: 1, quote: "John", hitSentence: 0 }),
      ],
      expected: [
        { covers: "John on Friday 2nd said so.", label: "John" },
        { covers: "John on Friday 2nd said so.", label: "John" },
      ],
    },
    {
      name: "a visible code block in the editor only costs its own sentence",
      blocks: [
        "Rutte: yeah, it was quite the event.",
        { code: "const total = 1;" },
        "This is great, said Rutte.",
      ],
      sentences: ["## Rutte: yeah, it was quite the event.", "This is great, said Rutte."],
      regions: [region({ quote: "said Rutte", hitSentence: 1, startSentence: 1, endSentence: 1 })],
      expected: [{ covers: "This is great, said Rutte.", label: "said Rutte." }],
    },
    {
      name: "a hidden block inside a region is spanned and contributes no text",
      blocks: [
        "Rutte: yeah, it was quite the event.",
        { code: '{"regions":[]}', language: "json-regions" },
        "This is great, said Rutte.",
      ],
      sentences: ["## Rutte: yeah, it was quite the event.", "This is great, said Rutte."],
      regions: [region({ quote: "Rutte", hitSentence: 0, startSentence: 0, endSentence: 1 })],
      expected: [
        {
          covers:
            'Rutte: yeah, it was quite the event.\n{"regions":[]}\nThis is great, said Rutte.',
          label: "Rutte:",
        },
      ],
    },
    {
      name: "an empty document with regions renders nothing",
      blocks: [""],
      sentences: TRANSCRIPT_SOURCE,
      regions: [region({ quote: "Rutte" })],
      expected: [],
    },
    {
      name: "a document with no regions renders nothing",
      blocks: TRANSCRIPT,
      sentences: TRANSCRIPT_SOURCE,
      regions: [],
      expected: [],
    },
  ]

  it.each(cases)("$name", ({ blocks, sentences, regions, expected }) => {
    const doc = createDoc(blocks)
    expect(renderedOf(doc, resolveRegions(doc, sentences, regions))).toEqual(expected)
  })

  it("resolves each occurrence of a repeated sentence to its own row", () => {
    const doc = createDoc(["Yes.", "Yes.", "Yes.", "Yes.", "Yes."])
    const sentences = ["Yes.", "Yes.", "Yes.", "Yes.", "Yes."]
    const resolved = resolveRegions(doc, sentences, [
      region({ index: 0, quote: "Yes", hitSentence: 1, startSentence: 1, endSentence: 1 }),
      region({ index: 1, quote: "Yes", hitSentence: 3, startSentence: 3, endSentence: 3 }),
    ])
    expect(resolved.map((r) => posToTextOffset(doc, r.from))).toEqual([5, 15])
  })

  it("composes the label with the mark already on the quote", () => {
    const doc = createDoc([
      {
        runs: [
          { text: "This is great, said " },
          { text: "Rutte", bold: true },
          { text: " in the room." },
        ],
      },
    ])
    const [resolved] = resolveRegions(
      doc,
      ["This is great, said Rutte in the room."],
      [region({ quote: "Rutte", hitSentence: 0, startSentence: 0, endSentence: 0 })]
    )
    expect(doc.textBetween(resolved.labelFrom, resolved.labelTo)).toBe("Rutte")
    expect(doc.rangeHasMark(resolved.labelFrom, resolved.labelTo, schema.marks.strong)).toBe(true)
    expect(doc.rangeHasMark(1, resolved.labelFrom, schema.marks.strong)).toBe(false)
    expect(doc.rangeHasMark(resolved.labelTo, doc.content.size - 1, schema.marks.strong)).toBe(
      false
    )
  })

  it("spans both halves of a quote that leaves its bold run", () => {
    const doc = createDoc([
      { runs: [{ text: "This is great, said " }, { text: "Rutte", bold: true }, { text: "." }] },
    ])
    const [resolved] = resolveRegions(
      doc,
      ["This is great, said Rutte."],
      [region({ quote: "Rutte", hitSentence: 0, startSentence: 0, endSentence: 0 })]
    )
    expect(doc.textBetween(resolved.labelFrom, resolved.labelTo)).toBe("Rutte.")
    expect(doc.rangeHasMark(resolved.labelFrom, resolved.labelTo - 1, schema.marks.strong)).toBe(
      true
    )
    expect(doc.rangeHasMark(resolved.labelTo - 1, resolved.labelTo, schema.marks.strong)).toBe(
      false
    )
  })
})

describe("resolveRegions across the two text spaces", () => {
  const MARKDOWN = [
    "# Interview transcript",
    "",
    "Rutte: yeah, it was **quite the event**.",
    "",
    "See [the summary](https://example.com/summary) for the details.",
    "",
    "- The room was full of people.",
    "\t- Nobody left early.",
    "",
    "```",
    "const total = 1;",
    "```",
    "",
    "This is great, said Rutte.",
    "",
    "```json-regions",
    '{"regions":[],"scanned":{}}',
    "```",
    "",
  ].join("\n")

  const CODE_BLOCK: BlockDef = { code: "const total = 1;" }

  const EDITOR: BlockDef[] = [
    { heading: "Interview transcript" },
    {
      runs: [
        { text: "Rutte: yeah, it was " },
        { text: "quite the event", bold: true },
        { text: "." },
      ],
    },
    {
      runs: [
        { text: "See " },
        { text: "the summary", href: "https://example.com/summary" },
        { text: " for the details." },
      ],
    },
    { bullets: [{ item: "The room was full of people.", nested: ["Nobody left early."] }] },
    CODE_BLOCK,
    "This is great, said Rutte.",
    { code: '{"regions":[],"scanned":{}}', language: "json-regions" },
  ]

  // Space A comes from the real deriver, so the two streams differ exactly as a
  // document does: the source carries its inline markdown and the editor renders it away.
  const sentences = indexFileSentences(MARKDOWN).map((s) => s.text)

  const indexOf = (needle: string): number => sentences.findIndex((s) => s.includes(needle))

  const REGIONS: RenderableRegion[] = [
    region({
      index: 0,
      quote: "quite the event",
      hitSentence: indexOf("quite the event"),
      startSentence: indexOf("Interview transcript"),
      endSentence: indexOf("quite the event"),
    }),
    region({
      index: 1,
      kind: "date",
      kindOrder: 1,
      quote: "the summary",
      hitSentence: indexOf("the summary"),
      startSentence: indexOf("the summary"),
      endSentence: indexOf("room was full"),
    }),
    region({
      index: 2,
      quote: "said Rutte",
      hitSentence: indexOf("This is great"),
      startSentence: indexOf("This is great"),
      endSentence: indexOf("This is great"),
    }),
    region({
      index: 3,
      kind: "date",
      kindOrder: 1,
      quote: "Nobody left early",
      hitSentence: indexOf("Nobody left early"),
      startSentence: indexOf("Nobody left early"),
      endSentence: indexOf("This is great"),
    }),
  ]

  const AFTER_THE_CODE_BLOCK = 2

  const renderAgainst = (blocks: BlockDef[]): { doc: Node; rendered: Rendered[] } => {
    const doc = createDoc(blocks)
    return { doc, rendered: renderedOf(doc, resolveRegions(doc, sentences, REGIONS)) }
  }

  it("the source stream is what the deriver really produces", () => {
    expect(sentences).toEqual([
      "# Interview transcript",
      "Rutte: yeah, it was **quite the event**.",
      "See [the summary](https://example.com/summary) for the details.",
      "- The room was full of people.",
      "- Nobody left early.",
      "This is great, said Rutte.",
    ])
  })

  it("every label covers its own quote and every tint ends on its own last sentence", () => {
    const { rendered } = renderAgainst(EDITOR)
    expect(rendered).toEqual([
      {
        covers: "Interview transcript\nRutte: yeah, it was quite the event.",
        label: "quite the event.",
      },
      {
        covers: "See the summary for the details.\nThe room was full of people.",
        label: "the summary",
      },
      { covers: "This is great, said Rutte.", label: "said Rutte." },
      {
        covers: "Nobody left early.\nconst total = 1;\nThis is great, said Rutte.",
        label: "Nobody left early.",
      },
    ])
  })

  it("no drift accumulates: each region ends at the last character of its own last sentence", () => {
    const { doc, rendered } = renderAgainst(EDITOR)
    const resolved = resolveRegions(doc, sentences, REGIONS)
    rendered.forEach((r, i) => {
      const lastSentence = stripMarkdown(sentences[REGIONS[i].endSentence])
      expect(r.covers.endsWith(lastSentence)).toBe(true)
      expect(doc.textBetween(resolved[i].to, doc.content.size - 1)).not.toContain(lastSentence)
    })
  })

  it("draws the label for a stored quote carrying the syntax of the link it straddles", () => {
    const straddling = region({
      quote: "the summary](https://example.com/summary) for the details",
      hitSentence: indexOf("the summary"),
      startSentence: indexOf("the summary"),
      endSentence: indexOf("the summary"),
    })
    const doc = createDoc(EDITOR)
    const [resolved] = resolveRegions(doc, sentences, [straddling])

    expect(doc.textBetween(resolved.labelFrom, resolved.labelTo)).toBe(
      "the summary for the details."
    )
  })

  it("removing the visible code block from the editor resyncs instead of shifting", () => {
    const withoutCode = EDITOR.filter((block) => block !== CODE_BLOCK)
    const { doc, rendered } = renderAgainst(withoutCode)

    expect(doc.textContent).not.toContain("const total")
    expect(rendered).toHaveLength(REGIONS.length)
    expect(rendered[AFTER_THE_CODE_BLOCK]).toEqual({
      covers: "This is great, said Rutte.",
      label: "said Rutte.",
    })
    expect(rendered.slice(0, AFTER_THE_CODE_BLOCK)).toEqual(
      renderAgainst(EDITOR).rendered.slice(0, AFTER_THE_CODE_BLOCK)
    )
    expect(rendered[3].covers).toBe("Nobody left early.\nThis is great, said Rutte.")
  })
})

describe("iconSides", () => {
  const resolved = (kindOrder: number): ResolvedRegion => ({
    region: region({ quote: "x", kindOrder }),
    from: 1,
    to: 2,
    labelFrom: 1,
    labelTo: 2,
  })

  const cases: { name: string; kindOrders: number[]; expected: number[] }[] = [
    { name: "a lone kind sits before the annotation markers", kindOrders: [0], expected: [-2] },
    {
      name: "coinciding icons run left to right in kind order",
      kindOrders: [0, 1],
      expected: [-3, -2],
    },
    {
      name: "order holds however the regions are ordered",
      kindOrders: [1, 0],
      expected: [-2, -3],
    },
  ]

  it.each(cases)("$name", ({ kindOrders, expected }) => {
    const sides = iconSides(kindOrders.map(resolved))
    expect(sides).toEqual(expected)
    sides.forEach((side) => expect(side).toBeLessThan(-1))
  })
})
