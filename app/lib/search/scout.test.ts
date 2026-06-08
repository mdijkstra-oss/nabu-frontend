import { describe, it, expect } from "vitest"
import { buildChunkBlocks } from "./scout"

describe("buildChunkBlocks", () => {
  it("empty chunks yield empty blocks", () => {
    expect(buildChunkBlocks("hello", [])).toEqual([])
  })

  it("single chunk covers the whole content", () => {
    const content = "abcdef"
    const chunks = [{ index: 0, text: "abcdef", hash: "h", chunkStart: 0, chunkEnd: 6 }]
    expect(buildChunkBlocks(content, chunks)).toEqual([{ id: 1, chunkStart: 0, text: "abcdef" }])
  })

  it("consecutive chunks split at next chunkStart — no overlap, no gap", () => {
    const content = "0123456789ABCDEF"
    const chunks = [
      { index: 0, text: "0123456789", hash: "a", chunkStart: 0, chunkEnd: 10 },
      { index: 1, text: "6789ABCDEF", hash: "b", chunkStart: 6, chunkEnd: 16 },
    ]
    const blocks = buildChunkBlocks(content, chunks)
    expect(blocks).toEqual([
      { id: 1, chunkStart: 0, text: "012345" },
      { id: 2, chunkStart: 6, text: "6789ABCDEF" },
    ])
    expect(blocks.map((b) => b.text).join("")).toBe(content)
  })

  it("ids are 1-based, sequential", () => {
    const content = "aaabbbccc"
    const chunks = [
      { index: 0, text: "aaa", hash: "1", chunkStart: 0, chunkEnd: 3 },
      { index: 1, text: "bbb", hash: "2", chunkStart: 3, chunkEnd: 6 },
      { index: 2, text: "ccc", hash: "3", chunkStart: 6, chunkEnd: 9 },
    ]
    expect(buildChunkBlocks(content, chunks).map((b) => b.id)).toEqual([1, 2, 3])
  })
})
