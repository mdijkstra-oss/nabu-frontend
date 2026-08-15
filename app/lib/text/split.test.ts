import { describe, it, expect, vi, afterEach } from "vitest"
import {
  splitBySentences,
  splitMarkdownBySentences,
  splitByLines,
  splitByParagraphs,
} from "./split"
import { neutralizeMarkdown, MARK_SENTINEL } from "./mark"
import { readCorpus } from "./fixtures/corpus"

const corpus = readCorpus()

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

describe("splitMarkdownBySentences — constructs the segmenter must not see", () => {
  const split = splitMarkdownBySentences()
  const textsOf = (input: string): string[] => split(input).map((s) => s.text)

  it("a link with a dotted URL stays one sentence", () => {
    expect(textsOf("See [the report](https://ex.com/a.b.c) next.")).toEqual([
      "See [the report](https://ex.com/a.b.c) next.",
    ])
  })

  it("a numbered list yields one sentence per item, markers intact", () => {
    expect(textsOf("1. First item.\n2. Second item.\n3. Third item.")).toEqual([
      "1. First item.",
      "2. Second item.",
      "3. Third item.",
    ])
  })

  it("a table drops its separator row and its outer pipes", () => {
    const texts = textsOf(
      "| Field | Meaning |\n| :--- | :--- |\n| alpha | Holds the count. |\n| beta | Holds the name. |"
    )

    expect(texts.some((t) => t.includes(":---"))).toBe(false)
    for (const text of texts) {
      expect(text.startsWith("|")).toBe(false)
      expect(text.endsWith("|")).toBe(false)
    }
    expect(texts.some((t) => t.includes("Holds the count."))).toBe(true)
  })

  it("a bullet list and a heading keep their markers", () => {
    expect(textsOf("# Title\n\n- Item one.\n- Item two.")).toEqual([
      "# Title",
      "- Item one.",
      "- Item two.",
    ])
  })
})

describe("splitMarkdownBySentences — recovering markup the trim would eat", () => {
  const split = splitMarkdownBySentences()

  it("a sentence from an opening bracket to a closing bold runs edge to edge", () => {
    const input = "[The report](https://ex.com/a) calls the result **entirely clear**."
    const rows = split(input)

    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe(input)
    expect(rows[0].start).toBe(0)
    expect(rows[0].end).toBe(input.length)
  })

  it("expansion never reaches into the next row", () => {
    const input = "It was **entirely clear**. [The report](https://ex.com/a) says so."
    const rows = split(input)

    expect(rows).toHaveLength(2)
    expect(rows[0].text).toBe("It was **entirely clear**.")
    expect(rows[1].text).toBe("[The report](https://ex.com/a) says so.")
    expect(rows[0].end).toBeLessThanOrEqual(rows[1].start)
  })
})

describe("splitMarkdownBySentences — the plain path", () => {
  it("text with no markdown splits exactly as the plain splitter does", () => {
    const input = "Hello world. How are you? I am fine!\n\nAnd a second paragraph."
    expect(splitMarkdownBySentences()(input)).toEqual(splitBySentences()(input))
  })
})

describe("splitMarkdownBySentences — the segmenter seam", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("never hands the segmenter a string containing the sentinel", () => {
    const segmented: string[] = []
    const segment = Intl.Segmenter.prototype.segment
    vi.spyOn(Intl.Segmenter.prototype, "segment").mockImplementation(function (
      this: Intl.Segmenter,
      input: string
    ) {
      segmented.push(input)
      return segment.call(this, input)
    })

    const split = splitMarkdownBySentences()
    for (const { raw } of corpus) split(raw)
    split(`markup **here** and a stray ${MARK_SENTINEL} there.`)

    expect(segmented.length).toBeGreaterThan(0)
    for (const input of segmented) expect(input).not.toContain(MARK_SENTINEL)
  })
})

