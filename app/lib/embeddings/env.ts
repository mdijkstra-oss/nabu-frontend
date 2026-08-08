import { getEnv } from "~/lib/utils/env"

// The full endpoint URL; a `/`-prefixed value is root-relative to the page
// origin. A trailing `/` there would miss the proxy's exact route and land in
// the SPA fallback, so one is stripped.
export const getEmbeddingsUrl = (): string => {
  const url = getEnv("VITE_EMBEDDINGS_URL", "http://localhost:8082/embeddings")
  return url.startsWith("/") && url.endsWith("/") ? url.slice(0, -1) : url
}

export const getEmbeddingsModel = (): string =>
  getEnv("VITE_EMBEDDINGS_MODEL", "text-embedding-3-large")

// WHY a width and not the model's own: every vector in a companion file was
// written at this one, and diffChunks reuses an entry on chunk hash alone. A
// change here is only safe with the companions deleted.
export const getEmbeddingsDimensions = (): number =>
  Number(getEnv("VITE_EMBEDDINGS_DIMENSIONS", "1024"))
