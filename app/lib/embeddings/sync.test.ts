import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { readCorpusDocument } from "~/lib/text/fixtures/corpus"
import type { FileStore } from "~/lib/files/store"
import { ok } from "~/lib/fp/result"
import { bm25DocId, ownedIdsForFile, resetBm25 } from "~/lib/search/bm25/store"
import { startBm25Sync } from "~/lib/search/bm25/sync"
import { proseOf } from "~/lib/text/halo"
import { chunkFileForEmbedding, type Chunk } from "./chunk"
import { buildCompanionMarkdown, companionFilename, parseCompanionEntries } from "./companion"
import { EMBEDDING_SYNC_DEBOUNCE } from "./constants"
import type { EmbeddingEntry } from "./diff"
import { getEmbeddingsDimensions } from "./env"
import { hashChunk } from "./hash"
import { startEmbeddingSync, type EmbeddingSyncDeps } from "./sync"

const DOC = "notes.md"
const COMPANION = companionFilename(DOC)
const LANGUAGE = "eng"

const BM25_SETTLE = 1000

const fixture = readCorpusDocument

const vectorStamped = (stamp: number): number[] =>
  Array.from({ length: getEmbeddingsDimensions() }, (_, i) => (i === 0 ? stamp : 0))

const createProject = (initial: Record<string, string>) => {
  let files: FileStore = { ...initial }
  const listeners = new Set<() => void>()

  let requests: string[][] = []
  let writes: string[] = []
  let issued = 0

  const deps: EmbeddingSyncDeps = {
    getFiles: () => files,
    getFile: (name) => files[name],
    updateFile: (name, content) => {
      files = { ...files, [name]: content }
      writes.push(name)
    },
    deleteFile: (name) => {
      const { [name]: _removed, ...rest } = files
      files = rest
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    embeddingsUrl: "http://embeddings.test",
    fetchBatch: (texts) => {
      requests.push(texts)
      return Promise.resolve(ok(texts.map(() => vectorStamped(++issued))))
    },
  }

  return {
    deps,
    fileAt: (name: string) => files[name],
    setFile: (name: string, content: string) => {
      files = { ...files, [name]: content }
    },
    notify: () => listeners.forEach((listener) => listener()),
    requested: () => requests.flat(),
    written: () => writes,
    forget: () => {
      requests = []
      writes = []
    },
    bm25Deps: {
      getFiles: () => files,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }
}

type Project = ReturnType<typeof createProject>

const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(EMBEDDING_SYNC_DEBOUNCE)
  await vi.advanceTimersByTimeAsync(BM25_SETTLE)
}

const entriesIn = (project: Project): EmbeddingEntry[] =>
  parseCompanionEntries(project.fileAt(COMPANION) ?? "")

const hashesOf = (items: { hash: string }[]): Set<string> => new Set(items.map((i) => i.hash))

const idsOf = (items: { chunkStart: number }[]): Set<string> =>
  new Set(items.map((i) => bm25DocId(DOC, i.chunkStart)))

const byHash = (entries: EmbeddingEntry[]): Map<string, EmbeddingEntry> =>
  new Map(entries.map((e) => [e.hash, e]))

const insertSentenceInFirstUnit = (content: string): string => {
  const paragraph = content.indexOf("\n\n") + 2
  return `${content.slice(0, paragraph)}A newly inserted opening sentence sits at the head. ${content.slice(paragraph)}`
}

const OLD_WINDOW_CHARS = 1000

const entriesFromCountedWindows = (content: string): EmbeddingEntry[] => {
  const prose = proseOf(content)
  const entries: EmbeddingEntry[] = []
  for (let start = 0; start < prose.length; start += OLD_WINDOW_CHARS) {
    const text = prose.slice(start, start + OLD_WINDOW_CHARS)
    entries.push({
      hash: hashChunk(text),
      text,
      embedding: vectorStamped(0),
      chunkStart: start,
      chunkEnd: start + text.length,
      language: LANGUAGE,
    })
  }
  return entries
}

const changedChunks = (before: Chunk[], after: Chunk[]): Chunk[] => {
  const known = new Set(before.map((c) => c.text))
  return after.filter((c) => !known.has(c.text))
}

let errors: string[] = []

beforeEach(() => {
  vi.useFakeTimers()
  resetBm25()
  errors = []
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "))
  })
})

