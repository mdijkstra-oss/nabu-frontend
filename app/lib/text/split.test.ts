import { describe, it, expect } from "vitest"
import {
  splitBySentences,
  splitMarkdownBySentences,
  neutralizeMarkdown,
  splitByLines,
  splitByParagraphs,
} from "./split"

describe("splitBySentences", () => {
  const split = splitBySentences()

  const cases: { name: string; input: string; expected: string[] }[] = [
    {
      name: "simple prose",
      input: "Hello world. How are you? I am fine!",
      expected: ["Hello world.", "How are you?", "I am fine!"],
    },
    {
      name: "single sentence",
      input: "Just one sentence here.",
      expected: ["Just one sentence here."],
    },
    {
      name: "empty input",
      input: "",
      expected: [],
    },
    {
      name: "whitespace only",
      input: "   \n  ",
      expected: [],
    },
    {
      name: "multi-paragraph",
      input: "First paragraph. Second sentence.\n\nThird sentence.",
      expected: ["First paragraph.", "Second sentence.", "Third sentence."],
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    const segments = split(input)
    expect(segments.map((s) => s.text)).toEqual(expected)
  })

  it("offset correctness: text.slice(s.start, s.end) === s.text", () => {
    const input = "Hello world. How are you? I am fine!"
    const segments = split(input)
    for (const s of segments) {
      expect(input.slice(s.start, s.end)).toBe(s.text)
    }
  })

  it("offsets are correct for multi-paragraph input", () => {
    const input = "First. Second.\n\nThird."
    const segments = split(input)
    for (const s of segments) {
      expect(input.slice(s.start, s.end)).toBe(s.text)
    }
  })

  it("dutch press conference markdown", () => {
    const input = `# Letterlijke tekst persconferentie ministers Wiebes, Hoekstra en Koolmees over economische maatregelen coronavirus

Mediatekst | 17-03-2020

Het kabinet heeft besloten om vanwege het coronavirus [uitzonderlijke economische maatregelen](/actueel/nieuws/2020/03/17/coronavirus-kabinet-neemt-pakket-nieuwe-maatregelen-voor-banen-en-economie) te nemen. De ministers Wiebes (EZK), Hoekstra (Financiën) en minister Koolmees (SZW) hebben tijdens een persconferentie een toelichting gegeven op de economische maatregelen. Bekijk de [hele persconferentie via YouTube](https://www.youtube.com/watch?v=KuXj3c1F8WY).

**Let op. De datum van deze tekst is 17 maart 2020. Het kan zijn dat er ondertussen nieuwe maatregelen zijn afgekondigd. U vindt hier een overzicht van alle nieuwsberichten.**

WIEBES
Geachte aanwezigen en ook beste ondernemers die meekijken. In deze coronacrisis is volksgezondheid de eerste zorg. Daarom hebben we heel vergaande maatregelen genomen om de verspreiding van het virus te beheersen. Maar die hebben een grote impact op de economie. En in allerlei sectoren valt de omzet helemaal stil en als gevolg daarvan hebben ook andere sectoren in onze economie te lijden. En onze inzet is om de economische gevolgen te beperken en primair te zorgen dat mensen hun baan behouden. Hun inkomen behouden en dat de bedrijvigheid overeind blijft. En om dat vertrouwen te geven hebben wij de afgelopen week gewerkt aan een omvangrijk noodpakket voor banen en economie. Initieel ter overbrugging van de eerstkomende drie maanden. En voor dat pakket trekken we vele miljarden euro's uit.`

    const segments = split(input)
    expect(segments.length).toBeGreaterThan(0)

    for (const s of segments) {
      expect(input.slice(s.start, s.end)).toBe(s.text)
    }
  })
})

describe("neutralizeMarkdown", () => {
  const exactCases: { name: string; input: string; expected: string }[] = [
    { name: "bold", input: "**bold text**", expected: "  bold text  " },
    { name: "italic asterisk", input: "*italic*", expected: " italic " },
    { name: "italic underscore", input: "_italic_", expected: " italic " },
    { name: "strikethrough", input: "~~removed~~", expected: "  removed  " },
    { name: "heading", input: "## Heading text", expected: "   Heading text" },
    { name: "plain text unchanged", input: "just plain text.", expected: "just plain text." },
  ]

  it.each(exactCases)("$name", ({ input, expected }) => {
    const result = neutralizeMarkdown(input)
    expect(result).toBe(expected)
    expect(result.length).toBe(input.length)
  })

  it("neutralizes link syntax, preserves link text", () => {
    const input = "[click here](https://example.com/page?q=1)"
    const result = neutralizeMarkdown(input)
    expect(result.length).toBe(input.length)
    expect(result).toContain("click here")
    expect(result).not.toMatch(/[[\]()]/)
    expect(result).not.toContain("?")
  })

  it("neutralizes image link syntax, preserves alt text", () => {
    const input = "![alt text](image.png)"
    const result = neutralizeMarkdown(input)
    expect(result.length).toBe(input.length)
    expect(result).toContain("alt text")
    expect(result).not.toMatch(/[![\]()]/)
  })
})

