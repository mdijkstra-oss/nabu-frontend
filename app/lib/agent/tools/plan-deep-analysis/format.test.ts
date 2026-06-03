import { describe, it, expect } from "vitest"
import type { LabeledTarget, SectionMatch, ScoredSection } from "./format"
import {
  formatLabeledTarget,
  formatTargetFile,
  toSectionMatches,
  buildAutoSteps,
  bucketSearchSections,
  sortLabeledByInputOrder,
} from "./format"

const target = (overrides: Partial<LabeledTarget> = {}): LabeledTarget => ({
  path: "file.md",
  label: "Section A",
  ranges: [{ startLine: 1, endLine: 10 }],
  ...overrides,
})

describe("formatLabeledTarget", () => {
  const cases = [
    {
      name: "single range without desc",
      input: target({ label: "Intro", ranges: [{ startLine: 1, endLine: 10 }] }),
      expected: "[1-10] Intro",
    },
    {
      name: "single range with desc",
      input: target({
        label: "Intro",
        desc: "Opening paragraphs",
        ranges: [{ startLine: 1, endLine: 10 }],
      }),
      expected: "[1-10] Intro\n  Opening paragraphs",
    },
    {
      name: "multiple ranges",
      input: target({
        label: "Methods",
        ranges: [
          { startLine: 5, endLine: 12 },
          { startLine: 20, endLine: 30 },
        ],
      }),
      expected: "[5-12, 20-30] Methods",
    },
  ]

  cases.forEach(({ name, input, expected }) => {
    it(name, () => expect(formatLabeledTarget(input)).toBe(expected))
  })
})

describe("formatTargetFile", () => {
  const cases = [
    {
      name: "single target",
      path: "a.md",
      targets: [target({ path: "a.md", label: "S1", ranges: [{ startLine: 1, endLine: 10 }] })],
      expected: "File: a.md\n\n[1-10] S1",
    },
    {
      name: "multiple targets",
      path: "a.md",
      targets: [
        target({ path: "a.md", label: "S1", ranges: [{ startLine: 1, endLine: 10 }] }),
        target({ path: "a.md", label: "S2", ranges: [{ startLine: 11, endLine: 20 }] }),
      ],
      expected: ["File: a.md", "", "[1-10] S1", "", "[11-20] S2"].join("\n"),
    },
    {
      name: "target with multiple ranges",
      path: "a.md",
      targets: [
        target({
          path: "a.md",
          label: "S1",
          ranges: [
            { startLine: 1, endLine: 5 },
            { startLine: 15, endLine: 20 },
          ],
        }),
      ],
      expected: "File: a.md\n\n[1-5, 15-20] S1",
    },
  ]

  cases.forEach(({ name, path, targets, expected }) => {
    it(name, () => expect(formatTargetFile(path, targets)).toBe(expected))
  })
})

describe("toSectionMatches", () => {
  const cases = [
    {
      name: "maps labeled targets to section matches",
      input: [
        target({ path: "a.md", label: "A1", ranges: [{ startLine: 1, endLine: 10 }] }),
        target({
          path: "b.md",
          label: "B1",
          ranges: [
            { startLine: 5, endLine: 12 },
            { startLine: 20, endLine: 30 },
          ],
        }),
      ],
      expected: [
        { label: "A1", sections: [{ path: "a.md", startLine: 1, endLine: 10 }] },
        {
          label: "B1",
          sections: [
            { path: "b.md", startLine: 5, endLine: 12 },
            { path: "b.md", startLine: 20, endLine: 30 },
          ],
        },
      ],
    },
    {
      name: "empty input returns empty",
      input: [],
      expected: [],
    },
  ]

  cases.forEach(({ name, input, expected }) => {
    it(name, () => expect(toSectionMatches(input)).toEqual(expected))
  })
})

describe("buildAutoSteps", () => {
  const matches: SectionMatch[] = [
    { label: "Intro", sections: [{ path: "a.md", startLine: 1, endLine: 10 }] },
    {
      label: "Methods",
      sections: [
        { path: "b.md", startLine: 5, endLine: 15 },
        { path: "b.md", startLine: 25, endLine: 35 },
      ],
    },
  ]
  const sources = [
    { path: "source1.md", scope: "framework" },
    { path: "source2.md", scope: "dimension" },
  ]
  const sourceArg =
    '[{path: "source1.md", scope: "framework"}, {path: "source2.md", scope: "dimension"}]'

  const cases = [
    {
      name: "one step per section plus synthesis",
      postAction: "annotate_as_code",
      interactive: false,
      check: (steps: ReturnType<typeof buildAutoSteps>) => {
        expect(steps).toHaveLength(3)
        expect(steps.map((s) => s.title)).toEqual(["Intro", "Methods", "Synthesis"])
      },
    },
    {
      name: "single-range section emits one section in array",
      postAction: "annotate_as_code",
      interactive: false,
      check: (steps: ReturnType<typeof buildAutoSteps>) => {
        expect(steps[0].expected).toContain(
          `apply_deep_analysis(sections=[{path: "a.md", start_line: 1, end_line: 10}], source_files=${sourceArg}, post_action="annotate_as_code")`
        )
      },
    },
    {
      name: "multi-range section emits multiple sections in array",
      postAction: "annotate_as_code",
      interactive: false,
      check: (steps: ReturnType<typeof buildAutoSteps>) => {
        expect(steps[1].expected).toContain(
          `apply_deep_analysis(sections=[{path: "b.md", start_line: 5, end_line: 15}, {path: "b.md", start_line: 25, end_line: 35}], source_files=${sourceArg}, post_action="annotate_as_code")`
        )
      },
    },
    {
      name: "post_action propagates",
      postAction: "return",
      interactive: false,
      check: (steps: ReturnType<typeof buildAutoSteps>) => {
        expect(steps[0].expected).toContain(`post_action="return"`)
      },
    },
    {
      name: "non-interactive: all steps have checkpoint false",
      postAction: "annotate_as_code",
      interactive: false,
      check: (steps: ReturnType<typeof buildAutoSteps>) => {
        steps.forEach((s) => expect(s.checkpoint).toBe(false))
      },
    },
    {
      name: "interactive: all steps have checkpoint true",
      postAction: "annotate_as_code",
      interactive: true,
      check: (steps: ReturnType<typeof buildAutoSteps>) => {
        steps.forEach((s) => expect(s.checkpoint).toBe(true))
      },
    },
  ]

  cases.forEach(({ name, postAction, interactive, check }) => {
    it(name, () => check(buildAutoSteps(matches, sources, postAction, interactive)))
  })
})