afterEach(() => {
  expect(errors).toEqual([])
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("an edit confined to the first unit", () => {
  const original = fixture("links-and-code.md")
  const edited = insertSentenceInFirstUnit(original)

  it("requests only the chunks whose text changed and keeps the rest with their vectors", async () => {
    const project = createProject({ [DOC]: original })
    await startEmbeddingSync(project.deps).ready

    const before = chunkFileForEmbedding(original)
    const stored = byHash(entriesIn(project))
    expect(hashesOf([...stored.values()])).toEqual(hashesOf(before))

    project.forget()
    project.setFile(DOC, edited)
    project.notify()
    await settle()

    const after = chunkFileForEmbedding(edited)
    const changed = changedChunks(before, after)
    expect(project.requested()).toEqual(changed.map((c) => c.text))
    expect(changed.length).toBeLessThan(after.length / 2)

    const rewritten = byHash(entriesIn(project))
    expect(hashesOf([...rewritten.values()])).toEqual(hashesOf(after))

    const kept = after.filter((c) => stored.has(c.hash))
    expect(kept.length).toBeGreaterThan(0)
    for (const chunk of kept) {
      expect(rewritten.get(chunk.hash)?.embedding).toEqual(stored.get(chunk.hash)?.embedding)
      expect(rewritten.get(chunk.hash)?.chunkStart).toBe(chunk.chunkStart)
    }
  })
})

describe("a companion written under the old boundary rule", () => {
  const content = fixture("links-and-code.md")
  const old = entriesFromCountedWindows(content)

  it("re-embeds every chunk and leaves no entry from the old run", async () => {
    const project = createProject({ [DOC]: content, [COMPANION]: buildCompanionMarkdown(old) })
    await startEmbeddingSync(project.deps).ready

    const chunks = chunkFileForEmbedding(content)
    expect(project.requested()).toEqual(chunks.map((c) => c.text))

    const rewritten = entriesIn(project)
    expect(hashesOf(rewritten)).toEqual(hashesOf(chunks))
    for (const entry of old) expect(rewritten.some((e) => e.hash === entry.hash)).toBe(false)
  })

  it("has the BM25 index replace that source's documents", async () => {
    const project = createProject({ [DOC]: content, [COMPANION]: buildCompanionMarkdown(old) })
    startBm25Sync(project.bm25Deps)
    expect(ownedIdsForFile(LANGUAGE, DOC)).toEqual(idsOf(old))

    await startEmbeddingSync(project.deps).ready
    project.notify()
    await settle()

    expect(ownedIdsForFile(LANGUAGE, DOC)).toEqual(idsOf(chunkFileForEmbedding(content)))
  })
})

describe("an edit that changes no chunk", () => {
  it("makes no request when a fenced code block is edited", async () => {
    const original = fixture("mostly-code.md")
    const project = createProject({ [DOC]: original })
    await startEmbeddingSync(project.deps).ready
    expect(project.requested().length).toBeGreaterThan(0)

    const edited = original.replace("const step7 = compute(7)", "const step7 = compute(70007)")
    expect(edited).not.toBe(original)

    project.forget()
    project.setFile(DOC, edited)
    project.notify()
    await settle()

    expect(hashesOf(chunkFileForEmbedding(edited))).toEqual(
      hashesOf(chunkFileForEmbedding(original))
    )
    expect(project.requested()).toEqual([])
    expect(project.written()).toEqual([])
  })

  it("makes no request for a document with no prose to chunk", async () => {
    const project = createProject({ [DOC]: "```ts\nconst a = 1\n```" })
    await startEmbeddingSync(project.deps).ready

    expect(project.requested()).toEqual([])
    expect(project.written()).toEqual([])
    expect(project.fileAt(COMPANION)).toBeUndefined()
  })
})

describe("a file edited down to nothing an embedding could cover", () => {
  it("loses its companion rather than keeping entries for chunks that are gone", async () => {
    const project = createProject({ [DOC]: fixture("links-and-code.md") })
    await startEmbeddingSync(project.deps).ready
    expect(entriesIn(project).length).toBeGreaterThan(0)

    project.setFile(DOC, "```ts\nconst a = 1\n```")
    project.notify()
    await settle()

    expect(project.fileAt(COMPANION)).toBeUndefined()
  })

  it("drops the entries whose chunks are gone when the rest still match", async () => {
    const content = fixture("links-and-code.md")
    const project = createProject({ [DOC]: content })
    await startEmbeddingSync(project.deps).ready

    const before = entriesIn(project)
    expect(before.length).toBeGreaterThan(2)

    const half = content.slice(0, content.lastIndexOf("\n\n", content.length / 2))
    project.setFile(DOC, half)
    project.forget()
    project.notify()
    await settle()

    const after = entriesIn(project)
    expect(after.length).toBeLessThan(before.length)
    expect(after).toEqual(
      chunkFileForEmbedding(half).map((chunk) => expect.objectContaining({ hash: chunk.hash }))
    )
  })
})

describe("a provider answering with fewer vectors than the batch it was sent", () => {
  it("writes no entry without a vector and leaves the chunks to the next pass", async () => {
    const content = fixture("links-and-code.md")
    let short = true
    const project = createProject({ [DOC]: content })
    const deps: EmbeddingSyncDeps = {
      ...project.deps,
      fetchBatch: (texts) => {
        const answered = short ? texts.slice(0, -1) : texts
        short = false
        return Promise.resolve(ok(answered.map(() => vectorStamped(1))))
      },
    }

    await startEmbeddingSync(deps).ready
    expect(project.fileAt(COMPANION)).toBeUndefined()
    expect(errors).toEqual([expect.stringContaining("provider answered")])
    errors = []

    project.setFile(DOC, `${content}\n\nOne more sentence to make the file dirty.`)
    project.notify()
    await settle()

    const entries = entriesIn(project)
    expect(entries).toHaveLength(chunkFileForEmbedding(project.fileAt(DOC) ?? "").length)
    for (const entry of entries) expect(Array.isArray(entry.embedding)).toBe(true)
  })
})
