import { describe, it, expect } from "vitest"
import type { LabeledTarget, SectionMatch } from "./format"
import { formatLabeledTarget, formatTargetFile, toSectionMatches, buildAutoSteps } from "./format"

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
        { path: "a.md", label: "A1", ranges: [{ startLine: 1, endLine: 10 }] },
        {
          path: "b.md",
          label: "B1",
          ranges: [
            { startLine: 5, endLine: 12 },
            { startLine: 20, endLine: 30 },
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
    { path: "a.md", label: "Intro", ranges: [{ startLine: 1, endLine: 10 }] },
    {
      path: "b.md",
      label: "Methods",
      ranges: [
        { startLine: 5, endLine: 15 },
        { startLine: 25, endLine: 35 },
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
      check: (steps: ReturnType<typeof buildAutoSteps>) => {
        expect(steps).toHaveLength(3)
        expect(steps.map((s) => s.title)).toEqual(["Intro", "Methods", "Synthesis"])
      },
    },
    {
      name: "single-range section emits one section in array",
      postAction: "annotate_as_code",
      check: (steps: ReturnType<typeof buildAutoSteps>) => {
        expect(steps[0].expected).toContain(
          `apply_deep_analysis(sections=[{path: "a.md", start_line: 1, end_line: 10}], source_files=${sourceArg}, post_action="annotate_as_code")`
        )
      },
    },
    {
      name: "multi-range section emits multiple sections in array",
      postAction: "annotate_as_code",
      check: (steps: ReturnType<typeof buildAutoSteps>) => {
        expect(steps[1].expected).toContain(
          `apply_deep_analysis(sections=[{path: "b.md", start_line: 5, end_line: 15}, {path: "b.md", start_line: 25, end_line: 35}], source_files=${sourceArg}, post_action="annotate_as_code")`
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
