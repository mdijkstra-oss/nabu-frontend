import { describe, it, expect, vi, afterEach } from "vitest"
import { fetchEmbeddingBatch } from "./client"

const emptyResponse = (): Response =>
  new Response(JSON.stringify({ data: [], usage: { total_tokens: 0 } }))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("fetchEmbeddingBatch", () => {
  const cases: { name: string; url: string }[] = [
    { name: "posts to a root-relative url untouched", url: "/embeddings" },
    { name: "posts to a full url untouched", url: "http://localhost:8082/embeddings" },
  ]

  it.each(cases)("$name", async ({ url }) => {
    const fetchMock = vi.fn().mockResolvedValue(emptyResponse())
    vi.stubGlobal("fetch", fetchMock)
    await fetchEmbeddingBatch(["text"], url)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe(url)
  })
})
