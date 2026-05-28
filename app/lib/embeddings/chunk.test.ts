import { describe, it, expect } from "vitest"
import { chunkText, type Chunk } from "./chunk"
import { TARGET_CHUNK_SIZE, MIN_CHUNK_SIZE, CHUNK_OVERLAP_RATIO } from "./constants"

describe("chunkText", () => {
  const cases: { name: string; input: string; check: (chunks: Chunk[]) => void }[] = [
    {
      name: "empty text returns no chunks",
      input: "",
      check: (chunks) => expect(chunks).toEqual([]),
    },
    {
      name: "whitespace only returns no chunks",
      input: "   \n\n   ",
      check: (chunks) => expect(chunks).toEqual([]),
    },
    {
      name: "short text stays as one chunk",
      input: "Hello world. This is a test.",
      check: (chunks) => {
        expect(chunks).toHaveLength(1)
        expect(chunks[0].text).toBe("Hello world. This is a test.")
        expect(chunks[0].index).toBe(0)
      },
    },
    {
      name: "heading prepends to next segment",
      input: "# Title\n\nContent below heading",
      check: (chunks) => {
        expect(chunks).toHaveLength(1)
        expect(chunks[0].text).toContain("# Title")
        expect(chunks[0].text).toContain("Content below heading")
      },
    },
    {
      name: "multiple paragraphs merge when small",
      input: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.",
      check: (chunks) => {
        expect(chunks).toHaveLength(1)
        expect(chunks[0].text).toContain("First paragraph.")
        expect(chunks[0].text).toContain("Third paragraph.")
      },
    },
    {
      name: "large text splits into multiple chunks",
      input: Array.from({ length: 20 }, (_, i) => `Paragraph ${i}. ${"x".repeat(200)}`).join(
        "\n\n"
      ),
      check: (chunks) => {
        expect(chunks.length).toBeGreaterThan(1)
        chunks.forEach((chunk) => {
          const maxWithOverlap = TARGET_CHUNK_SIZE * (1 + CHUNK_OVERLAP_RATIO) + 200
          expect(chunk.text.length).toBeLessThanOrEqual(maxWithOverlap)
        })
      },
    },
    {
      name: "chunks have sequential indices",
      input: Array.from({ length: 20 }, (_, i) => `Paragraph ${i}. ${"x".repeat(200)}`).join(
        "\n\n"
      ),
      check: (chunks) => {
        chunks.forEach((chunk, i) => {
          expect(chunk.index).toBe(i)
        })
      },
    },
    {
      name: "chunks have deterministic hashes",
      input: "Hello world.\n\nAnother paragraph.",
      check: (chunks) => {
        const second = chunkText("Hello world.\n\nAnother paragraph.")
        expect(chunks.map((c) => c.hash)).toEqual(second.map((c) => c.hash))
      },
    },
    {
      name: "small trailing chunks merge with previous",
      input: `${"x".repeat(MIN_CHUNK_SIZE + 100)}\n\nTiny`,
      check: (chunks) => {
        expect(chunks).toHaveLength(1)
      },
    },
    {
      name: "second chunk contains trailing sentence from first chunk",
      input: Array.from({ length: 20 }, (_, i) => `Paragraph ${i}. ${"x".repeat(200)}`).join(
        "\n\n"
      ),
      check: (chunks) => {
        if (chunks.length < 2) return
        const firstText = chunks[0].text
        const lastSentenceMatch = firstText.match(/Paragraph \d+\. x+$/)
        expect(lastSentenceMatch).not.toBeNull()
        if (lastSentenceMatch) expect(chunks[1].text).toContain(lastSentenceMatch[0])
      },
    },
    {
      name: "first chunk has no overlap prefix",
      input: Array.from({ length: 20 }, (_, i) => `Paragraph ${i}. ${"x".repeat(200)}`).join(
        "\n\n"
      ),
      check: (chunks) => {
        expect(chunks[0].text).toMatch(/^Paragraph 0/)
      },
    },
    {
      name: "no chunk is below MIN_CHUNK_SIZE except when total text is small",
      input: Array.from({ length: 30 }, (_, i) => `Segment ${i}. ${"y".repeat(500)}`).join("\n\n"),
      check: (chunks) => {
        if (chunks.length <= 1) return
        chunks.forEach((chunk) => {
          expect(chunk.text.length).toBeGreaterThanOrEqual(MIN_CHUNK_SIZE)
        })
      },
    },
    {
      name: "oversized paragraph splits at sentence boundaries, not word boundaries",
      input: [
        "Nou ja goed, laat ik bij de feiten blijven.",
        "Er is in Europa volgens mij totale overeenstemming over de maatregelen die zijn genomen.",
        "Dat is een versoepeling van het stabiliteits- en groeipact, dat is het inzetten van Europese begrotingsinstrumenten.",
        "Dat is echt een heel, de ECB, de Europese Centrale Bank heeft natuurlijk een heel pakket aan maatregelen genomen waarmee ook de oplopende rentes in Zuid-Europa weer naar beneden zijn geduwd.",
        "Daar zitten natuurlijk wel grenzen aan, aan dat soort ECB-pakketten.",
        "Dat is niet allemaal zonder risico.",
        "Maar je ziet wel de positieve effecten van hun werk.",
        "En dan blijven er twee discussies over.",
        "De ene discussie is over Eurobonds, dus een vergemeenschappelijking van schulden in Europa.",
        "Dat past niet in de Euro, in het Euro-systeem vinden landen als Duitsland, Nederland en nog een heel rijtje landen.",
        "Dus ik denk dat die er ook niet gaan komen.",
        "Tweede discussie gaat over de inzet van het Europese noodscherm, het ESM.",
        "Dat is er.",
        "Als landen daar een beroep op zouden doen kan dat.",
        "Ik zeg er alleen steeds twee dingen bij: doe het niet te snel want zoveel kaarten hebben we ook niet in de mauw nu we alle instrumenten al hebben ingezet.",
        "En dit kan nog even duren.",
        "En ten tweede, wat je dan wil afspreken met elkaar is dat als een land daar een beroep op doet dat zo'n land ook benoemt hoe het ervoor gaat zorgen, dat mocht er weer een crisis ontstaan, zo'n land het langer zelf kan omgaan met die crisis.",
        "Kijk naar Nederland, wij hebben natuurlijk in de afgelopen tien jaar ontzettend moeilijke maatregelen genomen.",
        "In ieder geval tussen 2008 en 2014/15/16.",
        "We zijn uit die crisis gekomen en kunnen nu, we hebben een appeltje voor de dorst.",
        "We kunnen nu hele forse leningen uitzetten op de kapitaalmarkt om onze economie te steunen.",
        "Dat wens ik ook andere landen toe.",
        "Dat als ze dan gebruik maken van dat noodscherm, dat ze dan ook afspraken maken: hoe gaan wij ervoor zorgen dat mocht er weer een crisis zijn, economisch of gezondheids-technisch of iets anders, dat zij ook in staat zijn om daarmee om te gaan.",
      ].join(" "),
      check: (chunks) => {
        expect(chunks.length).toBeGreaterThan(1)
        for (const chunk of chunks) {
          expect(chunk.text).not.toMatch(/^land daar een beroep/)
          const afterOverlap = chunk.text.includes("\n\n")
            ? chunk.text.slice(chunk.text.indexOf("\n\n") + 2)
            : chunk.text
          expect(afterOverlap).not.toMatch(/^land daar een beroep/)
        }
      },
    },
  ]

  it.each(cases)("$name", ({ input, check }) => check(chunkText(input)))
})
