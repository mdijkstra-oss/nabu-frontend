import { describe, it, expect, afterEach } from "vitest"
import { setFiles, updateFileRaw, getFileRaw, renameFile, normalizeAsStored } from "./store"
import { FileCorruptionError } from "./errors"

const reset = () => setFiles({})

describe("updateFileRaw structural floor", () => {
  afterEach(reset)

  const validMd = '# Title\n\n```json-attributes\n{"tags": []}\n```\n'
  const unbalancedFence = '```json-attributes\n{"tags": []}\n'
  const unterminatedString = '```json-callout\n{"x": "abc\n```\n'
  const malformedObject = '```json-callout\n{"x":\n```\n'
  const validCompanion = '```json-embeddings\n{"hash":"h","text":"t","embedding":[0.1]}\n```\n'

  describe("rejects corrupted .md content", () => {
    const cases = [
      { name: "unbalanced fence", raw: unbalancedFence },
      { name: "unterminated JSON string", raw: unterminatedString },
      { name: "malformed JSON object", raw: malformedObject },
    ]

    it.each(cases)("$name throws FileCorruptionError", ({ raw }) => {
      expect(() => updateFileRaw("doc.md", raw)).toThrow(FileCorruptionError)
    })

    it("does not mutate store on rejection", () => {
      expect(() => updateFileRaw("doc.md", unbalancedFence)).toThrow()
      expect(getFileRaw("doc.md")).toBe("")
    })

    it("FileCorruptionError carries path and structured errors", () => {
      try {
        updateFileRaw("doc.md", unbalancedFence)
        expect.fail("should have thrown")
      } catch (e) {
        expect(e).toBeInstanceOf(FileCorruptionError)
        const err = e as FileCorruptionError
        expect(err.path).toBe("doc.md")
        expect(err.errors.length).toBeGreaterThan(0)
      }
    })
  })

  describe("accepts valid content", () => {
    it("stores valid markdown", () => {
      updateFileRaw("doc.md", validMd)
      expect(getFileRaw("doc.md")).toContain('"tags"')
    })

    it("stores companion file regardless of fence balance", () => {
      const companion = "doc.embeddings.hidden.md"
      updateFileRaw(companion, validCompanion)
      expect(getFileRaw(companion)).toContain("json-embeddings")
    })

    it("skips structural check for companion suffix", () => {
      const companion = "weird.embeddings.hidden.md"
      expect(() => updateFileRaw(companion, "not even close to valid\n")).not.toThrow()
    })

    it("skips structural check for non-md files", () => {
      expect(() => updateFileRaw("data.txt", "```\nbroken")).not.toThrow()
    })
  })

  describe("idempotent on identical content", () => {
    it("does not re-throw on second identical write", () => {
      updateFileRaw("doc.md", validMd)
      expect(() => updateFileRaw("doc.md", validMd)).not.toThrow()
    })
  })
})

// The editor emits normalizeAsStored(markdown) and remembers it as the expected
// echo; the scheme only holds if the store's write path cannot change it further.
describe("normalizeAsStored", () => {
  afterEach(reset)

  const serialized = "* parent\n    * child\n- dash item\n"

  it("matches what updateFileRaw stores", () => {
    updateFileRaw("doc.md", serialized)
    expect(normalizeAsStored(serialized)).toBe(getFileRaw("doc.md"))
  })

  it("tabifies remark's space-indented nesting", () => {
    expect(normalizeAsStored(serialized)).toBe("* parent\n\t\t* child\n* dash item\n")
  })

  it("is idempotent", () => {
    const once = normalizeAsStored(serialized)
    expect(normalizeAsStored(once)).toBe(once)
  })
})

describe("renameFile", () => {
  afterEach(reset)

  const companionMd = '```json-embeddings\n{"hash":"h","text":"t","embedding":[0.1]}\n```\n'

  it("carries the embeddings companion along", () => {
    setFiles({
      "doc.md": "# Doc\n",
      "doc.embeddings.hidden.md": companionMd,
      "other.md": "# Other\n",
    })
    renameFile("doc.md", "note.md")
    expect(getFileRaw("doc.md")).toBe("")
    expect(getFileRaw("note.md")).toContain("# Doc")
    expect(getFileRaw("doc.embeddings.hidden.md")).toBe("")
    expect(getFileRaw("note.embeddings.hidden.md")).toContain("json-embeddings")
  })

  it("renames plainly when no companion exists", () => {
    setFiles({ "doc.md": "# Doc\n" })
    renameFile("doc.md", "note.md")
    expect(getFileRaw("note.md")).toContain("# Doc")
    expect(getFileRaw("note.embeddings.hidden.md")).toBe("")
  })
})
