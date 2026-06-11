import { describe, it, expect, vi } from "vitest"
import {
  createTracer,
  formatDimTrace,
  type DimTrace,
  type FilterEntry,
  type AdjudEntry,
} from "./trace"

const baseTrace = (): DimTrace => ({
  dim: "themes",
  target: "docs/foo.md",
  voterCount: 2,
  find: { candidates: 47, files: ["docs/foo.md"], limit: 50 },
  filter: [],
  adjud: [],
})

const filter = (over: Partial<FilterEntry> = {}): FilterEntry => ({
  code: "themes",
  start: 12,
  end: 15,
  text: "Researchers often note that...",
  votes: [
    { modelIdx: 0, judgment: "keep", reason: "clearly fits" },
    { modelIdx: 1, judgment: "keep", reason: "matches" },
  ],
  outcome: "keep",
  ...over,
})

const adjud = (over: Partial<AdjudEntry> = {}): AdjudEntry => ({
  code: "themes",
  start: 40,
  end: 42,
  text: "Other passages discuss...",
  verdict: "keep",
  reason: "tighter read",
  ...over,
})

describe("formatDimTrace header", () => {
  it("includes dim and target prefix", () => {
    const out = formatDimTrace(baseTrace())
    expect(out).toContain("[apply-deep dim=themes] target=docs/foo.md")
  })

  it("renders find line with candidates, limit, files", () => {
    const out = formatDimTrace(baseTrace())
    expect(out).toContain("find → 47 candidates  (limit=50, files=[docs/foo.md])")
  })

  it("renders voter count", () => {
    const out = formatDimTrace({ ...baseTrace(), voterCount: 3 })
    expect(out).toContain("filter (3 voters)")
  })

  it("includes title in header when set", () => {
    const t = baseTrace()
    t.find = { ...t.find, title: "codebooks/themes.generated.hidden.md" }
    const out = formatDimTrace(t)
    expect(out).toContain("[apply-deep dim=themes title=codebooks/themes.generated.hidden.md]")
  })

  it("omits title when unset", () => {
    const out = formatDimTrace(baseTrace())
    expect(out).toContain("[apply-deep dim=themes]")
    expect(out).not.toContain("title=")
  })
})

describe("formatDimTrace filter entries", () => {
  const cases: { name: string; entry: FilterEntry; expectedContains: string[] }[] = [
    {
      name: "passed 2/2 (both keep)",
      entry: filter({ outcome: "keep" }),
      expectedContains: [
        "▸ [themes] s12-15",
        `text: "Researchers often`,
        "v1 ✓",
        "v2 ✓",
        "passed 2/2",
      ],
    },
    {
      name: "dropped 0/2 (both remove)",
      entry: filter({
        outcome: "remove",
        votes: [
          { modelIdx: 0, judgment: "remove", reason: "no" },
          { modelIdx: 1, judgment: "remove", reason: "off-topic" },
        ],
      }),
      expectedContains: ["v1 ✗", "v2 ✗", "dropped 0/2"],
    },
    {
      name: "contested → adjudicate (split)",
      entry: filter({
        outcome: "contested",
        votes: [
          { modelIdx: 0, judgment: "keep", reason: "yes" },
          { modelIdx: 1, judgment: "remove", reason: "topic is y" },
        ],
      }),
      expectedContains: ["v1 ✓", "v2 ✗", "split → adjudicate"],
    },
    {
      name: "missing vote uses · marker",
      entry: filter({
        votes: [
          { modelIdx: 0, judgment: "keep", reason: "yes" },
          { modelIdx: 1, judgment: "missing", reason: "no response" },
        ],
      }),
      expectedContains: ["v1 ✓", "v2 · ", "no response"],
    },
  ]

  cases.forEach(({ name, entry, expectedContains }) => {
    it(name, () => {
      const out = formatDimTrace({ ...baseTrace(), filter: [entry] })
      for (const fragment of expectedContains) expect(out).toContain(fragment)
    })
  })

  it("no filter entries shows placeholder", () => {
    const out = formatDimTrace(baseTrace())
    expect(out).toContain("(no entries reached filter)")
  })

  it("sorts filter entries by span", () => {
    const out = formatDimTrace({
      ...baseTrace(),
      filter: [
        filter({ start: 50, end: 52 }),
        filter({ start: 10, end: 12 }),
        filter({ start: 30, end: 31 }),
      ],
    })
    const s10 = out.indexOf("s10-12")
    const s30 = out.indexOf("s30-31")
    const s50 = out.indexOf("s50-52")
    expect(s10).toBeLessThan(s30)
    expect(s30).toBeLessThan(s50)
  })
})

