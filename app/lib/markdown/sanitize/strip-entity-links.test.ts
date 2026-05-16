import { describe, test, expect } from "vitest"
import { stripEntityLinks } from "./strip-entity-links"

interface Case {
  name: string
  input: string
  expected: string
}

describe("stripEntityLinks", () => {
  const cases: Case[] = [
    {
      name: "strips link when text is only an entity ID",
      input: "[annotation-7hd8kqka](file://2020-03-13_ministerraad.md/some%20path)",
      expected: "annotation-7hd8kqka",
    },
    {
      name: "strips link when text is only a callout ID",
      input: "[callout-7xk2m9p1](http://example.com)",
      expected: "callout-7xk2m9p1",
    },
    {
      name: "strips link when text is only a .md filename",
      input: "[interview-notes.md](file://interview-notes.md)",
      expected: "interview-notes.md",
    },
    {
      name: "strips ID from text but keeps the link when text has both",
      input: "[review flag annotation-7hd8kqka](file://some-url)",
      expected: "[review flag](file://some-url)",
    },
    {
      name: "strips ID from text preserving surrounding words",
      input: "[the annotation-7hd8kqka thing](http://example.com)",
      expected: "[the thing](http://example.com)",
    },
    {
      name: "leaves link unchanged when text has no entity ID",
      input: "[click here](http://example.com)",
      expected: "[click here](http://example.com)",
    },
    {
      name: "handles multiple links in one string",
      input: "See [callout-7xk2m9p1](url1) and [note callout-4a1b2c3d](url2)",
      expected: "See callout-7xk2m9p1 and [note](url2)",
    },
    {
      name: "leaves plain text untouched",
      input: "no links here at all",
      expected: "no links here at all",
    },
    {
      name: "handles capitalized prefix in link text",
      input: "[Annotation-7hd8kqka](file://some-url)",
      expected: "Annotation-7hd8kqka",
    },
  ]

  test.each(cases)("$name", ({ input, expected }) => {
    expect(stripEntityLinks(input)).toBe(expected)
  })
})
