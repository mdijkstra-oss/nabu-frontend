import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  setFiles,
  getFiles as storeFiles,
  getFileRaw,
  updateFileRaw,
  deleteFile,
} from "~/lib/files/store"
import { subscribeContentChanges } from "~/lib/files/subscribe-content"
import { ok, err } from "~/lib/fp/result"
import { companionFilename } from "~/lib/embeddings/companion"
import { getAttributes } from "~/domain/data-blocks/attributes/selectors"
import { readStoredRegions } from "~/lib/regions/stored"
import { writeRegionsBlock } from "~/domain/regions/init"
import type { FindCall, FindWork, MarkCall, MarkWork } from "~/lib/regions/detect/types"
import { personKind, transcript, hitsIn } from "~/lib/regions/person.fixtures"
import { zeroVector } from "~/lib/embeddings/embedding.fixtures"
import { startEngine, ENGINE_DEBOUNCE, ENGINE_MAX_WAIT } from "./engine"
import type { EngineDeps, EngineEvent, EngineHandle, EngineStage } from "./types"

interface Seams {
  fetches: string[][]
  classifies: number
  finds: FindWork[]
  marks: MarkWork[]
  passes: number
  events: EngineEvent[]
}

const createDeps = (overrides: Partial<EngineDeps> = {}) => {
  const seams: Seams = { fetches: [], classifies: 0, finds: [], marks: [], passes: 0, events: [] }

  const find: FindCall = (items, job) => {
    seams.finds.push(...items)
    for (const item of items) job.onAnswered(item, hitsIn(item))
    return Promise.resolve({ unrecorded: [] })
  }

  const mark: MarkCall = (items, job) => {
    seams.marks.push(...items)
    for (const item of items) {
      job.onAnswered(item, {
        ...item.hit,
        startSentence: item.hit.hitSentence,
        endSentence: Math.min(item.hit.hitSentence + 1, item.window.end),
      })
    }
    return Promise.resolve()
  }

  const deps: EngineDeps = {
    getFiles: () => {
      seams.passes++
      return storeFiles()
    },
    getFile: (path) => getFileRaw(path) || undefined,
    updateFile: updateFileRaw,
    deleteFile,
    subscribe: () => () => undefined,
    embeddingsUrl: "http://embeddings.test",
    fetchBatch: (texts) => {
      seams.fetches.push(texts)
      return Promise.resolve(ok(texts.map(() => zeroVector())))
    },
    classify: () => {
      seams.classifies++
      return Promise.resolve({ type: "note", subject: "meetings" })
    },
    getKinds: () => [personKind],
    detect: { find, mark },
    writeRegions: writeRegionsBlock,
    getSignificantLanguages: () => Promise.resolve(["eng"]),
    syncDescriptions: () => Promise.resolve(),
    onEvent: (event) => seams.events.push(event),
    ...overrides,
  }

  return { deps, seams }
}

type Fixture = ReturnType<typeof createDeps>

let engines: EngineHandle[] = []

const boot = async (fixture: Fixture): Promise<EngineHandle> => {
  const engine = startEngine(fixture.deps)
  engines.push(engine)
  await engine.ready
  return engine
}

const eventsFor = (events: EngineEvent[], file: string, stage: EngineStage): EngineEvent[] =>
  events.filter((e) => e.file === file && e.stage === stage)

const statusesFor = (events: EngineEvent[], file: string, stage: EngineStage): string[] =>
  eventsFor(events, file, stage).map((e) => e.status)

const processCorpus = async (paths: Record<string, string>): Promise<void> => {
  setFiles(paths)
  const processor = createDeps()
  const engine = await boot(processor)
  await engine.tick()
  engine.stop()
}

