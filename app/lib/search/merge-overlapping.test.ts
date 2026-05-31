import { describe, it, expect } from "vitest"
import { mergeOverlappingHits } from "./merge-overlapping"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"

const hit = (file: string, text: string, score = 0.5): SearchHit => ({ file, text, score })

const cases: {
  name: string
  hits: SearchHit[]
  files: FileStore
  expected: SearchHit[]
}[] = [
  {
    name: "passes through single hit unchanged",
    hits: [hit("a.md", "hello world")],
    files: { "a.md": "hello world" },
    expected: [hit("a.md", "hello world")],
  },
  {
    name: "passes through non-overlapping same-file hits in order",
    hits: [hit("a.md", "alpha", 0.9), hit("a.md", "beta", 0.5)],
    files: { "a.md": "alpha. something in between. beta." },
    expected: [hit("a.md", "alpha", 0.9), hit("a.md", "beta", 0.5)],
  },
  {
    name: "merges overlapping same-file hits, keeps best score at winner position",
    hits: [
      hit("a.md", "sentence one. sentence two.", 0.9),
      hit("a.md", "sentence two. sentence three.", 0.6),
    ],
    files: { "a.md": "sentence one. sentence two. sentence three." },
    expected: [hit("a.md", "sentence one. sentence two. sentence three.", 0.9)],
  },
  {
    name: "absorbed hit removed from its position",
    hits: [
      hit("a.md", "first chunk", 0.9),
      hit("b.md", "different file", 0.8),
      hit("a.md", "first chunk end. second chunk", 0.7),
    ],
    files: {
      "a.md": "first chunk end. second chunk more.",
      "b.md": "different file content.",
    },
    expected: [
      hit("a.md", "first chunk end. second chunk", 0.9),
      hit("b.md", "different file", 0.8),
    ],
  },
  {
    name: "chains three overlapping chunks into one",
    hits: [hit("a.md", "A. B.", 0.9), hit("a.md", "B. C.", 0.5), hit("a.md", "C. D.", 0.3)],
    files: { "a.md": "A. B. C. D." },
    expected: [hit("a.md", "A. B. C. D.", 0.9)],
  },
  {
    name: "lower-scored hit absorbs higher-scored overlapping hit behind it",
    hits: [
      hit("a.md", "overlap region. unique A.", 0.5),
      hit("a.md", "unique B. overlap region.", 0.9),
    ],
    files: { "a.md": "unique B. overlap region. unique A." },
    expected: [hit("a.md", "unique B. overlap region. unique A.", 0.9)],
  },
  {
    name: "hits without text pass through",
    hits: [{ file: "a.md", score: 0.5 }, hit("a.md", "hello", 0.3)],
    files: { "a.md": "hello world" },
    expected: [{ file: "a.md", score: 0.5 }, hit("a.md", "hello", 0.3)],
  },
  {
    name: "hits for missing files pass through",
    hits: [hit("gone.md", "hello", 0.5)],
    files: {},
    expected: [hit("gone.md", "hello", 0.5)],
  },
  {
    name: "different files never merge",
    hits: [hit("a.md", "same text", 0.9), hit("b.md", "same text", 0.5)],
    files: { "a.md": "same text here.", "b.md": "same text here." },
    expected: [hit("a.md", "same text", 0.9), hit("b.md", "same text", 0.5)],
  },
  {
    name: "preserves order of non-overlapping hits between merged ones",
    hits: [
      hit("a.md", "first part. overlap.", 0.9),
      hit("b.md", "unrelated", 0.85),
      hit("c.md", "also unrelated", 0.8),
      hit("a.md", "overlap. second part.", 0.7),
    ],
    files: {
      "a.md": "first part. overlap. second part.",
      "b.md": "unrelated content.",
      "c.md": "also unrelated content.",
    },
    expected: [
      hit("a.md", "first part. overlap. second part.", 0.9),
      hit("b.md", "unrelated", 0.85),
      hit("c.md", "also unrelated", 0.8),
    ],
  },
]

describe("mergeOverlappingHits", () => {
  it.each(cases)("$name", ({ hits, files, expected }) => {
    expect(mergeOverlappingHits(hits, files)).toEqual(expected)
  })
})
