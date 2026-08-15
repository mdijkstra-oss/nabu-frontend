import { afterEach, describe, expect, it } from "vitest"
import { openTracker } from "~/lib/utils/indexed-db.fixture"
import { setCacheSkipped, tryGet } from "~/lib/utils/storage-cache"
import { gatewayUrl, installStubFetch, streamingText, type StubFetch } from "./fetch.fixture"
import { installHost } from "./host"
import { installedRecorder } from "./recorder"

interface Scope {
  requestAnimationFrame?: unknown
  indexedDB?: unknown
}

const scope = globalThis as Scope

const invokeCallback = async (): Promise<boolean> => {
  let invoked = false
  ;(scope.requestAnimationFrame as (cb: (time: number) => void) => number)(() => {
    invoked = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  return invoked
}

describe("installHost", () => {
  const originalFrame = scope.requestAnimationFrame
  const originalIndexedDb = scope.indexedDB
  let stub: StubFetch | undefined

  afterEach(() => {
    installedRecorder()?.uninstall()
    stub?.restore()
    stub = undefined
    scope.requestAnimationFrame = originalFrame
    scope.indexedDB = originalIndexedDb
    setCacheSkipped(false)
  })

  it("shims requestAnimationFrame when the global is absent", async () => {
    scope.requestAnimationFrame = undefined
    installHost()
    expect(typeof scope.requestAnimationFrame).toBe("function")
    expect(await invokeCallback()).toBe(true)
  })

  it("leaves an existing requestAnimationFrame in place", () => {
    const existing = (): number => 42
    scope.requestAnimationFrame = existing
    installHost()
    expect(scope.requestAnimationFrame).toBe(existing)
  })

  it("installs the fetch wrapper once across repeated calls", async () => {
    stub = installStubFetch(() => streamingText("ok"))
    const first = installHost()
    const second = installHost()
    await globalThis.fetch(gatewayUrl("/x"), { method: "POST", body: "{}" })
    expect(second).toBe(first)
    await expect(first.drain()).resolves.toHaveLength(1)
    expect(stub.requests).toHaveLength(1)
  })

  it("turns the answer cache off before any database is opened", async () => {
    const opened = openTracker()
    installHost()
    await expect(tryGet("llm", "k")).resolves.toBeUndefined()
    expect(opened).toEqual([])
  })
})
