import { describe, it, expect } from "vitest"
import { applyVerdict, collectCodeIds, isContested, type Verdict } from "./step-adjudicate"
import type { Annotation } from "./types"

const ann = (overrides: Partial<Annotation> = {}): Annotation => ({
  start: 1,
  end: 1,
  code: "callout-x",
  findVotes: [true, true],
  reason: "",
  ...overrides,
})

describe("isContested", () => {
  const cases = [
    { name: "no review → not contested", input: ann({ reason: "k" }), expected: false },
    { name: "review set → contested", input: ann({ reason: "k", review: "r" }), expected: true },
    { name: "review empty string → contested", input: ann({ review: "" }), expected: true },
  ]
  cases.forEach(({ name, input, expected }) => {
    it(name, () => expect(isContested(input)).toBe(expected))
  })
})

describe("collectCodeIds", () => {
  const cases = [
    { name: "empty → empty set", input: [], expected: [] },
    {
      name: "deduplicates codes",
      input: [ann({ code: "a" }), ann({ code: "a" }), ann({ code: "b" })],
      expected: ["a", "b"],
    },
    {
      name: "preserves all distinct codes",
      input: [ann({ code: "a" }), ann({ code: "b" }), ann({ code: "c" })],
      expected: ["a", "b", "c"],
    },
  ]
  cases.forEach(({ name, input, expected }) => {
    it(name, () => expect([...collectCodeIds(input)].sort()).toEqual(expected.sort()))
  })
})

describe("applyVerdict", () => {
  const contested = ann({ reason: "filter keep reason", review: "filter remove reason" })

  const cases: { name: string; verdict: Verdict; assert: (out: Annotation | null) => void }[] = [
    {
      name: "reject → drops annotation",
      verdict: { judgment: "reject", reason: "redundant with callout-y" },
      assert: (out) => expect(out).toBeNull(),
    },
    {
      name: "keep → clears review, sets new reason",
      verdict: { judgment: "keep", reason: "fits 'X' criterion precisely" },
      assert: (out) => {
        expect(out).not.toBeNull()
        expect(out?.review).toBeUndefined()
        expect(out?.reason).toBe("fits 'X' criterion precisely")
      },
    },
    {
      name: "inconsistent → keeps, sets review and reason to model's reason",
      verdict: {
        judgment: "inconsistent",
        reason: "definition's apply-when contradicts framework scope",
      },
      assert: (out) => {
        expect(out).not.toBeNull()
        expect(out?.reason).toBe("definition's apply-when contradicts framework scope")
        expect(out?.review).toBe("definition's apply-when contradicts framework scope")
      },
    },
  ]

  cases.forEach(({ name, verdict, assert }) => {
    it(name, () => assert(applyVerdict(contested, verdict)))
  })

  it("preserves start/end/code/findVotes on keep", () => {
    const a = ann({ start: 5, end: 8, code: "callout-z", findVotes: [true, false] })
    const out = applyVerdict(a, { judgment: "keep", reason: "ok" })
    expect(out).toEqual({
      start: 5,
      end: 8,
      code: "callout-z",
      findVotes: [true, false],
      reason: "ok",
      review: undefined,
    })
  })

  it("preserves start/end/code/findVotes on inconsistent", () => {
    const a = ann({ start: 5, end: 8, code: "callout-z", findVotes: [true, false] })
    const out = applyVerdict(a, { judgment: "inconsistent", reason: "law unclear" })
    expect(out).toEqual({
      start: 5,
      end: 8,
      code: "callout-z",
      findVotes: [true, false],
      reason: "law unclear",
      review: "law unclear",
    })
  })

  it("unknown judgment throws", () => {
    expect(() =>
      applyVerdict(ann(), { judgment: "bogus" as Verdict["judgment"], reason: "" })
    ).toThrow(/unknown adjudicate judgment/)
  })
})
