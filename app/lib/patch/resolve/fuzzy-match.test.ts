import { describe, it, expect } from "vitest"
import { resolveFuzzyPatterns, hasFuzzyPatterns } from "./fuzzy-match"

const INTERVIEW_DOC = `# Interview with participant P12

## Background

The participant has been working in healthcare for over fifteen years. She described her early career
as challenging but rewarding, noting that the organizational culture at her first hospital was
particularly supportive. She mentioned that mentorship programs were critical to her development.

## Key Findings

When asked about current challenges, she expressed significant concerns about staffing levels and
burnout among her colleagues. She felt that management was not adequately addressing the workload
issues, saying "we are constantly running on empty and nobody seems to care." She also highlighted
the lack of professional development opportunities compared to her earlier career.

## Technology Adoption

The participant was generally positive about new electronic health record systems but raised concerns
about the training process. She noted that older colleagues struggled significantly with the
transition and that the implementation timeline was unrealistic given the complexity of the system.`

describe("resolveFuzzyPatterns", () => {
  interface TestCase {
    name: string
    patch: string
    target: string
    expectedPatch: string
    expectedResolved: number
    expectedUnresolved: string[]
  }

  const cases: TestCase[] = [
    {
      name: "exact match replaces",
      patch: '{ "text": "FUZZY[[hello world]]" }',
      target: "This is hello world in a document.",
      expectedPatch: '{ "text": "hello world" }',
      expectedResolved: 1,
      expectedUnresolved: [],
    },
    {
      name: "short needle below min words is unresolved",
      patch: '{ "text": "FUZZY[[hello worlld]]" }',
      target: "This is hello world in a document.",
      expectedPatch: '{ "text": "FUZZY[[hello worlld]]" }',
      expectedResolved: 0,
      expectedUnresolved: ["hello worlld"],
    },
    {
      name: "multiple patterns",
      patch: '{ "a": "FUZZY[[first text]]", "b": "FUZZY[[second text]]" }',
      target: "Here is the first text and also second text present.",
      expectedPatch: '{ "a": "first text", "b": "second text" }',
      expectedResolved: 2,
      expectedUnresolved: [],
    },
    {
      name: "no match returns unresolved",
      patch: '{ "text": "FUZZY[[not in document at all]]" }',
      target: "This content has nothing matching whatsoever really.",
      expectedPatch: '{ "text": "FUZZY[[not in document at all]]" }',
      expectedResolved: 0,
      expectedUnresolved: ["not in document at all"],
    },
    {
      name: "no patterns unchanged",
      patch: '{ "text": "regular text" }',
      target: "Any content here.",
      expectedPatch: '{ "text": "regular text" }',
      expectedResolved: 0,
      expectedUnresolved: [],
    },
    {
      name: "exact match handles newlines as spaces",
      patch:
        '{ "text": "FUZZY[[the organizational culture at her first hospital was particularly supportive]]" }',
      target: INTERVIEW_DOC,
      expectedPatch:
        '{ "text": "the organizational culture at her first hospital was\nparticularly supportive." }',
      expectedResolved: 1,
      expectedUnresolved: [],
    },
    {
      name: "fuzzy token match with one wrong word in longer phrase",
      patch:
        '{ "text": "FUZZY[[felt that management was not adequately addressing the workload concerns]]" }',
      target: INTERVIEW_DOC,
      expectedPatch:
        '{ "text": "She felt that management was not adequately addressing the workload" }',
      expectedResolved: 1,
      expectedUnresolved: [],
    },
    {
      name: "fuzzy token match with dropped word in needle",
      patch:
        '{ "text": "FUZZY[[expressed concerns about staffing levels and burnout among her colleagues]]" }',
      target: INTERVIEW_DOC,
      expectedPatch:
        '{ "text": "expressed significant concerns about staffing levels and\nburnout among her" }',
      expectedResolved: 1,
      expectedUnresolved: [],
    },
    {
      name: "exact substring match in large doc preserves case",
      patch: '{ "text": "FUZZY[[mentorship programs were critical to her development]]" }',
      target: INTERVIEW_DOC,
      expectedPatch: '{ "text": "mentorship programs were critical to her development." }',
      expectedResolved: 1,
      expectedUnresolved: [],
    },
    {
      name: "exact substring match is case-insensitive",
      patch: '{ "text": "FUZZY[[KEY FINDINGS]]" }',
      target: INTERVIEW_DOC,
      expectedPatch: '{ "text": "Key Findings" }',
      expectedResolved: 1,
      expectedUnresolved: [],
    },
    {
      name: "short needle unique fuzzy match with punctuation gap",
      patch: '{ "text": "FUZZY[[said hello]]" }',
      target: "The participant said: hello and then paused.",
      expectedPatch: '{ "text": "said: hello" }',
      expectedResolved: 1,
      expectedUnresolved: [],
    },
    {
      name: "short needle ambiguous fuzzy match resolves first ordered occurrence",
      patch: '{ "text": "FUZZY[[said hello]]" }',
      target: "She said: hello and he said: hello again.",
      expectedPatch: '{ "text": "said: hello" }',
      expectedResolved: 1,
      expectedUnresolved: [],
    },
    {
      name: "three-word needle unique fuzzy match",
      patch: '{ "text": "FUZZY[[said hello everyone]]" }',
      target: "The participant said: hello, everyone! How are you?",
      expectedPatch: '{ "text": "said: hello, everyone!" }',
      expectedResolved: 1,
      expectedUnresolved: [],
    },
    {
      name: "needle containing square brackets resolves",
      patch:
        '{ "text": "FUZZY[[We gaan in die week daarvoor [onverstaanbaar, red] kijken: hoe zit het?]]" }',
      target: "We gaan in die week daarvoor [onverstaanbaar, red] kijken: hoe zit het?",
      expectedPatch:
        '{ "text": "We gaan in die week daarvoor [onverstaanbaar, red] kijken: hoe zit het?" }',
      expectedResolved: 1,
      expectedUnresolved: [],
    },
  ]

  it.each(cases)(
    "$name",
    ({ patch, target, expectedPatch, expectedResolved, expectedUnresolved }) => {
      const result = resolveFuzzyPatterns(patch, target)
      expect(result.patch).toBe(expectedPatch)
      expect(result.resolved).toBe(expectedResolved)
      expect(result.unresolved).toEqual(expectedUnresolved)
    }
  )
})

describe("hasFuzzyPatterns", () => {
  interface TestCase {
    name: string
    content: string
    expected: boolean
  }

  const cases: TestCase[] = [
    { name: "with pattern", content: "FUZZY[[text]]", expected: true },
    { name: "without pattern", content: "regular text", expected: false },
    { name: "similar but not pattern", content: "FUZZY text", expected: false },
    { name: "with brackets in text", content: "FUZZY[[text [ed] here]]", expected: true },
    { name: "unclosed prefix", content: "FUZZY[[broken", expected: true },
  ]

  it.each(cases)("$name", ({ content, expected }) => {
    expect(hasFuzzyPatterns(content)).toBe(expected)
  })
})
