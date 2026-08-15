import { describe, it, expect, vi, beforeEach } from "vitest"
import { getBlock } from "~/lib/data-blocks/query"
import { getProjections, toJsonSchema } from "~/domain/db/projections"
import { jsonSchemaToTableProjection } from "~/lib/db/ddl"
import { extractRows } from "~/lib/db/extract"
import { normalizeAsStored, updateFileRaw, setFiles, getFileRaw } from "~/lib/files/store"
import { FileCorruptionError } from "~/lib/files/errors"
import { contentHash } from "~/domain/data-blocks/attributes/topics/selectors"
import { indexFileSentences } from "~/lib/text/halo"
import { getSingletonLanguages } from "~/lib/data-blocks/registry"
import { RegionsBlockSchema, type RegionRow } from "./schema"

const LANGUAGE = "json-regions"

const PROSE = [
  "Rutte opened the meeting.",
  "He said the budget was settled.",
  "Then Kaag disagreed.",
  "She wanted another week.",
].join(" ")

const block = (body: unknown): string => "```json-regions\n" + JSON.stringify(body) + "\n```"

const document = (body: unknown): string => `${PROSE}\n\n${block(body)}\n`

const person = (overrides: Partial<RegionRow> = {}): Record<string, unknown> => ({
  kind: "person",
  parsed: { type: "string", value: "rutte" },
  quote: "Rutte",
  hitSentence: 0,
  startSentence: 0,
  endSentence: 1,
  rangeHash: "abcd1234abcd1234",
  ...overrides,
})

const read = (raw: string) => getBlock(raw, LANGUAGE, RegionsBlockSchema)

const regionsProjection = () => {
  const projection = getProjections().find((p) => p.language === LANGUAGE)
  if (!projection) throw new Error("json-regions is not projected")
  return projection
}

const regionsTable = () =>
  jsonSchemaToTableProjection("regions", toJsonSchema(regionsProjection())).schemas

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

describe("reading a stored block", () => {
  it("keeps a whole block when one entry is missing parsed", () => {
    const parsed = read(
      document({ regions: [person(), { ...person(), parsed: undefined }], scanned: {} })
    )
    expect(parsed?.regions).toHaveLength(1)
    expect(console.warn).toHaveBeenCalled()
  })

  it("returns null for JSON truncated mid-array, contributing no rows", () => {
    const raw = PROSE + '\n\n```json-regions\n{"regions": [{"kind": "person"\n```\n'
    expect(read(raw)).toBeNull()
  })

  it("refuses the same content at the file store, naming the file", () => {
    setFiles({ "notes.md": PROSE })
    const raw = PROSE + '\n\n```json-regions\n{"regions": [{"kind": "person"\n```\n'
    expect(() => updateFileRaw("notes.md", raw)).toThrow(FileCorruptionError)
    expect(() => updateFileRaw("notes.md", raw)).toThrow(/notes\.md/)
  })

  it("carries every scanned entry through unchanged", () => {
    const scanned = {
      person: [
        { hash: "aaaa1111aaaa1111", firstSentence: 0 },
        { hash: "bbbb2222bbbb2222", firstSentence: 2 },
      ],
      date: [{ hash: "cccc3333cccc3333", firstSentence: 0 }],
    }
    const parsed = read(document({ regions: [person(), { kind: "person" }], scanned }))
    expect(parsed?.scanned).toEqual(scanned)
    expect(parsed?.regions).toHaveLength(1)
  })

  it.each([
    ["a kind no longer in the registry", person({ kind: "weather" } as Partial<RegionRow>)],
    ["a range triple with a missing hash", { ...person(), rangeHash: undefined }],
    ["an end before its start", person({ startSentence: 3, endSentence: 1 })],
  ])("drops %s and keeps its siblings", (_case, bad) => {
    const parsed = read(document({ regions: [person(), bad], scanned: {} }))
    expect(parsed?.regions).toHaveLength(1)
  })

  it("yields no rows for a document of nothing but unregistered kinds, and does not throw", () => {
    const parsed = read(
      document({ regions: [person({ kind: "weather" } as Partial<RegionRow>)], scanned: {} })
    )
    expect(parsed?.regions).toEqual([])
  })

  it("accepts indexes past the end of the document, because staleness is not invalidity", () => {
    const stale = person({ startSentence: 90, endSentence: 99, hitSentence: 90 })
    expect(read(document({ regions: [stale], scanned: {} }))?.regions).toHaveLength(1)
  })

  it("accepts a hit with no range at all", () => {
    const unresolved = {
      kind: "person",
      parsed: { type: "string", value: "kaag" },
      quote: "Kaag",
      hitSentence: 2,
    }
    const parsed = read(document({ regions: [unresolved], scanned: {} }))
    expect(parsed?.regions[0]).toMatchObject({ hitSentence: 2 })
    expect(parsed?.regions[0].startSentence).toBeUndefined()
  })

  it("indexes from zero against the real sentence array", () => {
    const raw = document({ regions: [person()], scanned: {} })
    const parsed = read(raw)
    expect(parsed?.regions[0].startSentence).toBe(0)
    expect(indexFileSentences(raw)[0].text).toBe("Rutte opened the meeting.")
  })

  it("projects two documents holding identical blocks under their own files", () => {
    const body = { regions: [person()], scanned: {} }
    const first = read(document(body))
    const second = read(`Other prose entirely.\n\n${block(body)}\n`)
    const schema = toJsonSchema(regionsProjection())
    const rowsOf = (parsed: typeof first, file: string) =>
      extractRows("regions", schema, parsed?.regions[0], file)[0].rows[0]
    expect(rowsOf(first, "one.md").file).toBe("one.md")
    expect(rowsOf(second, "two.md").file).toBe("two.md")
    expect(first?.regions).toEqual(second?.regions)
  })
})

