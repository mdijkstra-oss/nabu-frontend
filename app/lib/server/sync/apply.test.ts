import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { getFileRaw, setFiles, setProjectId } from "~/lib/files/store"
import { SETTINGS_FILE } from "~/lib/files/filename"
import { applyCommand } from "./apply"
import type { Command } from "./types"
import { EPOCH, ISO, UNDATEABLE_EPOCH, settingsWith, CORRUPT } from "~/lib/files/ingest.fixtures"

const PERSIST_SETTLE_MS = 1_000

let sent: Command[] = []

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost:8080" } })
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as Command)
      return Promise.resolve(new Response("{}", { status: 200 }))
    })
  )
  setProjectId("p1")
})

afterEach(() => {
  setFiles({})
  setProjectId(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("applyCommand WriteFile on the initial-load path", () => {
  const cases = [
    {
      name: "an already-migrated file lands in the store without a persist back",
      content: settingsWith(ISO),
      persistedBack: false,
    },
    {
      name: "an old-schema file is stored migrated and persisted back once",
      content: settingsWith(EPOCH),
      persistedBack: true,
    },
  ]

  it.each(cases)("$name", async ({ content, persistedBack }) => {
    applyCommand({ action: "WriteFile", path: SETTINGS_FILE, content })

    expect(getFileRaw(SETTINGS_FILE)).toContain(ISO)
    expect(getFileRaw(SETTINGS_FILE)).not.toContain(String(EPOCH))

    await vi.advanceTimersByTimeAsync(PERSIST_SETTLE_MS)

    if (!persistedBack) {
      expect(sent).toEqual([])
      return
    }

    expect(sent).toEqual([expect.objectContaining({ action: "WriteFile", path: SETTINGS_FILE })])
    expect(sent[0].content).toContain(ISO)
    expect(sent[0].content).not.toContain(String(EPOCH))
  })

  it("a file that crashes a migration is skipped without throwing or wedging the load", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    expect(() =>
      applyCommand({
        action: "WriteFile",
        path: "undateable.md",
        content: settingsWith(UNDATEABLE_EPOCH),
      })
    ).not.toThrow()

    expect(getFileRaw("undateable.md")).toBe("")

    await vi.advanceTimersByTimeAsync(PERSIST_SETTLE_MS)
    expect(sent).toEqual([])

    consoleError.mockRestore()
  })

  it("a corrupt file is logged and skipped without throwing, storing, or persisting back", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    expect(() =>
      applyCommand({ action: "WriteFile", path: "broken.md", content: CORRUPT })
    ).not.toThrow()

    expect(getFileRaw("broken.md")).toBe("")
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("rejected corrupt file broken.md"),
      expect.arrayContaining([expect.objectContaining({ block: "json-settings" })])
    )

    await vi.advanceTimersByTimeAsync(PERSIST_SETTLE_MS)
    expect(sent).toEqual([])

    consoleError.mockRestore()
  })
})
