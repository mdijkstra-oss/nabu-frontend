import { afterEach, describe, expect, it } from "vitest"
import { openTracker, withoutIndexedDb } from "./indexed-db.fixture"
import { setCacheSkipped, tryGet, tryPut } from "./storage-cache"

describe("storage cache without a browser", () => {
  afterEach(() => {
    setCacheSkipped(false)
    withoutIndexedDb()
  })

  it("tryGet resolves undefined and opens no database while skipping", async () => {
    const opened = openTracker()
    setCacheSkipped(true)
    await expect(tryGet("llm", "k")).resolves.toBeUndefined()
    expect(opened).toEqual([])
  })

  it("tryPut resolves and opens no database while skipping", async () => {
    const opened = openTracker()
    setCacheSkipped(true)
    await expect(tryPut("llm", "k", { a: 1 })).resolves.toBeUndefined()
    expect(opened).toEqual([])
  })

  it("tryGet resolves undefined instead of throwing when indexedDB is absent", async () => {
    withoutIndexedDb()
    setCacheSkipped(false)
    await expect(tryGet("filter-v5", "k")).resolves.toBeUndefined()
  })
})