describe("formatDimTrace adjud entries", () => {
  const cases: { name: string; entry: AdjudEntry; expectedContains: string[] }[] = [
    {
      name: "keep → confirmed",
      entry: adjud({ verdict: "keep" }),
      expectedContains: ["s40-42 → confirmed", `"tighter read"`],
    },
    {
      name: "reject → rejected",
      entry: adjud({ verdict: "reject", reason: "off-topic" }),
      expectedContains: ["→ rejected", `"off-topic"`],
    },
    {
      name: "inconsistent → inconsistent",
      entry: adjud({ verdict: "inconsistent", reason: "ambiguous" }),
      expectedContains: ["→ inconsistent", `"ambiguous"`],
    },
  ]

  cases.forEach(({ name, entry, expectedContains }) => {
    it(name, () => {
      const out = formatDimTrace({ ...baseTrace(), adjud: [entry] })
      for (const fragment of expectedContains) expect(out).toContain(fragment)
    })
  })

  it("singular vs plural entry word", () => {
    const one = formatDimTrace({ ...baseTrace(), adjud: [adjud()] })
    expect(one).toContain("adjudicate (1 entry)")
    const many = formatDimTrace({
      ...baseTrace(),
      adjud: [adjud({ start: 1, end: 2 }), adjud({ start: 5, end: 6 })],
    })
    expect(many).toContain("adjudicate (2 entries)")
  })

  it("zero entries shows (none)", () => {
    const out = formatDimTrace(baseTrace())
    expect(out).toContain("adjudicate (0 entries)")
    expect(out).toContain("(none)")
  })
})

describe("createTracer", () => {
  it("setTarget propagates to existing dims", () => {
    const tracer = createTracer()
    tracer.setFind("d1", { candidates: 5, files: ["a.md"], limit: 50 })
    tracer.setTarget("docs/x.md")
    const snap = tracer.snapshot()
    expect(snap).toHaveLength(1)
    expect(snap[0].target).toBe("docs/x.md")
  })

  it("setVoterCount propagates to existing dims", () => {
    const tracer = createTracer()
    tracer.setFind("d1", { candidates: 5, files: [], limit: 50 })
    tracer.setVoterCount(3)
    expect(tracer.snapshot()[0].voterCount).toBe(3)
  })

  it("snapshot returns dims sorted by name", () => {
    const tracer = createTracer()
    tracer.setFind("zeta", { candidates: 1, files: [], limit: 50 })
    tracer.setFind("alpha", { candidates: 2, files: [], limit: 50 })
    tracer.setFind("mu", { candidates: 3, files: [], limit: 50 })
    const snap = tracer.snapshot()
    expect(snap.map((d) => d.dim)).toEqual(["alpha", "mu", "zeta"])
  })

  it("pushFilter/pushAdjud auto-create dim entry", () => {
    const tracer = createTracer()
    tracer.pushFilter("newdim", filter({ code: "newdim" }))
    tracer.pushAdjud("newdim", adjud({ code: "newdim" }))
    const snap = tracer.snapshot()
    expect(snap).toHaveLength(1)
    expect(snap[0].filter).toHaveLength(1)
    expect(snap[0].adjud).toHaveLength(1)
  })

  it("flush calls console.debug per dim", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => undefined)
    const tracer = createTracer()
    tracer.setTarget("t.md")
    tracer.setFind("a", { candidates: 1, files: [], limit: 50 })
    tracer.setFind("b", { candidates: 2, files: [], limit: 50 })
    tracer.flush()
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})