describe("the derived table", () => {
  const OWNED: [string, string][] = [
    ["file", "VARCHAR"],
    ["kind", "VARCHAR"],
    ["parsed_type", "VARCHAR"],
    ["parsed_value", "VARCHAR"],
    ["quote", "VARCHAR"],
    ["hit_sentence", "INTEGER"],
    ["start_sentence", "INTEGER"],
    ["end_sentence", "INTEGER"],
    ["range_hash", "VARCHAR"],
  ]

  it("is named regions with no tableName override", () => {
    expect(regionsProjection().tableName).toBe("regions")
  })

  it.each(OWNED)("carries %s as %s", (name, type) => {
    const columns = regionsTable()[0].columns
    expect(columns).toContainEqual({ name, type, nullable: name !== "file" })
  })

  it("produces no child table, so scanned reaches no table of its own", () => {
    expect(regionsTable().map((t) => t.name)).toEqual(["regions"])
  })

  it("flattens parsed rather than giving it a column", () => {
    expect(regionsTable()[0].columns.map((c) => c.name)).not.toContain("parsed")
  })

  it("extracts a row under its own file", () => {
    const [rows] = extractRows("regions", toJsonSchema(regionsProjection()), person(), "notes.md")
    expect(rows.rows[0]).toMatchObject({
      file: "notes.md",
      kind: "person",
      parsed_value: "rutte",
      start_sentence: 0,
      end_sentence: 1,
    })
  })

  it("writes null columns for a hit with no range", () => {
    const unresolved = {
      kind: "person",
      parsed: { type: "string", value: "kaag" },
      quote: "Kaag",
      hitSentence: 2,
    }
    const [rows] = extractRows("regions", toJsonSchema(regionsProjection()), unresolved, "notes.md")
    expect(rows.rows[0]).toMatchObject({
      start_sentence: null,
      end_sentence: null,
      range_hash: null,
    })
  })
})

describe("round-tripping through the file store", () => {
  const raw = document({
    regions: [person()],
    scanned: { person: [{ hash: "aaaa1111aaaa1111", firstSentence: 0 }] },
  })

  it("is byte-identical on a second normalization", () => {
    const once = normalizeAsStored(raw)
    expect(normalizeAsStored(once)).toBe(once)
  })

  it("relocates the block into the singleton tail in registry order", () => {
    const withPrefix = `${block({ regions: [], scanned: {} })}\n\n${PROSE}\n`
    const normalized = normalizeAsStored(withPrefix)
    expect(normalized.indexOf(PROSE)).toBeLessThan(normalized.indexOf("```json-regions"))
    expect(getSingletonLanguages()).toContain(LANGUAGE)
  })

  it("leaves the document's topic content hash where it was before the block existed", () => {
    expect(contentHash(normalizeAsStored(raw))).toBe(contentHash(normalizeAsStored(`${PROSE}\n`)))
  })

  it("does not shift a single sentence index", () => {
    expect(indexFileSentences(raw)).toEqual(indexFileSentences(`${PROSE}\n`))
  })

  it("survives a store write and reads back", () => {
    setFiles({ "notes.md": PROSE })
    updateFileRaw("notes.md", raw)
    expect(read(getFileRaw("notes.md"))?.regions).toHaveLength(1)
  })
})
