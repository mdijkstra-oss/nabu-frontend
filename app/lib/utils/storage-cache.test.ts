import { afterEach, describe, expect, it } from "vitest"
import { openTracker, withoutIndexedDb } from "./indexed-db.fixture"
import { setCacheSkipped, tryGet, tryPut } from "./storage-cache"

describe("storage cache without a browser", () => {
  afterEach(() => {
    setCacheSkipped(false)
    withoutIndexedDb()
  })

  it.each([
    { name: "tryGet", call: () => tryGet("llm", "k") },
    { name: "tryPut", call: () => tryPut("llm", "k", { a: 1 }) },
  ])("$name resolves undefined and opens no database while skipping", async ({ call }) => {
    const opened = openTracker()
    setCacheSkipped(true)
    await expect(call()).resolves.toBeUndefined()
    expect(opened).toEqual([])
  })

  it("tryGet resolves undefined instead of throwing when indexedDB is absent", async () => {
    withoutIndexedDb()
    setCacheSkipped(false)
    await expect(tryGet("filter-v5", "k")).resolves.toBeUndefined()
  })
})
