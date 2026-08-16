import { readFileSync, writeFileSync } from "node:fs"
import type * as NodeFs from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { formatBlockJson, replaceSingletonBlock } from "~/lib/data-blocks/parse"
import type { RegionsBlock } from "~/domain/data-blocks/regions/schema"
import { REGIONS_LANGUAGE } from "~/lib/regions/decorate/resolve"
import { FIND_ENDPOINT, FIND_MAX_ITEMS } from "~/lib/regions/detect/find"
import { MARK_ENDPOINT } from "~/lib/regions/detect/mark"
import { REGION_KIND_IDS, regionKinds, rulesHashOf } from "~/lib/regions/kinds/registry"
import { readStoredRegions } from "~/lib/regions/stored"
import { installRecordedStub, type StubFetch } from "../fetch.fixture"
import type { RecorderHandle } from "../recorder"
import { scanDocument } from "./document"
import { regionFinder } from "./region-finder"
import { regionPass } from "./region-pass"
import {
  answeringDetect,
  fileAttributesOf,
  findReplyByKind,
  HIT_SENTENCE_NUMBER,
  markReply,
} from "./region.fixture"

const { fsWrites } = vi.hoisted(() => ({ fsWrites: [] as string[] }))

// agents.md, Isolation: the pass reaches the filesystem only through its capturing
// writeRegions, so every writing entry point of node:fs records instead of writing.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      void fsWrites.push(`${name} ${String(args[0])}`)
  return {
    ...actual,
    writeFileSync: record("writeFileSync"),
    appendFileSync: record("appendFileSync"),
    createWriteStream: record("createWriteStream"),
  }
})

const FILE = "transcript.md"
const raw = readFileSync("scripts/fixtures/try-prompt/transcript.md", "utf-8")
const doc = scanDocument(FILE, raw)

const runPass = (raw: string, kind?: string): Promise<RegionsBlock | undefined> => {
  const extras = regionPass.extras.parse(kind === undefined ? {} : { kind })
  return regionPass.run({ files: { [FILE]: raw }, extras }) as Promise<RegionsBlock | undefined>
}

const withStoredBlock = (raw: string, block: RegionsBlock): string =>
  replaceSingletonBlock(raw, REGIONS_LANGUAGE, formatBlockJson(block))

describe("region-pass", () => {
  let recorder: RecorderHandle
  let stub: StubFetch
  let teardown: () => Promise<void>

  beforeEach(() => {
    ;({ stub, recorder, teardown } = installRecordedStub(
      answeringDetect({ [FIND_ENDPOINT]: findReplyByKind, [MARK_ENDPOINT]: markReply })
    ))
    fsWrites.length = 0
  })

  afterEach(async () => {
    await teardown()
  })

  it("rejects a kind that is not registered, listing the registered ids", () => {
    const result = regionPass.extras.safeParse({ kind: "nope" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0].message).toContain(REGION_KIND_IDS.join(", "))
    expect(stub.requests).toHaveLength(0)
  })

  it("constructs the block the app would have written for a file with no stored regions", async () => {
    const block = await runPass(raw)
    const calls = await recorder.drain()

    expect(block).toBeDefined()
    if (!block) return
    expect(Object.keys(block.scanned).sort()).toEqual(REGION_KIND_IDS.slice().sort())
    for (const kind of regionKinds()) {
      expect(block.scanned[kind.id]).toEqual(
        doc.units.map((unit) => ({
          hash: unit.hash,
          firstSentence: unit.firstSentence,
          rules: rulesHashOf(kind),
        }))
      )
      const rows = block.regions.filter((row) => row.kind === kind.id)
      expect(rows.map((row) => row.hitSentence)).toEqual(
        doc.units.map((unit) => unit.firstSentence + HIT_SENTENCE_NUMBER - 1)
      )
      expect(rows.every((row) => row.startSentence !== undefined)).toBe(true)
    }
    const findBatches = Math.ceil(doc.units.length / FIND_MAX_ITEMS)
    expect(findBatches).toBeGreaterThan(1)
    const endpoints = calls.map((call) => call.endpoint)
    expect(endpoints.filter((e) => e === FIND_ENDPOINT)).toHaveLength(
      findBatches * regionKinds().length
    )
    expect(endpoints.filter((e) => e === MARK_ENDPOINT)).toHaveLength(regionKinds().length)
    expect(readFileSync("scripts/fixtures/try-prompt/transcript.md", "utf-8")).toBe(raw)
  })

  it("captures the block through writeRegions and writes nothing through node:fs", async () => {
    const block = await runPass(raw)

    expect(block).toBeDefined()
    expect(fsWrites).toEqual([])
    // the same call the pass must not make, so a silent mock cannot pass the assertion
    writeFileSync("/nowhere/proof.md", "x")
    expect(fsWrites).toEqual(["writeFileSync /nowhere/proof.md"])
  })

  it("makes no call over a file already scanned under the current rules, where region-finder still does", async () => {
    const stored = await runPass(raw, "person")
    await recorder.drain()
    if (!stored) throw new Error("first pass constructed nothing")
    expect(stored.regions).toHaveLength(doc.units.length)
    const scannedRaw = withStoredBlock(raw, stored)
    expect(readStoredRegions(scannedRaw)).toEqual(stored)

    const again = await runPass(scannedRaw, "person")
    const passCalls = await recorder.drain()
    expect(passCalls).toEqual([])
    expect(again).toEqual(stored)

    const finderExtras = regionFinder.extras.parse({ kind: "person" })
    await regionFinder.run({
      files: { [FILE]: scannedRaw },
      extras: finderExtras,
    })
    const finderCalls = await recorder.drain()
    expect(finderCalls.flatMap((call) => fileAttributesOf(call.request))).toHaveLength(
      doc.units.length
    )
  })
})
