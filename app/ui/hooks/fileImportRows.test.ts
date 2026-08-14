import { describe, expect, it } from "vitest"
import {
  addRows,
  applyEngineEvent,
  applyImportStatus,
  deriveProgress,
  emptyImportRows,
} from "./fileImportRows"
import type { ImportRows } from "./fileImportRows"
import type { EngineEvent, EngineStage, EngineStatus } from "~/lib/engine/types"
import type { ImportFile, ImportStatus } from "~/lib/import/types"

const event = (
  file: string,
  stage: EngineStage,
  status: EngineStatus,
  error?: string
): EngineEvent => ({ file, stage, status, ...(error !== undefined && { error }) })

const settleAll = (file: string): EngineEvent[] => [
  event(file, "embed", "settled"),
  event(file, "classify", "settled"),
  event(file, "regions", "settled"),
]

const failClassify = (file: string, error: string): EngineEvent[] => [
  event(file, "embed", "working"),
  event(file, "embed", "settled"),
  event(file, "classify", "working"),
  event(file, "classify", "failed", error),
  event(file, "regions", "working"),
  event(file, "regions", "settled"),
]

type Step = { status: [string, ImportStatus, Partial<ImportFile>?] } | { engine: EngineEvent }

const ingested = (id: string, finalPath: string = id): Step[] => [
  { status: [id, "reading"] },
  { status: [id, "processing", { finalPath }] },
  { status: [id, "pending"] },
]

const run = (dropped: { name: string; size: number }[], steps: Step[]): ImportRows =>
  steps.reduce(
    (state, step) =>
      "engine" in step
        ? applyEngineEvent(state, step.engine)
        : applyImportStatus(state, ...step.status),
    addRows(emptyImportRows, dropped)
  )

const drop = (name: string, size = 100) => ({ name, size })

describe("applyEngineEvent row transitions", () => {
  const cases: {
    name: string
    dropped: { name: string; size: number }[]
    steps: Step[]
    expectedRows: Record<string, Partial<ImportFile>>
  }[] = [
    {
      name: "a failed classify stage lands the row at incomplete with the stage error, once all stages terminate",
      dropped: [drop("a.md")],
      steps: [
        ...ingested("a.md"),
        ...failClassify("a.md", "classify blew up").map((e) => ({ engine: e })),
      ],
      expectedRows: { "a.md": { status: "incomplete", error: "classify blew up" } },
    },
    {
      name: "events under the deduped final path advance the row keyed by the original filename",
      dropped: [drop("note.md")],
      steps: [
        ...ingested("note.md", "note-ab12.md"),
        { engine: event("note-ab12.md", "embed", "working") },
      ],
      expectedRows: {
        "note.md": { status: "embedding", finalPath: "note-ab12.md", name: "note.md" },
      },
    },
    {
      name: "stages settling with nothing to do still reach Added — settle is explicit, never silence",
      dropped: [drop("a.md")],
      steps: [...ingested("a.md"), ...settleAll("a.md").map((e) => ({ engine: e }))],
      expectedRows: { "a.md": { status: "completed" } },
    },
    {
      name: "each working event advances the row to that stage's status",
      dropped: [drop("a.md")],
      steps: [
        ...ingested("a.md"),
        { engine: event("a.md", "embed", "working") },
        { engine: event("a.md", "embed", "settled") },
        { engine: event("a.md", "classify", "working") },
        { engine: event("a.md", "classify", "settled") },
        { engine: event("a.md", "regions", "working") },
      ],
      expectedRows: { "a.md": { status: "regions" } },
    },
    {
      name: "a queued event leaves the row at pending until work starts",
      dropped: [drop("a.md")],
      steps: [...ingested("a.md"), { engine: event("a.md", "embed", "queued") }],
      expectedRows: { "a.md": { status: "pending" } },
    },
    {
      name: "a red ingest rejection stays red when engine events later arrive for its path",
      dropped: [drop("a.md")],
      steps: [
        { status: ["a.md", "reading"] },
        { status: ["a.md", "processing", { finalPath: "a.md" }] },
        { status: ["a.md", "error", { error: "block: bad json" }] },
        { engine: event("a.md", "embed", "working") },
        ...settleAll("a.md").map((e) => ({ engine: e })),
      ],
      expectedRows: { "a.md": { status: "error", error: "block: bad json" } },
    },
    {
      name: "an incomplete row moves forward to completed when a later pass settles the failed stage",
      dropped: [drop("a.md")],
      steps: [
        ...ingested("a.md"),
        ...failClassify("a.md", "classify blew up").map((e) => ({ engine: e })),
        { engine: event("a.md", "classify", "queued") },
        { engine: event("a.md", "classify", "working") },
        { engine: event("a.md", "classify", "settled") },
      ],
      expectedRows: { "a.md": { status: "completed", error: undefined } },
    },
    {
      name: "an incomplete row does not regress to a spinner while the retry runs",
      dropped: [drop("a.md")],
      steps: [
        ...ingested("a.md"),
        ...failClassify("a.md", "classify blew up").map((e) => ({ engine: e })),
        { engine: event("a.md", "classify", "working") },
      ],
      expectedRows: { "a.md": { status: "incomplete" } },
    },
  ]

  it.each(cases)("$name", ({ dropped, steps, expectedRows }) => {
    const state = run(dropped, steps)
    for (const [id, expected] of Object.entries(expectedRows)) {
      expect(state.rows[id]).toMatchObject(expected)
    }
  })
})

