import { describe, it, expect } from "vitest"
import { groupByCode } from "./step-batch"
import type { Annotation } from "./types"

const ann = (code: string, start: number): Annotation => ({
  start,
  end: start,
  code,
  findVotes: [],
  reason: "",
})

describe("groupByCode", () => {
  const cases = [
    {
      name: "empty input returns empty",
      annotations: [],
      check: (groups: Annotation[][]) => {
        expect(groups).toHaveLength(0)
      },
    },
    {
      name: "single code produces one group",
      annotations: Array.from({ length: 5 }, (_, i) => ann("a", i + 1)),
      check: (groups: Annotation[][]) => {
        expect(groups).toHaveLength(1)
        expect(groups[0]).toHaveLength(5)
        expect(groups[0].every((a) => a.code === "a")).toBe(true)
      },
    },
    {
      name: "multiple codes produce one group per code",
      annotations: [ann("a", 1), ann("b", 2), ann("a", 3), ann("c", 4), ann("b", 5)],
      check: (groups: Annotation[][]) => {
        expect(groups).toHaveLength(3)
        const codes = groups.map((g) => g[0].code)
        expect(codes).toContain("a")
        expect(codes).toContain("b")
        expect(codes).toContain("c")
        const findGroup = (code: string) => groups.find((g) => g[0].code === code)
        expect(findGroup("a")).toHaveLength(2)
        expect(findGroup("b")).toHaveLength(2)
        expect(findGroup("c")).toHaveLength(1)
      },
    },
    {
      name: "each group contains only its code",
      annotations: [ann("x", 1), ann("y", 2), ann("x", 3)],
      check: (groups: Annotation[][]) => {
        for (const group of groups) {
          const code = group[0].code
          expect(group.every((a) => a.code === code)).toBe(true)
        }
      },
    },
  ]

  cases.forEach(({ name, annotations, check }) => {
    it(name, () => check(groupByCode(annotations)))
  })
})
