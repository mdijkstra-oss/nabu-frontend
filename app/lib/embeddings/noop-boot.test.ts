import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { readCorpusDocument } from "~/lib/text/fixtures/corpus"
import type { FileStore } from "~/lib/files/store"
import { ok } from "~/lib/fp/result"
import { startEngine } from "~/lib/engine/engine"
import type { EngineDeps } from "~/lib/engine/types"
import { chunkFileForEmbedding, type Chunk } from "./chunk"
import { buildCompanionMarkdown, companionFilename } from "./companion"
import type { EmbeddingEntry } from "./diff"
import { zeroVector } from "./embedding.fixtures"

const DOC = "notes.md"

const toStoredEntry = (chunk: Chunk): EmbeddingEntry => ({
  hash: chunk.hash,
  text: chunk.text,
  embedding: zeroVector(),
  chunkStart: chunk.chunkStart,
  chunkEnd: chunk.chunkEnd,
  language: "eng",
})

const currentCompanionFor = (content: string): string =>
  buildCompanionMarkdown(chunkFileForEmbedding(content).map(toStoredEntry))

let errors: string[] = []

beforeEach(() => {
  errors = []
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "))
  })
})

afterEach(() => {
  expect(errors).toEqual([])
  vi.restoreAllMocks()
})

describe("a boot over an already-embedded project", () => {
  it("requests no embedding and writes no companion on the first pass", async () => {
    const content = readCorpusDocument("links-and-code.md")
    expect(chunkFileForEmbedding(content).length).toBeGreaterThan(0)

    const companion = currentCompanionFor(content)
    let files: FileStore = { [DOC]: content, [companionFilename(DOC)]: companion }
    const requests: string[][] = []
    const writes: string[] = []

    const deps: EngineDeps = {
      getFiles: () => files,
      getFile: (name) => files[name],
      updateFile: (name, next) => {
        files = { ...files, [name]: next }
        writes.push(name)
      },
      deleteFile: (name) => {
        const { [name]: _removed, ...rest } = files
        files = rest
        writes.push(name)
      },
      subscribe: () => () => undefined,
      embeddingsUrl: "http://embeddings.test",
      fetchBatch: (texts) => {
        requests.push(texts)
        return Promise.resolve(ok([]))
      },
      classify: () => Promise.resolve(null),
      getKinds: () => [],
      detect: { find: () => Promise.resolve({ unrecorded: [] }), mark: () => Promise.resolve() },
      writeRegions: () => "unchanged",
      getSignificantLanguages: () => Promise.resolve([]),
      syncDescriptions: () => Promise.resolve(),
      onEvent: () => undefined,
    }

    const engine = startEngine(deps)
    await engine.ready
    engine.stop()

    expect(requests).toEqual([])
    expect(writes).toEqual([])
    expect(files[companionFilename(DOC)]).toBe(companion)
  })
})
