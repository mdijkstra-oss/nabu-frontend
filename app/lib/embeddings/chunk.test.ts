import { describe, it, expect } from "vitest"
import { readCorpus } from "~/lib/text/fixtures/corpus"
import { getEmbeddableSource, sliceSource } from "~/lib/search/source"
import { chunkFileForEmbedding } from "./chunk"
import { hashChunk } from "./hash"

const documents = readCorpus().map(({ name, raw }) => ({ name, content: raw }))

const embeddableSource = (name: string, content: string): string => {
  const source = getEmbeddableSource(name, { [name]: content })
  if (source === null) throw new Error(`no embeddable source for ${name}`)
  return source
}

describe("chunkFileForEmbedding", () => {
  it("has fixtures to chunk", () => {
    expect(documents.length).toBeGreaterThan(0)
  })

  it.each(documents)(
    "$name: a chunk is its slice of the embeddable source",
    ({ name, content }) => {
      const source = embeddableSource(name, content)
      const chunks = chunkFileForEmbedding(content)
      expect(chunks.length).toBeGreaterThan(0)
      for (const chunk of chunks) {
        expect(sliceSource(source, chunk.chunkStart, chunk.chunkEnd)).toBe(chunk.text)
      }
    }
  )

  it.each(documents)("$name: a chunk's hash covers its own text", ({ content }) => {
    for (const chunk of chunkFileForEmbedding(content)) {
      expect(chunk.hash).toBe(hashChunk(chunk.text))
    }
  })

  it.each(documents)("$name: chunks are indexed in order from zero", ({ content }) => {
    const chunks = chunkFileForEmbedding(content)
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i))
    for (const [i, chunk] of chunks.slice(1).entries()) {
      expect(chunk.chunkStart).toBeGreaterThan(chunks[i].chunkStart)
    }
  })

  it("makes no chunk out of a document with no prose", () => {
    expect(chunkFileForEmbedding("")).toEqual([])
    expect(chunkFileForEmbedding("```ts\nconst a = 1\n```")).toEqual([])
  })
})
