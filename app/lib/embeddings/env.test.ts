import { describe, it, expect, vi, afterEach } from "vitest"
import { getEmbeddingsUrl } from "./env"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("getEmbeddingsUrl", () => {
  const cases: { name: string; value: string | undefined; expected: string }[] = [
    {
      name: "unset falls through to the localhost default endpoint",
      value: undefined,
      expected: "http://localhost:8082/embeddings",
    },
    {
      name: "empty string falls through to the default, never same-origin",
      value: "",
      expected: "http://localhost:8082/embeddings",
    },
    {
      name: "root-relative value is used verbatim",
      value: "/embeddings",
      expected: "/embeddings",
    },
    {
      name: "trailing slash on a root-relative value is stripped",
      value: "/embeddings/",
      expected: "/embeddings",
    },
    {
      name: "full URL passes through byte-for-byte",
      value: "http://embeddings.internal:9000/embeddings",
      expected: "http://embeddings.internal:9000/embeddings",
    },
  ]

  it.each(cases)("$name", ({ value, expected }) => {
    vi.stubEnv("VITE_EMBEDDINGS_URL", value)
    expect(getEmbeddingsUrl()).toBe(expected)
  })
})