describe("splitBySentences — dutch parliamentary transcript (Rutte)", () => {
  const rutte = `RUTTE
Wat je nu ziet is natuurlijk dat het virus zich nog uitbreidt, het aantal besmettingen. En denkbaar is dat ook mensen besmet zijn die we niet in beeld hebben nog. Dat kunnen ook huisgenoten zijn die niet getest zijn, omdat ze in dit moment in isolatie of quarantaine zijn bij hun partner. Op dit moment staat de teller op 804. En wat ik vooral wil benadrukken hier: hoe treurig we denk ik allemaal zijn en hoezeer we meeleven met ook de nabestaanden van de vijf mensen die vandaag moesten worden bericht ook zijn overleden sinds de vorige rapportage van gisteren, waarbij in totaal dus nu 10 corona patiënten zijn overleden. Dat zijn de aantallen. Dan is het zo dat wij op basis van de crisisorganisatie dagelijks kijken naar hoe zich dit ontwikkelt en zodra de deskundigen een aanleiding vinden om te zeggen: nu moet de dosis worden opgevoerd, de dosis medicijn, dan kan ik verzekeren dan liggen alle maatregelen klaar om dat ook te doen. Dat was wat we gisteren gedaan hebben vanwege de... het gaat niet alleen om de aantallen waar naar je kijkt, maar je moet ook kijken: hoe ontwikkelt het zich in Brabant, waar we in feite niet meer in de indamfase zitten, maar in de volgende fase. Je ziet ook een paar ontwikkelingen, wat ik gisteren ook in de Kamer geschetst, Jaap van Dissel, RIVM, heeft dat verteld. Een paar andere plekken waarvan je zegt 'dat roept extra bezorgdheid op' over die situatie. Aanleiding voor het OMT om dit uitgebreide pakket maatregelen te nemen.`

  const langCases: { name: string; lang: string }[] = [
    { name: "english segmenter", lang: "en" },
    { name: "dutch segmenter", lang: "nl" },
  ]

  it.each(langCases)("$name — colons do not break sentence boundaries", ({ lang }) => {
    const split = splitBySentences(lang)
    const texts = split(rutte).map((s) => s.text)

    expect(texts).toContain(
      "En wat ik vooral wil benadrukken hier: hoe treurig we denk ik allemaal zijn en hoezeer we meeleven met ook de nabestaanden van de vijf mensen die vandaag moesten worden bericht ook zijn overleden sinds de vorige rapportage van gisteren, waarbij in totaal dus nu 10 corona patiënten zijn overleden."
    )
    expect(texts).toContain(
      "Dan is het zo dat wij op basis van de crisisorganisatie dagelijks kijken naar hoe zich dit ontwikkelt en zodra de deskundigen een aanleiding vinden om te zeggen: nu moet de dosis worden opgevoerd, de dosis medicijn, dan kan ik verzekeren dan liggen alle maatregelen klaar om dat ook te doen."
    )
    expect(texts).toContain("Dat zijn de aantallen.")
  })

  it.each(langCases)("$name — offset correctness", ({ lang }) => {
    const split = splitBySentences(lang)
    for (const s of split(rutte)) {
      expect(rutte.slice(s.start, s.end)).toBe(s.text)
    }
  })

  it.each(langCases)("$name — no partial sentence starts or ends", ({ lang }) => {
    const split = splitBySentences(lang)
    const texts = split(rutte).map((s) => s.text)
    for (const t of texts) {
      expect(t.endsWith("dan kan")).toBe(false)
      expect(t.startsWith("totaal dus nu")).toBe(false)
    }
  })

  it("produces 12 sentences", () => {
    const split = splitBySentences()
    expect(split(rutte).map((s) => s.text)).toEqual([
      "RUTTE",
      "Wat je nu ziet is natuurlijk dat het virus zich nog uitbreidt, het aantal besmettingen.",
      "En denkbaar is dat ook mensen besmet zijn die we niet in beeld hebben nog.",
      "Dat kunnen ook huisgenoten zijn die niet getest zijn, omdat ze in dit moment in isolatie of quarantaine zijn bij hun partner.",
      "Op dit moment staat de teller op 804.",
      "En wat ik vooral wil benadrukken hier: hoe treurig we denk ik allemaal zijn en hoezeer we meeleven met ook de nabestaanden van de vijf mensen die vandaag moesten worden bericht ook zijn overleden sinds de vorige rapportage van gisteren, waarbij in totaal dus nu 10 corona patiënten zijn overleden.",
      "Dat zijn de aantallen.",
      "Dan is het zo dat wij op basis van de crisisorganisatie dagelijks kijken naar hoe zich dit ontwikkelt en zodra de deskundigen een aanleiding vinden om te zeggen: nu moet de dosis worden opgevoerd, de dosis medicijn, dan kan ik verzekeren dan liggen alle maatregelen klaar om dat ook te doen.",
      "Dat was wat we gisteren gedaan hebben vanwege de... het gaat niet alleen om de aantallen waar naar je kijkt, maar je moet ook kijken: hoe ontwikkelt het zich in Brabant, waar we in feite niet meer in de indamfase zitten, maar in de volgende fase.",
      "Je ziet ook een paar ontwikkelingen, wat ik gisteren ook in de Kamer geschetst, Jaap van Dissel, RIVM, heeft dat verteld.",
      "Een paar andere plekken waarvan je zegt 'dat roept extra bezorgdheid op' over die situatie.",
      "Aanleiding voor het OMT om dit uitgebreide pakket maatregelen te nemen.",
    ])
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

describe("splitMarkdownBySentences — markup meeting across a sentence boundary", () => {
  const split = splitMarkdownBySentences()

  it("leaves the next sentence its own opening bracket", () => {
    const rows = split("It was **clear**.[The report](https://ex.com/a) says so.")
    expect(rows.map((r) => r.text)).toEqual([
      "It was **clear**.",
      "[The report](https://ex.com/a) says so.",
    ])
  })

  // Two runs of markup meeting with nothing between them cannot be divided by position
  // alone, and the row that opens takes them. The rows still tile the document, which is
  // the property everything downstream indexes against; the report warns about the rest.
  it("keeps rows tiling the document when two runs of markup meet", () => {
    const input = "**A one.****B two.**"
    const rows = split(input)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].end).toBeLessThanOrEqual(rows[i].start)
    }
    expect(rows.map((r) => r.text).join("")).toBe(input)
  })
})

describe("splitMarkdownBySentences — a table with unpadded cells", () => {
  const split = splitMarkdownBySentences()

  it("its content rows carry no leading or trailing pipe", () => {
    const table = "| Field | Meaning |\n|---|---|\n|alpha|Holds the count.|"
    for (const { text } of split(table)) {
      expect(text.startsWith("|"), text).toBe(false)
      expect(text.endsWith("|"), text).toBe(false)
    }
  })
})

describe("splitMarkdownBySentences — periods that do not end a sentence", () => {
  const split = splitMarkdownBySentences()
  const textsOf = (input: string): string[] => split(input).map((s) => s.text)

  const cases: { name: string; input: string; expected: string[] }[] = [
    {
      name: "a title and an initial",
      input: "Dr. J. Doe reported a metallic taste. The case closed on 02/09.",
      expected: ["Dr. J. Doe reported a metallic taste.", "The case closed on 02/09."],
    },
    {
      name: "an initial alone",
      input: "F. Hanley complained about brown water. Closed 05/09.",
      expected: ["F. Hanley complained about brown water.", "Closed 05/09."],
    },
    {
      name: "a title before a surname",
      input: "Mrs. Okafor seconded the motion. Carried.",
      expected: ["Mrs. Okafor seconded the motion.", "Carried."],
    },
    {
      name: "a run of initials",
      input: "J. R. R. Tolkien wrote it.",
      expected: ["J. R. R. Tolkien wrote it."],
    },
    {
      name: "a dotted abbreviation",
      input: "The U.S. team arrived. It was late.",
      expected: ["The U.S. team arrived.", "It was late."],
    },
    {
      name: "a surname ending a sentence still ends it",
      input: "He spoke to Bell. She replied.",
      expected: ["He spoke to Bell.", "She replied."],
    },
    {
      name: "a capitalised word after a full stop still opens a sentence",
      input: "She went to the shop. Doe arrived.",
      expected: ["She went to the shop.", "Doe arrived."],
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(textsOf(input)).toEqual(expected)
  })

  it("keeps a title's period when it falls at the end of a block", () => {
    expect(textsOf("Seconded by Dr.\n\nCarried.")).toEqual(["Seconded by Dr.", "Carried."])
  })
})
