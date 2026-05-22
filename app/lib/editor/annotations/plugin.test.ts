import { describe, it, expect } from "vitest"
import { Schema } from "prosemirror-model"
import { textOffsetToPos, proseTextContent } from "~/lib/editor/text"

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    code_block: {
      group: "block",
      content: "text*",
      code: true,
      attrs: { language: { default: null } },
    },
    text: { group: "inline" },
    hard_break: { group: "inline", inline: true, selectable: false },
  },
})

type BlockDef = string | { code: string; language?: string }

const isCodeDef = (def: BlockDef): def is { code: string; language?: string } =>
  typeof def !== "string"

const toNode = (def: BlockDef) =>
  isCodeDef(def)
    ? schema.nodes.code_block.create(
        { language: def.language ?? null },
        def.code ? schema.text(def.code) : null
      )
    : schema.nodes.paragraph.create(null, def ? schema.text(def) : null)

const createDoc = (blocks: BlockDef[]) => schema.nodes.doc.create(null, blocks.map(toNode))

const createDocWithBreaks = (content: (string | "br")[]) => {
  const children: ReturnType<typeof schema.nodes.paragraph.create>[] = []
  let currentPara: (
    | ReturnType<typeof schema.text>
    | ReturnType<typeof schema.nodes.hard_break.create>
  )[] = []

  const flushPara = () => {
    if (currentPara.length > 0) {
      children.push(schema.nodes.paragraph.create(null, currentPara))
      currentPara = []
    }
  }

  for (const item of content) {
    if (item === "br") {
      currentPara.push(schema.nodes.hard_break.create())
    } else if (item === "\n") {
      flushPara()
    } else {
      currentPara.push(schema.text(item))
    }
  }
  flushPara()

  return schema.nodes.doc.create(null, children)
}

describe("textOffsetToPos", () => {
  describe("single paragraph", () => {
    const cases = [
      {
        name: "offset 0 returns start of text",
        paragraphs: ["Hello"],
        offset: 0,
        expected: 1,
      },
      {
        name: "offset in middle of text",
        paragraphs: ["Hello"],
        offset: 2,
        expected: 3,
      },
      {
        name: "offset at end of text",
        paragraphs: ["Hello"],
        offset: 5,
        expected: 6,
      },
    ]

    it.each(cases)("$name", ({ paragraphs, offset, expected }) => {
      const doc = createDoc(paragraphs)
      expect(textOffsetToPos(doc, offset)).toBe(expected)
    })
  })

  describe("multiple paragraphs", () => {
    const cases = [
      {
        name: "offset 0 in first paragraph",
        paragraphs: ["Hello", "World"],
        offset: 0,
        expected: 1,
      },
      {
        name: "offset at boundary between paragraphs",
        paragraphs: ["Hello", "World"],
        offset: 6,
        description: "proseText='Hello\\nWorld', offset 6 is 'W'",
        expected: 8,
      },
      {
        name: "offset in second paragraph",
        paragraphs: ["Hello", "World"],
        offset: 8,
        description: "proseText='Hello\\nWorld', offset 8 is 'r'",
        expected: 10,
      },
      {
        name: "three paragraphs - text in third",
        paragraphs: ["AAA", "BBB", "CCC"],
        offset: 8,
        description: "proseText='AAA\\nBBB\\nCCC', offset 8 is first 'C'",
        expected: 11,
      },
    ]

    it.each(cases)("$name", ({ paragraphs, offset, expected }) => {
      const doc = createDoc(paragraphs)
      const result = textOffsetToPos(doc, offset)
      expect(result).toBe(expected)
    })

    const behaviorCases: { name: string; check: () => void }[] = [
      {
        name: "handles hard_break nodes within paragraph",
        check: () => {
          const doc = createDocWithBreaks(["Label:", "br", "Content"])
          const contentOffset = doc.textContent.indexOf("Content")
          expect(textOffsetToPos(doc, contentOffset)).toBeGreaterThan(1)
        },
      },
      {
        name: "documents prosemirror position structure",
        check: () => {
          const doc = createDoc(["AB", "CD"])
          expect(doc.textContent).toBe("ABCD")
          expect(textOffsetToPos(doc, 0)).toBe(1)
          expect(textOffsetToPos(doc, 1)).toBe(2)
          expect(textOffsetToPos(doc, 3)).toBe(5)
          expect(textOffsetToPos(doc, 4)).toBe(6)
        },
      },
    ]

    it.each(behaviorCases)("$name", ({ check }) => check())
  })

  describe("hidden block exclusion", () => {
    const cases = [
      {
        name: "proseTextContent excludes hidden block text",
        blocks: [
          "Hello",
          { code: '{"tags": ["interview"]}', language: "json-attributes" },
          "World",
        ] as BlockDef[],
        expectedProseText: "Hello\nWorld",
      },
      {
        name: "proseTextContent with only hidden block returns empty",
        blocks: [{ code: "some code", language: "json-attributes" }] as BlockDef[],
        expectedProseText: "",
      },
      {
        name: "proseTextContent with hidden block between paragraphs",
        blocks: ["AAA", { code: "BBB", language: "json-attributes" }, "CCC"] as BlockDef[],
        expectedProseText: "AAA\nCCC",
      },
      {
        name: "proseTextContent includes non-hidden code block text",
        blocks: [
          "Hello",
          { code: "callout content", language: "json-callout" },
          "World",
        ] as BlockDef[],
        expectedProseText: "Hello\ncallout content\nWorld",
      },
      {
        name: "proseTextContent includes code block without language",
        blocks: ["Hello", { code: "plain code" }, "World"] as BlockDef[],
        expectedProseText: "Hello\nplain code\nWorld",
      },
    ]

    it.each(cases)("$name", ({ blocks, expectedProseText }) => {
      const doc = createDoc(blocks)
      expect(proseTextContent(doc)).toBe(expectedProseText)
    })

    const offsetCases: {
      name: string
      blocks: BlockDef[]
      expectedProseText: string
      offset: number
      expectedResolved: string
    }[] = [
      {
        name: "textOffsetToPos skips hidden block and maps to correct paragraph",
        blocks: [{ code: '{"annotations": []}', language: "json-attributes" }, "Target text"],
        expectedProseText: "Target text",
        offset: 0,
        expectedResolved: "Target",
      },
      {
        name: "offset after hidden block maps to second paragraph",
        blocks: ["Before", { code: "code content", language: "json-attributes" }, "After"],
        expectedProseText: "Before\nAfter",
        offset: "Before\n".length,
        expectedResolved: "After",
      },
    ]

    it.each(offsetCases)("$name", ({ blocks, expectedProseText, offset, expectedResolved }) => {
      const doc = createDoc(blocks)
      expect(proseTextContent(doc)).toBe(expectedProseText)
      const pos = textOffsetToPos(doc, offset)
      expect(doc.textBetween(pos, pos + expectedResolved.length)).toBe(expectedResolved)
    })
  })
})
