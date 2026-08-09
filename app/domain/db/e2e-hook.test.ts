import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ok, err } from "~/lib/fp/result"
import type { Database, DbError, QueryResult } from "~/lib/db/types"
import { installTestHook } from "./e2e-hook"
import { waitForDatabase, getDatabase } from "./database"

vi.mock("./database", () => ({
  waitForDatabase: vi.fn(),
  getDatabase: vi.fn(),
}))

const dbAnswering = (result: Awaited<ReturnType<Database["query"]>>): Database =>
  ({ query: vi.fn().mockResolvedValue(result) }) as unknown as Database

const rows = (r: Record<string, unknown>[]): QueryResult<unknown> => ({
  rows: r,
  rowCount: r.length,
})

const queryError = (message: string): DbError => ({ type: "query", message })

beforeEach(() => {
  vi.stubGlobal("window", {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe("installTestHook", () => {
  it("with the flag set, attaches only once the database readiness signal resolves", async () => {
    vi.stubEnv("VITE_E2E", "true")
    let ready!: () => void
    vi.mocked(waitForDatabase).mockReturnValue(new Promise((r) => (ready = r)))
    vi.mocked(getDatabase).mockReturnValue(dbAnswering(ok(rows([{ id: "f1" }]))))

    const installed = installTestHook(import.meta.env.VITE_E2E)
    await Promise.resolve()
    expect(window.__nabuTest).toBeUndefined()

    ready()
    await installed
    await expect(window.__nabuTest?.query("select * from files")).resolves.toEqual([{ id: "f1" }])
  })

  it("with the flag unset, attaches nothing and never touches the database", async () => {
    vi.stubEnv("VITE_E2E", undefined)
    await installTestHook(import.meta.env.VITE_E2E)
    expect(window.__nabuTest).toBeUndefined()
    expect(waitForDatabase).not.toHaveBeenCalled()
  })

  it("with the flag empty, attaches nothing — empty means off, the repo's env convention", async () => {
    vi.stubEnv("VITE_E2E", "")
    await installTestHook(import.meta.env.VITE_E2E)
    expect(window.__nabuTest).toBeUndefined()
    expect(waitForDatabase).not.toHaveBeenCalled()
  })

  it("surfaces a query failure as a rejection carrying the database's own message", async () => {
    vi.stubEnv("VITE_E2E", "true")
    vi.mocked(waitForDatabase).mockResolvedValue(undefined)
    vi.mocked(getDatabase).mockReturnValue(
      dbAnswering(err(queryError("Query failed: Table with name missing does not exist!")))
    )

    await installTestHook(import.meta.env.VITE_E2E)
    await expect(window.__nabuTest?.query("select * from missing")).rejects.toThrow(
      "Query failed: Table with name missing does not exist!"
    )
  })
})
