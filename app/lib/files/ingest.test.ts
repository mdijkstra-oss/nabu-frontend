import { describe, it, expect } from "vitest"
import { ingestFile } from "./ingest"
import { FileCorruptionError } from "./errors"
import { validateStructural } from "~/lib/data-blocks/validate"
import { EPOCH, ISO, UNDATEABLE_EPOCH, settingsWith, CORRUPT } from "./ingest.fixtures"

describe("ingestFile against a store-contract write", () => {
  const cases = [
    {
      name: "old-schema content is migrated before the write",
      content: settingsWith(EPOCH),
      result: { ok: true, migrated: true },
      stored: settingsWith(ISO),
    },
    {
      name: "already-migrated content passes through byte-identical, not migrated",
      content: settingsWith(ISO),
      result: { ok: true, migrated: false },
      stored: settingsWith(ISO),
    },
    {
      name: "corrupt content maps the store throw to a rejection and is never stored",
      content: CORRUPT,
      result: { ok: false, errors: [expect.objectContaining({ block: "json-settings" })] },
      stored: undefined,
    },
    {
      name: "content that crashes a migration is rejected, never stored, and never throws",
      content: settingsWith(UNDATEABLE_EPOCH),
      result: { ok: false, errors: [expect.objectContaining({ block: "migration" })] },
      stored: undefined,
    },
    {
      name: "a matching old-schema block whose rewrite changes nothing reports not migrated",
      content: [settingsWith(ISO), settingsWith(EPOCH)].join("\n"),
      result: { ok: true, migrated: false },
      stored: [settingsWith(ISO), settingsWith(EPOCH)].join("\n"),
    },
  ]

  it.each(cases)("$name", ({ content, result, stored }) => {
    let written: string | undefined
    const writeToFakeStore = (path: string, raw: string): void => {
      const errors = validateStructural(raw)
      if (errors.length > 0) throw new FileCorruptionError(path, errors)
      written = raw
    }

    expect(ingestFile("note.md", content, writeToFakeStore)).toEqual(result)
    expect(written).toEqual(stored)
  })

  it("rethrows a non-corruption error from the write", () => {
    const boom = new Error("boom")
    const failingWrite = (): void => {
      throw boom
    }

    expect(() => ingestFile("note.md", settingsWith(ISO), failingWrite)).toThrow(boom)
  })
})
