import { describe, it, expect } from "vitest"
import { trimAroundMatches } from "./trim-around"

const SEP = "\n\n…\n\n"

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
      name: "match in long paragraph → returns that paragraph only",
      text: doc,
      matches: ["conducted interviews with 40 participants"],
      check: (r) => {
        expect(r).toContain("We conducted interviews")
        expect(r).not.toContain("# Introduction")
        expect(r).not.toContain("# Discussion")
      },
    },
    {
      name: "match in short paragraph → expands to neighbors",
      text: doc,
      matches: ["Short finding."],
      check: (r) => {
        expect(r).toContain("Short finding.")
        expect(r).toContain("# Results")
        expect(r).toContain("# Discussion")
        expect(r).not.toContain("# Introduction")
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
      name: "all paragraphs matched → returns original",
      text: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.",
      matches: ["First paragraph.", "Second paragraph.", "Third paragraph."],
      check: (r) => expect(r).toBe("First paragraph.\n\nSecond paragraph.\n\nThird paragraph."),
    },
    {
      name: "match not found in any paragraph → returns original",
      text: doc,
      matches: ["this text does not exist anywhere"],
      check: (r) => expect(r).toBe(doc),
    },
    {
      name: "empty text → returns empty",
      text: "",
      matches: ["anything"],
      check: (r) => expect(r).toBe(""),
    },
    {
      name: "match spans across paragraph boundary via includes",
      text: "Alpha bravo.\n\nBravo charlie.\n\nDelta echo.",
      matches: ["Bravo charlie."],
      check: (r) => {
        expect(r).toContain("Bravo charlie.")
      },
    },
    {
      name: "long paragraph is capped at 120 words with ellipsis",
      text: Array.from({ length: 200 }, (_, i) => `word${i}`).join(" "),
      matches: ["word0"],
      check: (r) => {
        const words = r.split(/\s+/)
        expect(words.length).toBeLessThanOrEqual(122)
        expect(r).toContain("word0")
        expect(r).toContain("word119")
        expect(r).not.toContain("word120 ")
        expect(r.endsWith("…")).toBe(true)
      },
    },
    {
      name: "paragraph under 120 words is not capped",
      text: Array.from({ length: 50 }, (_, i) => `word${i}`).join(" "),
      matches: ["word0"],
      check: (r) => {
        expect(r).toContain("word49")
        expect(r).not.toContain("…")
      },
    },
    {
      name: "match at end of long paragraph → caps from end, prefix ellipsis",
      text: Array.from({ length: 200 }, (_, i) => `word${i}`).join(" "),
      matches: ["word190 word191 word192"],
      check: (r) => {
        expect(r).toContain("word190")
        expect(r).toContain("word199")
        expect(r.startsWith("… ")).toBe(true)
        expect(r).not.toContain("word0")
      },
    },
    {
      name: "match in middle of long paragraph → caps around match",
      text: Array.from({ length: 200 }, (_, i) => `word${i}`).join(" "),
      matches: ["word100 word101 word102"],
      check: (r) => {
        expect(r).toContain("word100")
        expect(r.startsWith("… ")).toBe(true)
        expect(r.endsWith(" …")).toBe(true)
        expect(r).not.toContain("word0")
        expect(r).not.toContain("word199")
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
        expect(r).not.toContain("routekaart")
        expect(r).not.toContain("juridisch lastig")
      },
    },
    {
      name: "real-world: short match at start of long single paragraph gets capped",
      text: "nou dit najaar zal er wel weer een opleving van corona komen. Dat hoeft dan niet meteen reden tot paniek te zijn van: o we zitten nog tot diep volgend jaar aan de mondkapjes vast?\nDE JONGE\nNee, zeker niet. Omdat ik denk dat je erbij moet zeggen dat dat maar net afhangt van wat er de komende tijd gaat gebeuren. Het eerste is namelijk: gaat het ons lukken om een zo hoog mogelijke vaccinatiegraad te bereiken? Als ons dat gaat lukken is de kans kleiner dat we inderdaad met een eventuele opleving in het najaar te maken krijgen. Als die vaccinatiegraad ook nog eens lukt om dat zo homogeen mogelijk te verspreiden over Nederland. Dan helpt dat ook om het virus eronder te houden. Als er geen mutaties komen of als we de mutaties die komen snel weten te onderdrukken, dan helpt dat ook om een opleving te kunnen voorkomen. Kortom, ons gedrag voor de komende periode, maar ook ons beleid voor de komende periode is nog steeds zeer bepalend voor hoe het najaar eruit gaat zien. En dat maakt ook, want ja dit is heel mooi dat we deze stap 3 nu versneld kunnen zetten en ja het is hartstikke mooi dat we stap 4 en 5 samen kunnen pakken zodat we de meest beperkende maatregelen hebben kunnen doen verdwijnen voor 1 juli. Maar we moeten daarmee niet denken dat de coronacrisis voorbij is, we zijn er namelijk nog niet vanaf. We zijn er bijna, zeker, maar we moeten het nog steeds met beleid blijven doen om te zorgen dat we ook in het najaar geen opleving krijgen. Dus met name vaccinatie is ongelofelijk van belang. En dat zullen we tot vervelens toe blijven herhalen, iedere dag opnieuw.",
      matches: ["Nee, zeker niet."],
      check: (r) => {
        expect(r).toContain("Nee, zeker niet.")
        const words = r.split(/\s+/).filter(Boolean)
        expect(words.length).toBeLessThanOrEqual(122)
        expect(r).toContain(" …")
        expect(r).not.toContain("iedere dag opnieuw")
      },
    },
    {
      name: "long match spanning many sentences is capped but contains match start",
      text: "nu gesloten zijn en misschien iets verlichting richting 28 april en anders hopelijk later: bereid nu wel vast voor hoe dat in jouw sector eruit zou zien. En dat gaat dus van cafés en restaurants en terrassen tot en met de strandtenten maar ook de theaters, de scholen, de musea, de recreatiesector et cetera et cetera. Dan tot slot wil ik echt voor één punt aandacht vragen en dat is dat inmiddels veertien zendmasten in Nederland in de afgelopen tijd, daar is brandgesticht. En daar heeft Ferd Grapperhaus namens het kabinet al over gezegd dat dit letterlijk, letterlijk levensgevaarlijk is en ik wil dat hier herhalen. Het is letterlijk levensgevaarlijk, omdat behalve dat wij misschien daardoor niet onze eigen telefoontjes op dat moment kunnen doen in zo'n regio waar zo'n zendmast belangrijk, veel erger nog is dat dit direct onze hulpdiensten raakt. Het raakt direct de noodoproepen en de gevolgen kunnen dus letterlijk gevolgen van leven of dood zijn. Dus ik herhaal hier de woorden van Ferd Grapperhaus: dit is letterlijk levensgevaarlijk. Dit raakt niet alleen onze iPhonetjes of wat we ook allemaal voor spullen hebben, het raakt ook gewoon onze hulpdiensten en dat is zeer ernstig, letterlijk levensgevaarlijk. De politie doet er alles aan om de daders op te sporen en ze te kunnen berechten en nogmaals, stop hiermee. Dit is echt van groot belang, dit is echt letterlijk levensgevaarlijk, al helemaal nu in een tijd waarin er zo veel druk ligt op onze hulpdiensten is dit totaal onacceptabel. Dat wou ik echt nog even ook hier naar voren brengen.",
      matches: [
        "Dan tot slot wil ik echt voor één punt aandacht vragen en dat is dat inmiddels veertien zendmasten in Nederland in de afgelopen tijd, daar is brandgesticht. En daar heeft Ferd Grapperhaus namens het kabinet al over gezegd dat dit letterlijk, letterlijk levensgevaarlijk is en ik wil dat hier herhalen. Het is letterlijk levensgevaarlijk, omdat behalve dat wij misschien daardoor niet onze eigen telefoontjes op dat moment kunnen doen in zo'n regio waar zo'n zendmast belangrijk, veel erger nog is dat dit direct onze hulpdiensten raakt. Het raakt direct de noodoproepen en de gevolgen kunnen dus letterlijk gevolgen van leven of dood zijn. Dus ik herhaal hier de woorden van Ferd Grapperhaus: dit is letterlijk levensgevaarlijk. Dit raakt niet alleen onze iPhonetjes of wat we ook allemaal voor spullen hebben, het raakt ook gewoon onze hulpdiensten en dat is zeer ernstig, letterlijk levensgevaarlijk. De politie doet er alles aan om de daders op te sporen en ze te kunnen berechten en nogmaals, stop hiermee. Dit is echt van groot belang, dit is echt letterlijk levensgevaarlijk, al helemaal nu in een tijd waarin er zo veel druk ligt op onze hulpdiensten is dit totaal onacceptabel.",
      ],
      check: (r) => {
        expect(r).toContain("veertien zendmasten")
        expect(r).toContain(" …")
        const words = r.split(/\s+/).filter(Boolean)
        expect(words.length).toBeLessThanOrEqual(122)
      },
    },
  ]

  it.each(cases)("$name", ({ text, matches, check }) => {
    check(trimAroundMatches(text, matches))
  })
})
