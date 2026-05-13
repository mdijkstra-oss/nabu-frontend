import { describe, it, expect } from "vitest"
import type { ScoutEntry } from "../scout/api"
import type { ScoutSection } from "../scout-map"
import { formatTarget, collectSections, buildAutoSteps } from "./format"

const section = (overrides: Partial<ScoutSection> = {}): ScoutSection => ({
  label: "Section A",
  start_line: 1,
  end_line: 10,
  keywords: ["topic"],
  ...overrides,
})

const mappedEntry = (sections: ScoutSection[]): ScoutEntry => ({
  kind: "mapped",
  path: "file.md",
  map: { sections },
})

const inlineEntry = (path: string): ScoutEntry => ({
  kind: "inline",
  path,
  content: "inline content",
})

describe("formatTarget", () => {
  const cases = [
    {
      name: "inline entry returns full content",
      path: "a.md",
      entry: inlineEntry("a.md"),
      expected: "File: a.md\ninline content",
    },
    {
      name: "mapped entry includes all sections",
      path: "a.md",
      entry: mappedEntry([
        section({ label: "S1", start_line: 1, end_line: 10, keywords: ["k1"] }),
        section({ label: "S2", start_line: 11, end_line: 20, keywords: ["k2"] }),
      ]),
      expected: [
        "File: a.md",
        "",
        "[1-10] S1",
        "  keywords: k1",
        "",
        "[11-20] S2",
        "  keywords: k2",
      ].join("\n"),
    },
  ]

  cases.forEach(({ name, path, entry, expected }) => {
    it(name, () => expect(formatTarget(path, entry)).toBe(expected))
  })
})

describe("collectSections", () => {
  const cases = [
    {
      name: "collects all sections across entries",
      entries: [
        {
          path: "a.md",
          entry: mappedEntry([
            section({ label: "A1", start_line: 1, end_line: 10 }),
            section({ label: "A2", start_line: 11, end_line: 20 }),
          ]),
        },
        {
          path: "b.md",
          entry: mappedEntry([section({ label: "B1", start_line: 1, end_line: 5 })]),
        },
      ],
      expected: [
        { path: "a.md", label: "A1", startLine: 1, endLine: 10 },
        { path: "a.md", label: "A2", startLine: 11, endLine: 20 },
        { path: "b.md", label: "B1", startLine: 1, endLine: 5 },
      ],
    },
    {
      name: "skips inline entries",
      entries: [
        { path: "a.md", entry: inlineEntry("a.md") },
        {
          path: "b.md",
          entry: mappedEntry([section({ label: "B1", start_line: 1, end_line: 5 })]),
        },
      ],
      expected: [{ path: "b.md", label: "B1", startLine: 1, endLine: 5 }],
    },
    {
      name: "empty entries returns empty",
      entries: [],
      expected: [],
    },
  ]

  cases.forEach(({ name, entries, expected }) => {
    it(name, () => expect(collectSections(entries)).toEqual(expected))
  })
})

describe("buildAutoSteps", () => {
  const matches = [
    { path: "a.md", label: "Intro", startLine: 1, endLine: 10 },
    { path: "b.md", label: "Methods", startLine: 5, endLine: 15 },
  ]
  const sources = [
    { path: "source1.md", scope: "framework" },
    { path: "source2.md", scope: "dimension" },
  ]
  const sourceArg =
    '[{path: "source1.md", scope: "framework"}, {path: "source2.md", scope: "dimension"}]'
  const sectionsArg =
    '[{path: "a.md", start_line: 1, end_line: 10}, {path: "b.md", start_line: 5, end_line: 15}]'

  const cases = [
    {
      name: "two steps: batch analysis + synthesis",
      postAction: "annotate_as_code",
      check: (steps: ReturnType<typeof buildAutoSteps>) => {
        expect(steps).toHaveLength(2)
        expect(steps.map((s) => s.title)).toEqual(["Intro & Methods", "Synthesis"])
      },
    },
    {
      name: "batch step contains single apply_deep_analysis with all sections",
      postAction: "annotate_as_code",
      check: (steps: ReturnType<typeof buildAutoSteps>) => {
        expect(steps[0].expected).toContain(
          `apply_deep_analysis(sections=${sectionsArg}, source_files=${sourceArg}, post_action="annotate_as_code")`
        )
      },
    },
    {
      name: "post_action propagates",
      postAction: "return",
      check: (steps: ReturnType<typeof buildAutoSteps>) => {
        expect(steps[0].expected).toContain(`post_action="return"`)
      },
    },
    {
      name: "all steps have checkpoint false",
      postAction: "annotate_as_code",
      check: (steps: ReturnType<typeof buildAutoSteps>) => {
        steps.forEach((s) => expect(s.checkpoint).toBe(false))
      },
    },
  ]

  cases.forEach(({ name, postAction, check }) => {
    it(name, () => check(buildAutoSteps(matches, sources, postAction)))
  })
})
