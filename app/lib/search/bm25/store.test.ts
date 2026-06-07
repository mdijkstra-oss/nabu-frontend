import { beforeEach, describe, expect, it } from "vitest"
import {
  queryBm25,
  replaceFile,
  removeFile,
  removeFileFromAllLanguages,
  resetBm25,
  languageStats,
  type Bm25Doc,
} from "./store"

const buildDoc = (overrides: Partial<Bm25Doc> = {}): Bm25Doc => ({
  id: "h1",
  file: "doc.md",
  text: "the quick brown fox jumps over the lazy dog",
  chunkStart: 0,
  chunkEnd: 43,
  language: "eng",
  ...overrides,
})

describe("bm25 store", () => {
  beforeEach(() => resetBm25())

  describe("replaceFile + queryBm25", () => {
    it("returns hits matching query terms", () => {
      replaceFile("eng", "doc.md", [buildDoc()])
      const hits = queryBm25("eng", "fox", 10)
      expect(hits).toHaveLength(1)
      expect(hits[0].file).toBe("doc.md")
      expect(hits[0].chunkStart).toBe(0)
      expect(hits[0].score).toBeGreaterThan(0)
    })

    it("returns empty for missing language", () => {
      replaceFile("eng", "doc.md", [buildDoc()])
      expect(queryBm25("nld", "fox", 10)).toEqual([])
    })

    it("returns empty for empty query", () => {
      replaceFile("eng", "doc.md", [buildDoc()])
      expect(queryBm25("eng", "   ", 10)).toEqual([])
    })

    it("respects limit", () => {
      const docs = Array.from({ length: 5 }, (_, i) =>
        buildDoc({ id: `h${i}`, text: `fox term-${i} unique-${i}`, chunkStart: i * 100 })
      )
      replaceFile("eng", "doc.md", docs)
      const hits = queryBm25("eng", "fox", 3)
      expect(hits).toHaveLength(3)
    })
  })

  describe("replaceFile incremental updates", () => {
    it("removes old docs when file is replaced", () => {
      replaceFile("eng", "doc.md", [buildDoc({ id: "old", text: "vintage typewriter" })])
      expect(queryBm25("eng", "typewriter", 10)).toHaveLength(1)

      replaceFile("eng", "doc.md", [buildDoc({ id: "new", text: "shiny laptop" })])
      expect(queryBm25("eng", "typewriter", 10)).toHaveLength(0)
      expect(queryBm25("eng", "laptop", 10)).toHaveLength(1)
    })

    it("keeps docs from other files when one file replaced", () => {
      replaceFile("eng", "a.md", [buildDoc({ id: "a1", file: "a.md", text: "alpha sandals" })])
      replaceFile("eng", "b.md", [buildDoc({ id: "b1", file: "b.md", text: "beta sandals" })])

      replaceFile("eng", "a.md", [buildDoc({ id: "a2", file: "a.md", text: "alpha boots" })])

      const sandalsHits = queryBm25("eng", "sandals", 10)
      expect(sandalsHits.map((h) => h.file)).toEqual(["b.md"])
    })

    it("clears file when replaced with empty docs", () => {
      replaceFile("eng", "doc.md", [buildDoc()])
      replaceFile("eng", "doc.md", [])
      expect(queryBm25("eng", "fox", 10)).toHaveLength(0)
    })
  })

  describe("removeFile + removeFileFromAllLanguages", () => {
    const cases = [
      {
        name: "removeFile drops docs from that language only",
        setup: () => {
          replaceFile("eng", "doc.md", [buildDoc({ id: "e1", text: "english fox" })])
          replaceFile("nld", "doc.md", [
            buildDoc({ id: "n1", text: "nederlandse vos", language: "nld" }),
          ])
          removeFile("eng", "doc.md")
        },
        expect: () => {
          expect(queryBm25("eng", "fox", 10)).toHaveLength(0)
          expect(queryBm25("nld", "vos", 10)).toHaveLength(1)
        },
      },
      {
        name: "removeFileFromAllLanguages drops across languages",
        setup: () => {
          replaceFile("eng", "doc.md", [buildDoc({ id: "e1", text: "english fox" })])
          replaceFile("nld", "doc.md", [
            buildDoc({ id: "n1", text: "nederlandse vos", language: "nld" }),
          ])
          removeFileFromAllLanguages("doc.md")
        },
        expect: () => {
          expect(queryBm25("eng", "fox", 10)).toHaveLength(0)
          expect(queryBm25("nld", "vos", 10)).toHaveLength(0)
        },
      },
    ]

    it.each(cases)("$name", ({ setup, expect: assertResult }) => {
      setup()
      assertResult()
    })
  })

  describe("candidates filter", () => {
    it("only returns docs whose id is in candidates set", () => {
      replaceFile("eng", "a.md", [
        buildDoc({ id: "a1", file: "a.md", text: "fox sandals" }),
        buildDoc({ id: "a2", file: "a.md", text: "fox boots" }),
      ])
      replaceFile("eng", "b.md", [buildDoc({ id: "b1", file: "b.md", text: "fox laptop" })])

      const candidates = new Set(["a1", "b1"])
      const hits = queryBm25("eng", "fox", 10, { candidates })
      expect(hits.map((h) => h.id).sort()).toEqual(["a1", "b1"])
    })

    it("returns empty when candidates set is empty", () => {
      replaceFile("eng", "a.md", [buildDoc()])
      expect(queryBm25("eng", "fox", 10, { candidates: new Set() })).toEqual([])
    })

    it("returns empty when no candidate id matches", () => {
      replaceFile("eng", "a.md", [buildDoc({ id: "a1" })])
      expect(queryBm25("eng", "fox", 10, { candidates: new Set(["nope"]) })).toEqual([])
    })
  })

  describe("languageStats", () => {
    it("tracks docs and files per language", () => {
      replaceFile("eng", "a.md", [
        buildDoc({ id: "a1", file: "a.md" }),
        buildDoc({ id: "a2", file: "a.md" }),
      ])
      replaceFile("eng", "b.md", [buildDoc({ id: "b1", file: "b.md" })])
      replaceFile("nld", "c.md", [buildDoc({ id: "c1", file: "c.md", language: "nld" })])

      const stats = languageStats()
      expect(stats.eng).toEqual({ docs: 3, files: 2 })
      expect(stats.nld).toEqual({ docs: 1, files: 1 })
    })
  })

  describe("resetBm25", () => {
    it("clears all state", () => {
      replaceFile("eng", "doc.md", [buildDoc()])
      resetBm25()
      expect(queryBm25("eng", "fox", 10)).toHaveLength(0)
      expect(languageStats()).toEqual({})
    })
  })
})
