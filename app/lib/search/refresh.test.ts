import { describe, it, expect } from "vitest"
import { refreshHits, refreshHitsAsync } from "./refresh"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"

interface RefreshCase {
  name: string
  hits: SearchHit[]
  files: FileStore
  prevFiles?: FileStore
  expectedFiles: string[]
  expectedTexts?: (string | undefined)[]
  sameRef?: boolean
}

const cases: RefreshCase[] = [
  {
    name: "drops a hit whose file is gone",
    hits: [{ file: "a.md", id: "1abcdefg" }],
    files: {},
    expectedFiles: [],
  },
  {
    name: "drops an annotation hit whose id no longer appears in the file",
    hits: [{ file: "a.md", id: "1abcdefg", text: "old" }],
    files: { "a.md": "plain prose, no annotation here" },
    expectedFiles: [],
  },
  {
    name: "keeps an unchanged hit and preserves the array reference",
    hits: [{ file: "a.md", text: "hello" }],
    files: { "a.md": "hello world" },
    prevFiles: { "a.md": "hello world" },
    expectedFiles: ["a.md"],
    expectedTexts: ["hello"],
    sameRef: true,
  },
  {
    name: "re-slices a chunked hit when the file content changed",
    hits: [{ file: "a.md", text: "OLDXX", chunkStart: 0, chunkEnd: 5 }],
    files: { "a.md": "HELLO WORLD" },
    prevFiles: { "a.md": "OLD CONTENT" },
    expectedFiles: ["a.md"],
    expectedTexts: ["HELLO"],
    sameRef: false,
  },
  {
    name: "dedupes identical hits",
    hits: [
      { file: "a.md", text: "hello", chunkStart: 0, chunkEnd: 5 },
      { file: "a.md", text: "hello", chunkStart: 0, chunkEnd: 5 },
    ],
    files: { "a.md": "hello world" },
    prevFiles: { "a.md": "hello world" },
    expectedFiles: ["a.md"],
  },
]

const checkResult = (result: SearchHit[], c: RefreshCase): void => {
  expect(result.map((h) => h.file)).toEqual(c.expectedFiles)
  if (c.expectedTexts) expect(result.map((h) => h.text)).toEqual(c.expectedTexts)
  if (c.sameRef !== undefined) expect(result === c.hits).toBe(c.sameRef)
}

describe("refreshHits", () => {
  for (const c of cases) {
    it(c.name, () => checkResult(refreshHits(c.hits, c.files, c.prevFiles), c))
  }
})

describe("refreshHitsAsync", () => {
  for (const c of cases) {
    it(c.name, async () =>
      checkResult(await refreshHitsAsync(c.hits, c.files, () => false, c.prevFiles), c)
    )
  }
})
