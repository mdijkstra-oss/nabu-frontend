import { describe, it, expect } from "vitest"
import { computeBestWindowScrollTop, type Position } from "./window-fit"

const row = (id: string, top: number, height = 40): Position => ({ id, top, height })

const positions: Position[] = [
  row("a", 0),
  row("b", 50),
  row("c", 100),
  row("d", 400),
  row("e", 450),
  row("f", 900),
  row("g", 1500),
]

const VIEWPORT = 300
const CONTENT = 2000

describe("computeBestWindowScrollTop", () => {
  const cases: {
    name: string
    selected: string[]
    viewport?: number
    content?: number
    expected: number | null
  }[] = [
    {
      name: "no selection returns null",
      selected: [],
      expected: null,
    },
    {
      name: "single selected centers it in viewport",
      selected: ["d"],
      expected: 400 - (300 - 40) / 2,
    },
    {
      name: "two close selected center their bbox",
      selected: ["d", "e"],
      expected: 400 - (300 - (450 + 40 - 400)) / 2,
    },
    {
      name: "two far selected pick topmost (one fits at a time)",
      selected: ["a", "g"],
      expected: 0,
    },
    {
      name: "three with dense pair beats lone outlier",
      selected: ["d", "e", "g"],
      expected: 400 - (300 - (450 + 40 - 400)) / 2,
    },
    {
      name: "cluster of three at top wins over pair below",
      selected: ["a", "b", "c", "d", "e"],
      expected: 0,
    },
    {
      name: "clamps to zero when target negative",
      selected: ["a"],
      expected: 0,
    },
    {
      name: "clamps to max when target exceeds maxScroll",
      selected: ["g"],
      content: 1600,
      expected: 1600 - 300,
    },
    {
      name: "ignores positions not in selected set",
      selected: ["zzz"],
      expected: null,
    },
    {
      name: "tiebreak picks topmost window",
      selected: ["a", "f"],
      expected: 0,
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      const result = computeBestWindowScrollTop(
        positions,
        new Set(c.selected),
        c.viewport ?? VIEWPORT,
        c.content ?? CONTENT
      )
      expect(result).toBe(c.expected)
    })
  }
})