describe("splitMarkdownBySentences", () => {
  const split = splitMarkdownBySentences("nl")

  it("dutch press conference with markdown links and bold", () => {
    const input = `# Letterlijke tekst persconferentie ministers Wiebes, Hoekstra en Koolmees over economische maatregelen coronavirus

Mediatekst | 17-03-2020

Het kabinet heeft besloten om vanwege het coronavirus [uitzonderlijke economische maatregelen](/actueel/nieuws/2020/03/17/coronavirus-kabinet-neemt-pakket-nieuwe-maatregelen-voor-banen-en-economie) te nemen. De ministers Wiebes (EZK), Hoekstra (Financiën) en minister Koolmees (SZW) hebben tijdens een persconferentie een toelichting gegeven op de economische maatregelen. Bekijk de [hele persconferentie via YouTube](https://www.youtube.com/watch?v=KuXj3c1F8WY).

**Let op. De datum van deze tekst is 17 maart 2020. Het kan zijn dat er ondertussen nieuwe maatregelen zijn afgekondigd. U vindt hier een overzicht van alle nieuwsberichten.**

WIEBES
Geachte aanwezigen en ook beste ondernemers die meekijken. In deze coronacrisis is volksgezondheid de eerste zorg. Daarom hebben we heel vergaande maatregelen genomen om de verspreiding van het virus te beheersen. Maar die hebben een grote impact op de economie. En in allerlei sectoren valt de omzet helemaal stil en als gevolg daarvan hebben ook andere sectoren in onze economie te lijden. En onze inzet is om de economische gevolgen te beperken en primair te zorgen dat mensen hun baan behouden. Hun inkomen behouden en dat de bedrijvigheid overeind blijft. En om dat vertrouwen te geven hebben wij de afgelopen week gewerkt aan een omvangrijk noodpakket voor banen en economie. Initieel ter overbrugging van de eerstkomende drie maanden. En voor dat pakket trekken we vele miljarden euro's uit.`

    const segments = split(input)
    const texts = segments.map((s) => s.text)

    const hasOrphanedStars = texts.some((t) => t.trim() === "**")
    expect(hasOrphanedStars).toBe(false)

    const youtubeSegments = texts.filter((t) => t.includes("YouTube") || t.includes("KuXj3c1F8WY"))
    expect(youtubeSegments).toHaveLength(1)
    expect(youtubeSegments[0]).toContain("YouTube")
    expect(youtubeSegments[0]).toContain("KuXj3c1F8WY")

    for (const s of segments) {
      expect(input.slice(s.start, s.end)).toBe(s.text)
    }
  })
})

describe("splitByLines", () => {
  const cases: { name: string; input: string; expected: string[] }[] = [
    {
      name: "multiple lines",
      input: "line one\nline two\nline three",
      expected: ["line one", "line two", "line three"],
    },
    {
      name: "single line",
      input: "just one",
      expected: ["just one"],
    },
    {
      name: "empty lines preserved",
      input: "a\n\nb",
      expected: ["a", "", "b"],
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(splitByLines(input).map((s) => s.text)).toEqual(expected)
  })

  it("offset correctness", () => {
    const input = "line one\nline two\nline three"
    for (const s of splitByLines(input)) {
      expect(input.slice(s.start, s.end)).toBe(s.text)
    }
  })
})

describe("splitByParagraphs", () => {
  const cases: { name: string; input: string; expected: string[] }[] = [
    {
      name: "two paragraphs",
      input: "paragraph one\n\nparagraph two",
      expected: ["paragraph one", "paragraph two"],
    },
    {
      name: "triple newline",
      input: "a\n\n\nb",
      expected: ["a", "b"],
    },
    {
      name: "filters empty segments",
      input: "\n\ncontent\n\n",
      expected: ["content"],
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(splitByParagraphs(input).map((s) => s.text)).toEqual(expected)
  })

  it("offset correctness", () => {
    const input = "paragraph one\n\nparagraph two"
    for (const s of splitByParagraphs(input)) {
      expect(input.slice(s.start, s.end)).toBe(s.text)
    }
  })
})