describe("bucketSearchSections", () => {
  const scored = (path: string, chars: number, startLine = 1, endLine = 10): ScoredSection => ({
    section: { path, startLine, endLine },
    chars,
  })

  const cases = [
    {
      name: "preserves input order in single bucket",
      input: [scored("first.md", 100), scored("second.md", 100), scored("third.md", 100)],
      check: (result: SectionMatch[]) => {
        expect(result).toHaveLength(1)
        expect(result[0].sections.map((s) => s.path)).toEqual(["first.md", "second.md", "third.md"])
      },
    },
    {
      name: "overflow creates new bucket preserving order",
      input: [scored("a.md", 25000), scored("b.md", 25000)],
      check: (result: SectionMatch[]) => {
        expect(result).toHaveLength(2)
        expect(result[0].sections[0].path).toBe("a.md")
        expect(result[1].sections[0].path).toBe("b.md")
      },
    },
    {
      name: "sections from different files interleave within budget",
      input: [scored("x.md", 5000), scored("y.md", 5000), scored("x.md", 5000, 20, 30)],
      check: (result: SectionMatch[]) => {
        expect(result).toHaveLength(1)
        expect(result[0].sections.map((s) => s.path)).toEqual(["x.md", "y.md", "x.md"])
        expect(result[0].label).toContain("2 files")
      },
    },
    {
      name: "single section produces one bucket",
      input: [scored("only.md", 500)],
      check: (result: SectionMatch[]) => {
        expect(result).toHaveLength(1)
        expect(result[0].sections[0].path).toBe("only.md")
        expect(result[0].label).toContain("1 candidates in one file")
      },
    },
    {
      name: "empty input returns empty",
      input: [],
      check: (result: SectionMatch[]) => {
        expect(result).toHaveLength(0)
      },
    },
  ]

  cases.forEach(({ name, input, check }) => {
    it(name, () => check(bucketSearchSections(input)))
  })
})

describe("sortLabeledByInputOrder", () => {
  const labeled = (path: string, startLine: number, label = "L"): LabeledTarget => ({
    path,
    label,
    ranges: [{ startLine, endLine: startLine + 10 }],
  })

  const keys = (out: LabeledTarget[]): string[] =>
    out.map((t) => `${t.path}:${t.ranges[0]?.startLine}`)

  const cases = [
    {
      name: "single file: composites sorted by startLine ascending",
      labeled: [labeled("a.md", 800), labeled("a.md", 1), labeled("a.md", 400)],
      inputPaths: ["a.md"],
      expected: ["a.md:1", "a.md:400", "a.md:800"],
    },
    {
      name: "multi-file: input order respected across files",
      labeled: [labeled("b.md", 50), labeled("a.md", 50), labeled("c.md", 50)],
      inputPaths: ["a.md", "b.md", "c.md"],
      expected: ["a.md:50", "b.md:50", "c.md:50"],
    },
    {
      name: "multi-file: within-file startLine sorted, files in input order",
      labeled: [labeled("b.md", 100), labeled("a.md", 500), labeled("b.md", 1), labeled("a.md", 1)],
      inputPaths: ["a.md", "b.md"],
      expected: ["a.md:1", "a.md:500", "b.md:1", "b.md:100"],
    },
    {
      name: "unknown path sinks to end",
      labeled: [labeled("rogue.md", 1), labeled("a.md", 100)],
      inputPaths: ["a.md"],
      expected: ["a.md:100", "rogue.md:1"],
    },
    {
      name: "empty labeled returns empty",
      labeled: [],
      inputPaths: ["a.md"],
      expected: [],
    },
    {
      name: "missing ranges treated as startLine 0",
      labeled: [{ path: "a.md", label: "x", ranges: [] }, labeled("a.md", 5)],
      inputPaths: ["a.md"],
      expected: ["a.md:undefined", "a.md:5"],
    },
  ]

  cases.forEach(({ name, labeled: input, inputPaths, expected }) => {
    it(name, () => {
      const out = sortLabeledByInputOrder(input, inputPaths)
      expect(keys(out)).toEqual(expected)
    })
  })

  it("does not mutate input", () => {
    const input = [labeled("a.md", 800), labeled("a.md", 1)]
    const snapshot = JSON.stringify(input)
    sortLabeledByInputOrder(input, ["a.md"])
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
