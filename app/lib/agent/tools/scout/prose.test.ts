import { describe, expect, it } from "vitest"
import { block } from "~/lib/data-blocks/test-helpers"
import type { ScoutSection } from "../scout-map"
import { presentContent, extractLines, formatScoutMap, formatSection } from "./prose"

const section = (overrides: Partial<ScoutSection>): ScoutSection => ({
  label: "s",
  start_line: 1,
  end_line: 1,
  ...overrides,
})

describe("presentContent", () => {
  interface Case {
    name: string
    input: string
    expected: string
  }

  const cases: Case[] = [
    {
      name: "no codeblocks — identity",
      input: "one\ntwo\nthree",
      expected: "one\ntwo\nthree",
    },
    {
      name: "non-singleton block shows embedded marker",
      input: `intro\n${block("json-callout", '{"id":"c1","title":"Week 1"}')}\noutro`,
      expected: `intro\n[embedded callout: "Week 1"]\noutro`,
    },
    {
      name: "chart block with nested label",
      input: `head\n${block("json-chart", '{"id":"ch1","caption":{"label":"Growth"}}')}`,
      expected: `head\n[embedded chart: "Growth"]`,
    },
    {
      name: "chart block without label",
      input: `head\n${block("json-chart", '{"id":"ch1"}')}`,
      expected: "head\n[embedded chart]",
    },
    {
      name: "unknown block type uses raw language",
      input: `intro\n${block("bash", 'echo "hi"')}\noutro`,
      expected: "intro\n[embedded bash]\noutro",
    },
    {
      name: "singleton block stripped entirely",
      input: `intro\n${block("json-attributes", '{"type":"t","subject":"s"}')}\noutro`,
      expected: "intro\noutro",
    },
    {
      name: "annotations singleton stripped",
      input: `intro\n${block("json-annotations", '[{"id":"a1","text":"note"}]')}\noutro`,
      expected: "intro\noutro",
    },
    {
      name: "settings singleton stripped",
      input: `intro\n${block("json-settings", '{"tags":[]}')}\noutro`,
      expected: "intro\noutro",
    },
    {
      name: "mixed: singleton stripped, non-singleton gets marker",
      input: `a\n${block("json-attributes", '{"type":"t"}')}\nmiddle\n${block("json-callout", '{"id":"c1","title":"Note"}')}\nz`,
      expected: `a\nmiddle\n[embedded callout: "Note"]\nz`,
    },
  ]

  it.each(cases)("$name", (c) => {
    expect(presentContent(c.input)).toBe(c.expected)
  })
})

describe("extractLines", () => {
  interface Case {
    name: string
    content: string
    startLine: number
    endLine: number
    expected: string
  }

  const cases: Case[] = [
    {
      name: "single line",
      content: "a\nb\nc\nd",
      startLine: 2,
      endLine: 2,
      expected: "b",
    },
    {
      name: "range",
      content: "a\nb\nc\nd\ne",
      startLine: 2,
      endLine: 4,
      expected: "b\nc\nd",
    },
    {
      name: "full file",
      content: "a\nb\nc",
      startLine: 1,
      endLine: 3,
      expected: "a\nb\nc",
    },
  ]

  it.each(cases)("$name", (c) => {
    expect(extractLines(c.content, c.startLine, c.endLine)).toBe(c.expected)
  })
})

describe("formatScoutMap", () => {
  it("renders sections with desc", () => {
    const map = {
      sections: [
        section({
          label: "Opening",
          start_line: 1,
          end_line: 10,
          desc: "intro",
        }),
      ],
    }
    expect(formatScoutMap("f.md", map)).toBe(`File: f.md\n\n[1-10] Opening\n  intro`)
  })

  it("omits desc when undefined", () => {
    const map = {
      sections: [section({ label: "A", start_line: 1, end_line: 2 })],
    }
    expect(formatScoutMap("f.md", map)).toBe(`File: f.md\n\n[1-2] A`)
  })

  it("renders multiple sections separated by blank line", () => {
    const map = {
      sections: [
        section({ label: "A", start_line: 1, end_line: 5 }),
        section({ label: "B", start_line: 6, end_line: 15 }),
      ],
    }
    expect(formatScoutMap("f.md", map)).toBe(
      [`File: f.md`, ``, `[1-5] A`, ``, `[6-15] B`].join("\n")
    )
  })
})

describe("formatSection", () => {
  interface Case {
    name: string
    section: ScoutSection
    expected: string
  }

  const cases: Case[] = [
    {
      name: "with desc",
      section: section({
        label: "Intro",
        start_line: 1,
        end_line: 10,
        desc: "opening",
      }),
      expected: "[1-10] Intro\n  opening",
    },
    {
      name: "without desc",
      section: section({ label: "Intro", start_line: 1, end_line: 10 }),
      expected: "[1-10] Intro",
    },
  ]

  it.each(cases)("$name", (c) => {
    expect(formatSection(c.section)).toBe(c.expected)
  })
})