beforeEach(() => {
  engines = []
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

afterEach(() => {
  for (const engine of engines) engine.stop()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("convergence over a fully processed project", () => {
  it("settles every pair without work on the first pass and starts no second round", async () => {
    await processCorpus({ "talk.md": transcript(6) })
    const processed = getFileRaw("talk.md")
    const companion = getFileRaw(companionFilename("talk.md"))
    expect(companion).not.toBe("")
    expect(getAttributes(processed)?.hash).toBeDefined()
    expect(readStoredRegions(processed).scanned[personKind.id].length).toBeGreaterThan(0)

    const verifier = createDeps()
    const engine = await boot(verifier)

    expect(verifier.seams.fetches).toEqual([])
    expect(verifier.seams.classifies).toBe(0)
    expect(verifier.seams.finds).toEqual([])
    expect(verifier.seams.marks).toEqual([])
    expect(verifier.seams.events).toEqual([
      { file: "talk.md", stage: "embed", status: "settled" },
      { file: "talk.md", stage: "classify", status: "settled" },
      { file: "talk.md", stage: "regions", status: "settled" },
    ])
    expect(getFileRaw("talk.md")).toBe(processed)
    expect(getFileRaw(companionFilename("talk.md"))).toBe(companion)

    await engine.tick()
    engine.stop()

    expect(verifier.seams.events).toHaveLength(3)
    expect(verifier.seams.fetches).toEqual([])
    expect(verifier.seams.classifies).toBe(0)
    expect(verifier.seams.finds).toEqual([])
  })
})

describe("the echo pass", () => {
  it("emits nothing for the pass the engine's own writes wake, and wakes no third", async () => {
    vi.useFakeTimers()
    setFiles({ "talk.md": transcript(4) })

    const fixture = createDeps({ subscribe: subscribeContentChanges })
    const engine = await boot(fixture)

    expect(fixture.seams.passes).toBe(1)
    expect(fixture.seams.events.length).toBeGreaterThan(0)
    fixture.seams.events.length = 0
    const fetchesAfterBoot = fixture.seams.fetches.length
    const classifiesAfterBoot = fixture.seams.classifies
    const findsAfterBoot = fixture.seams.finds.length

    await vi.advanceTimersByTimeAsync(ENGINE_DEBOUNCE + 500)

    expect(fixture.seams.passes).toBe(2)
    expect(fixture.seams.events).toEqual([])
    expect(fixture.seams.fetches).toHaveLength(fetchesAfterBoot)
    expect(fixture.seams.classifies).toBe(classifiesAfterBoot)
    expect(fixture.seams.finds).toHaveLength(findsAfterBoot)

    await vi.advanceTimersByTimeAsync(ENGINE_MAX_WAIT)

    expect(fixture.seams.passes).toBe(2)
    expect(fixture.seams.events).toEqual([])
    engine.stop()
  })
})

describe("independent stages under failure", () => {
  const bootWithDeadEmbeddings = async () => {
    setFiles({ "talk.md": transcript(4) })
    let embedDown = true
    const fixture = createDeps({
      fetchBatch: (texts) => {
        if (embedDown) return Promise.resolve(err({ type: "network", message: "endpoint down" }))
        fixture.seams.fetches.push(texts)
        return Promise.resolve(ok(texts.map(() => zeroVector())))
      },
    })
    const engine = await boot(fixture)
    return {
      fixture,
      engine,
      restoreEmbeddings: () => {
        embedDown = false
      },
    }
  }

  it("fails embed alone, still classifies and scans, and keeps the file", async () => {
    const errors: string[] = []
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "))
    })

    const { fixture } = await bootWithDeadEmbeddings()
    const { events } = fixture.seams

    expect(statusesFor(events, "talk.md", "embed")).toEqual(["queued", "working", "failed"])
    expect(eventsFor(events, "talk.md", "embed").at(-1)?.error).toContain("endpoint down")
    expect(statusesFor(events, "talk.md", "classify")).toEqual(["queued", "working", "settled"])
    expect(statusesFor(events, "talk.md", "regions")).toEqual(["queued", "working", "settled"])
    expect(fixture.seams.classifies).toBe(1)
    expect(fixture.seams.finds.length).toBeGreaterThan(0)
    expect(getFileRaw("talk.md")).not.toBe("")
    expect(getFileRaw(companionFilename("talk.md"))).toBe("")
    expect(errors.some((e) => e.includes("embed failed"))).toBe(true)
  })

  it("retries only the still-dirty failed stage on the next pass", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    const { fixture, engine, restoreEmbeddings } = await bootWithDeadEmbeddings()
    restoreEmbeddings()
    fixture.seams.events.length = 0

    await engine.tick()
    engine.stop()

    expect(fixture.seams.events).toEqual([
      { file: "talk.md", stage: "embed", status: "queued" },
      { file: "talk.md", stage: "embed", status: "working" },
      { file: "talk.md", stage: "embed", status: "settled" },
    ])
    expect(getFileRaw(companionFilename("talk.md"))).not.toBe("")
  })
})

describe("explicit settle without work", () => {
  it("settles a file with no prose without queueing, calling out, or keeping a companion", async () => {
    setFiles({ "code.md": "```ts\nconst a = 1\n```" })
    const fixture = createDeps()
    const engine = await boot(fixture)
    engine.stop()

    const { events } = fixture.seams
    expect(statusesFor(events, "code.md", "embed")).toEqual(["settled"])
    expect(statusesFor(events, "code.md", "classify")).toEqual(["queued", "working", "settled"])
    expect(statusesFor(events, "code.md", "regions")).toEqual(["settled"])
    expect(fixture.seams.fetches).toEqual([])
    expect(fixture.seams.classifies).toBe(0)
    expect(fixture.seams.finds).toEqual([])
    expect(getFileRaw(companionFilename("code.md"))).toBe("")
  })
})

describe("interleaving through the pool", () => {
  it("lets one file reach classify while the other is still embedding", async () => {
    setFiles({
      "a.md": "Rutte opened the alpha meeting. It ran long into the evening.",
      "b.md": "Kaag closed the beta session. It wrapped up before lunch.",
    })

    let releaseB!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseB = resolve
    })

    const fixture = createDeps({
      getKinds: () => [],
      fetchBatch: async (texts) => {
        if (texts.some((text) => text.includes("beta"))) await gate
        return ok(texts.map(() => zeroVector()))
      },
      onEvent: (event) => {
        fixture.seams.events.push(event)
        if (event.file === "a.md" && event.stage === "classify" && event.status === "working") {
          releaseB()
        }
      },
    })

    const engine = await boot(fixture)
    engine.stop()

    const order = fixture.seams.events.map((e) => `${e.file} ${e.stage} ${e.status}`)
    expect(order.indexOf("a.md classify working")).toBeGreaterThan(-1)
    expect(order.indexOf("b.md embed settled")).toBeGreaterThan(
      order.indexOf("a.md classify working")
    )
  })
})

describe("deletion", () => {
  it("deletes the companion of a removed file and does not queue the removed path", async () => {
    setFiles({ "talk.md": transcript(2) })
    const fixture = createDeps()
    const engine = await boot(fixture)
    expect(getFileRaw(companionFilename("talk.md"))).not.toBe("")

    deleteFile("talk.md")
    fixture.seams.events.length = 0

    await engine.tick()
    engine.stop()

    expect(getFileRaw(companionFilename("talk.md"))).toBe("")
    expect(fixture.seams.events.filter((e) => e.file === "talk.md")).toEqual([])
  })
})
