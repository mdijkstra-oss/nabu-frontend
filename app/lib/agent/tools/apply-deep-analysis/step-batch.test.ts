import { describe, it, expect } from "vitest"
import { batchByCode } from "./step-batch"
import type { Annotation } from "./types"

const ann = (code: string, start: number): Annotation => ({
  start,
  end: start,
  code,
  findVotes: [],
  reason: "",
})

describe("batchByCode", () => {
  const cases = [
    {
      name: "single code exceeds max — splits into multiple batches",
      annotations: Array.from({ length: 5 }, (_, i) => ann("a", i + 1)),
      maxSize: 3,
      check: (batches: Annotation[][]) => {
        expect(batches).toHaveLength(2)
        expect(batches[0]).toHaveLength(3)
        expect(batches[1]).toHaveLength(2)
        expect(batches[0].every((a) => a.code === "a")).toBe(true)
      },
    },
    {
      name: "small codes combine into one batch",
      annotations: [ann("a", 1), ann("b", 2), ann("c", 3)],
      maxSize: 5,
      check: (batches: Annotation[][]) => {
        expect(batches).toHaveLength(1)
        expect(batches[0]).toHaveLength(3)
      },
    },
    {
      name: "largest code fills its own batch, smaller codes combine",
      annotations: [
        ...Array.from({ length: 4 }, (_, i) => ann("big", i + 1)),
        ann("small1", 10),
        ann("small2", 11),
      ],
      maxSize: 4,
      check: (batches: Annotation[][]) => {
        expect(batches).toHaveLength(2)
        expect(batches[0].every((a) => a.code === "big")).toBe(true)
        expect(batches[0]).toHaveLength(4)
        expect(batches[1]).toHaveLength(2)
      },
    },
    {
      name: "codes sorted by count — largest first",
      annotations: [ann("few", 1), ...Array.from({ length: 3 }, (_, i) => ann("many", i + 10))],
      maxSize: 3,
      check: (batches: Annotation[][]) => {
        expect(batches).toHaveLength(2)
        expect(batches[0].every((a) => a.code === "many")).toBe(true)
        expect(batches[1][0].code).toBe("few")
      },
    },
    {
      name: "empty input returns empty",
      annotations: [],
      maxSize: 10,
      check: (batches: Annotation[][]) => {
        expect(batches).toHaveLength(0)
      },
    },
    {
      name: "partial fill from large code combines with smaller",
      annotations: [
        ...Array.from({ length: 7 }, (_, i) => ann("big", i + 1)),
        ...Array.from({ length: 2 }, (_, i) => ann("small", i + 20)),
      ],
      maxSize: 5,
      check: (batches: Annotation[][]) => {
        expect(batches).toHaveLength(2)
        expect(batches[0]).toHaveLength(5)
        expect(batches[0].every((a) => a.code === "big")).toBe(true)
        expect(batches[1]).toHaveLength(4)
      },
    },
  ]

  cases.forEach(({ name, annotations, maxSize, check }) => {
    it(name, () => check(batchByCode(annotations, maxSize)))
  })
})
