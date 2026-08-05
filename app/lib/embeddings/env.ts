import { getEnv } from "~/lib/utils/env"

export const getEmbeddingsHost = (): string =>
  getEnv("VITE_EMBEDDINGS_HOST", "http://localhost:8082")

export const getEmbeddingsModel = (): string =>
  getEnv("VITE_EMBEDDINGS_MODEL", "text-embedding-3-large")

// WHY a width and not the model's own: every vector in a companion file was
// written at this one, and diffChunks reuses an entry on chunk hash alone. A
// change here is only safe with the companions deleted.
export const getEmbeddingsDimensions = (): number =>
  Number(getEnv("VITE_EMBEDDINGS_DIMENSIONS", "1024"))
