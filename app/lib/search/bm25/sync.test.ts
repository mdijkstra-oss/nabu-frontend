import { beforeEach, describe, expect, it } from "vitest"
import { startBm25Sync } from "./sync"
import { queryBm25, resetBm25, languageStats } from "./store"
import { buildCompanionMarkdown, companionFilename } from "~/lib/embeddings/companion"
import type { EmbeddingEntry } from "~/lib/embeddings/diff"

const buildEntry = (overrides: Partial<EmbeddingEntry> = {}): EmbeddingEntry => ({
  hash: "h1",
  text: "the quick brown fox",
  embedding: [0.1, 0.2],
  chunkStart: 0,
  chunkEnd: 19,
  language: "eng",
  ...overrides,
})

interface MockFileStore {
  files: Record<string, string>
  listeners: Set<() => void>
  getFiles: () => Record<string, string>
  subscribe: (listener: () => void) => () => void
  setFile: (name: string, content: string) => void
  deleteFile: (name: string) => void
  notify: () => void
}

const buildMockStore = (): MockFileStore => {
  const store: MockFileStore = {
    files: {},
    listeners: new Set(),
    getFiles: () => store.files,
    subscribe: (listener) => {
      store.listeners.add(listener)
      return () => store.listeners.delete(listener)
    },
    setFile: (name, content) => {
      store.files = { ...store.files, [name]: content }
    },
    deleteFile: (name) => {
      const { [name]: _removed, ...next } = store.files
      store.files = next
    },
    notify: () => {
      for (const l of store.listeners) l()
    },
  }
  return store
}

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 250))
}

describe("bm25 sync", () => {
  beforeEach(() => resetBm25())

  it("indexes companion file on startup", async () => {
    const store = buildMockStore()
    const companion = companionFilename("doc.md")
    store.setFile(companion, buildCompanionMarkdown([buildEntry({ text: "fox" })]))

    startBm25Sync(store)

    expect(queryBm25("eng", "fox", 10)).toHaveLength(1)
    expect(queryBm25("eng", "fox", 10)[0].file).toBe("doc.md")
  })

  it("updates index when companion file changes", async () => {
    const store = buildMockStore()
    const companion = companionFilename("doc.md")
    store.setFile(companion, buildCompanionMarkdown([buildEntry({ text: "fox" })]))

    startBm25Sync(store)
    expect(queryBm25("eng", "fox", 10)).toHaveLength(1)

    store.setFile(companion, buildCompanionMarkdown([buildEntry({ hash: "h2", text: "lazy dog" })]))
    store.notify()
    await flush()

    expect(queryBm25("eng", "fox", 10)).toHaveLength(0)
    expect(queryBm25("eng", "dog", 10)).toHaveLength(1)
  })

  it("clears index when companion file removed", async () => {
    const store = buildMockStore()
    const companion = companionFilename("doc.md")
    store.setFile(companion, buildCompanionMarkdown([buildEntry({ text: "fox" })]))

    startBm25Sync(store)
    expect(queryBm25("eng", "fox", 10)).toHaveLength(1)

    store.deleteFile(companion)
    store.notify()
    await flush()

    expect(queryBm25("eng", "fox", 10)).toHaveLength(0)
  })

  it("separates docs by language", async () => {
    const store = buildMockStore()
    store.setFile(
      companionFilename("a.md"),
      buildCompanionMarkdown([
        buildEntry({ hash: "h1", text: "english fox", language: "eng" }),
        buildEntry({ hash: "h2", text: "nederlandse vos", language: "nld" }),
      ])
    )

    startBm25Sync(store)

    expect(queryBm25("eng", "fox", 10)).toHaveLength(1)
    expect(queryBm25("nld", "vos", 10)).toHaveLength(1)
    expect(queryBm25("nld", "fox", 10)).toHaveLength(0)
  })

  it("skips entries without language", async () => {
    const store = buildMockStore()
    store.setFile(
      companionFilename("a.md"),
      buildCompanionMarkdown([buildEntry({ text: "fox", language: undefined })])
    )

    startBm25Sync(store)

    expect(languageStats()).toEqual({})
  })
})
