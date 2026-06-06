import { describe, it, expect } from "vitest"
import { trimAroundMatches } from "./trim-around"

const SEP = "\n\n<!--SPLIT-->\n\n"

const doc = [
  "# Introduction",
  "The project started in 2019 with a small team of researchers who wanted to understand how people process complex information.",
  "Over the next two years the team grew and the scope expanded significantly beyond the original vision.",
  "By 2021 the project had attracted funding from several major institutions.",
  "# Methods",
  "We conducted interviews with 40 participants across three different cities.",
  "Each interview lasted approximately 90 minutes and was recorded with consent.",
  "The recordings were transcribed and coded using a grounded theory approach.",
  "# Results",
  "Short finding.",
  "# Discussion",
  "The results suggest that information processing is deeply contextual and cannot be separated from the social environment in which it occurs.",
].join("\n\n")

const longParagraph = (count: number): string =>
  Array.from({ length: count }, (_, i) => `Sentence number ${i} has some words in it.`).join(" ")

describe("trimAroundMatches", () => {
  const cases: {
    name: string
    text: string
    matches: string[]
    check: (result: string) => void
  }[] = [
    {
      name: "no matches → returns original",
      text: doc,
      matches: [],
      check: (r) => expect(r).toBe(doc),
    },
    {
      name: "match not found → returns empty so caller can fall back",
      text: doc,
      matches: ["this text does not exist anywhere in the document at all"],
      check: (r) => expect(r).toBe(""),
    },
    {
      name: "empty text → returns empty",
      text: "",
      matches: ["anything"],
      check: (r) => expect(r).toBe(""),
    },
    {
      name: "match in middle → trims distant content",
      text: doc,
      matches: ["conducted interviews with 40 participants"],
      check: (r) => {
        expect(r).toContain("We conducted interviews")
        expect(r).not.toContain("# Introduction")
      },
    },
    {
      name: "short match → gets context from budget",
      text: doc,
      matches: ["Short finding."],
      check: (r) => {
        expect(r).toContain("Short finding.")
        expect(r).not.toContain("project started in 2019")
      },
    },
    {
      name: "two nearby matches → merged into one region",
      text: doc,
      matches: ["conducted interviews with 40 participants", "recordings were transcribed"],
      check: (r) => {
        expect(r).not.toContain(SEP)
        expect(r).toContain("We conducted interviews")
        expect(r).toContain("transcribed and coded")
      },
    },
    {
      name: "two distant matches → two regions with separator",
      text: doc,
      matches: ["project started in 2019", "information processing is deeply contextual"],
      check: (r) => {
        const parts = r.split(SEP)
        expect(parts.length).toBe(2)
        expect(parts[0]).toContain("project started in 2019")
        expect(parts[1]).toContain("information processing is deeply contextual")
      },
    },
    {
      name: "all content matched → returns full text",
      text: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.",
      matches: ["First paragraph.", "Second paragraph.", "Third paragraph."],
      check: (r) => expect(r).toBe("First paragraph.\n\nSecond paragraph.\n\nThird paragraph."),
    },
    {
      name: "single sentence text → no trimming possible",
      text: "Just a single sentence with some words.",
      matches: ["single sentence"],
      check: (r) => expect(r).toBe("Just a single sentence with some words."),
    },
    {
      name: "small match between large neighbors → context is budget-capped",
      text: `${longParagraph(20)}\n\nThe key insight was trust.\n\n${longParagraph(20)}`,
      matches: ["The key insight was trust."],
      check: (r) => {
        expect(r).toContain("The key insight was trust.")
        expect(r).toContain("…")
        const words = r.split(/\s+/).filter(Boolean)
        expect(words.length).toBeLessThan(100)
      },
    },
    {
      name: "truncated before-context shows tail words closest to match",
      text: `${longParagraph(20)}\n\nThe key insight was trust.\n\nShort after.`,
      matches: ["The key insight was trust."],
      check: (r) => {
        expect(r).toContain("The key insight was trust.")
        expect(r).toContain("Short after.")
        expect(r.startsWith("…")).toBe(true)
      },
    },
    {
      name: "truncated after-context shows head words closest to match",
      text: `Short before.\n\nThe key insight was trust.\n\n${longParagraph(20)}`,
      matches: ["The key insight was trust."],
      check: (r) => {
        expect(r).toContain("The key insight was trust.")
        expect(r).toContain("Short before.")
        expect(r).toContain("…")
        expect(r).not.toContain("Sentence number 19")
      },
    },
    {
      name: "adjacent matches merge via gap budget",
      text: "Before.\n\nMatch one.\n\nSmall gap.\n\nMatch two.\n\nAfter.",
      matches: ["Match one.", "Match two."],
      check: (r) => {
        expect(r).not.toContain(SEP)
        expect(r).toContain("Match one.")
        expect(r).toContain("Small gap.")
        expect(r).toContain("Match two.")
      },
    },
    {
      name: "preserves paragraph breaks in output",
      text: "Context before.\n\nThe match sentence.\n\nContext after.",
      matches: ["The match sentence."],
      check: (r) => {
        expect(r).toContain("Context before.\n\nThe match sentence.\n\nContext after.")
      },
    },
    {
      name: "multiple small context sentences all fit within budget",
      text: "A.\n\nB.\n\nC.\n\nMatch.\n\nD.\n\nE.\n\nF.",
      matches: ["Match."],
      check: (r) => {
        expect(r).toContain("Match.")
        expect(r).toContain("A.")
        expect(r).toContain("F.")
        expect(r).not.toContain("…")
      },
    },
    {
      name: "real-world: match at tail of long paragraph in multi-paragraph text",
      text: [
        "de besmettingen weer helemaal zijn teruggedrongen tot een beheersbaar niveau, dan kun je vanaf dat moment, kun je weer de routekaart gaan doorlopen en kun je weer naar een regionale aanpak toe.\nUses the routekaart as the formal pathway for moving back toward regionalized policy once conditions improve.",
        "Uiteindelijk is het natuurlijk zo dat Outbreak Management Team adviseert: wat zijn nou maatregelen die je denkbaar kunt nemen om het virus onder controle te krijgen? En die hebben eerder al gezegd: het doet iets\nUses the OMT as an explicit expert warrant for the claim that masks have some effect and are a thinkable control measure.",
        "laten we nou die knoop doorhakken met elkaar en van dat dringend advies naar die verplichting gaan.\nCommits to converting the mask advice into an obligation.",
        "Dat is juridisch lastig, dus dat kan niet onmiddellijk maar we gaan het proberen zo snel mogelijk te regelen.\nLeaves implementation timing open because the legal route is still uncertain.",
      ].join("\n\n"),
      matches: [
        "En die hebben eerder al gezegd: het doet iets\nUses the OMT as an explicit expert warrant for the claim that masks have some effect and are a thinkable control measure.",
      ],
      check: (r) => {
        expect(r).toContain("het doet iets")
        expect(r).toContain("OMT as an explicit expert warrant")
      },
    },
    {
      name: "match with newlines in match text → normalizes and locates",
      text: "Alpha bravo.\n\nBravo charlie.\n\nDelta echo.",
      matches: ["Bravo charlie."],
      check: (r) => {
        expect(r).toContain("Bravo charlie.")
      },
    },
  ]

  it.each(cases)("$name", ({ text, matches, check }) => {
    check(trimAroundMatches(text, matches))
  })
})