describe("frozen terminal rows", () => {
  it("an Added row ignores fresh engine events for its path and returns the same state", () => {
    const added = run(
      [drop("a.md")],
      [...ingested("a.md"), ...settleAll("a.md").map((e) => ({ engine: e }))]
    )

    const afterEdit = [
      event("a.md", "embed", "working"),
      event("a.md", "classify", "failed", "later edit failure"),
    ].reduce(applyEngineEvent, added)

    expect(afterEdit).toBe(added)
    expect(afterEdit.rows["a.md"]).toMatchObject({ status: "completed" })
    expect(deriveProgress(Object.values(afterEdit.rows))).toEqual(
      deriveProgress(Object.values(added.rows))
    )
  })

  it("an event for a path no row claims is ignored", () => {
    const state = run([drop("a.md")], ingested("a.md"))
    expect(applyEngineEvent(state, event("boot-file.md", "embed", "working"))).toBe(state)
  })

  it("an unsupported row ignores engine events even when its name maps to a path", () => {
    const added = addRows(emptyImportRows, [drop("photo.png")])
    const claimed = applyImportStatus(added, "photo.png", "unsupported", {
      finalPath: "photo.png",
    })

    const afterEvents = settleAll("photo.png").reduce(applyEngineEvent, claimed)

    expect(afterEvents.rows["photo.png"]).toMatchObject({ status: "unsupported" })
    expect(afterEvents.rows).toBe(claimed.rows)
  })

  it("an incomplete row returns the same state for repeated events of its recorded outcomes", () => {
    const incomplete = run(
      [drop("a.md")],
      [...ingested("a.md"), ...failClassify("a.md", "classify down").map((e) => ({ engine: e }))]
    )
    expect(incomplete.rows["a.md"]).toMatchObject({ status: "incomplete" })

    const replayed = [
      event("a.md", "classify", "working"),
      event("a.md", "classify", "failed", "classify down"),
    ].reduce(applyEngineEvent, incomplete)

    expect(replayed).toBe(incomplete)
  })
})

describe("deriveProgress", () => {
  const row = (id: string, status: ImportStatus, extra?: Partial<ImportFile>): ImportFile => ({
    id,
    name: id,
    size: 100,
    status,
    ...extra,
  })

  const cases = [
    {
      name: "one Added and one still classifying is 1 of 2 processed",
      rows: [row("a.md", "completed"), row("b.md", "classifying")],
      expected: { total: 2, completed: 1, incomplete: 0, failed: 0, unsupported: 0, processed: 1 },
    },
    {
      name: "every terminal state counts toward processed, mid-engine rows toward nothing",
      rows: [
        row("a.md", "completed"),
        row("b.md", "incomplete", { error: "classify blew up" }),
        row("c.md", "error", { error: "bad json" }),
        row("d.png", "unsupported"),
        row("e.md", "embedding"),
        row("f.md", "pending"),
      ],
      expected: { total: 6, completed: 1, incomplete: 1, failed: 1, unsupported: 1, processed: 4 },
    },
    {
      name: "empty queue is all zeroes",
      rows: [],
      expected: { total: 0, completed: 0, incomplete: 0, failed: 0, unsupported: 0, processed: 0 },
    },
  ]

  it.each(cases)("$name", ({ rows, expected }) => {
    expect(deriveProgress(rows)).toEqual(expected)
  })

  it("incomplete advancing to completed leaves processed unchanged", () => {
    const incomplete = run(
      [drop("a.md")],
      [...ingested("a.md"), ...failClassify("a.md", "classify blew up").map((e) => ({ engine: e }))]
    )
    const before = deriveProgress(Object.values(incomplete.rows))
    expect(before).toMatchObject({ incomplete: 1, completed: 0, processed: 1 })

    const settled = applyEngineEvent(incomplete, event("a.md", "classify", "settled"))
    const after = deriveProgress(Object.values(settled.rows))
    expect(after).toMatchObject({ incomplete: 0, completed: 1, processed: 1 })
  })
})

describe("addRows", () => {
  it("marks markdown pending, everything else unsupported, and never re-adds a name", () => {
    const first = addRows(emptyImportRows, [drop("a.md"), drop("photo.png")])
    expect(first.rows["a.md"]).toMatchObject({ status: "pending", size: 100 })
    expect(first.rows["photo.png"]).toMatchObject({ status: "unsupported" })

    const again = addRows(first, [drop("a.md", 999)])
    expect(again.rows["a.md"].size).toBe(100)
  })
})
