import { getEmbeddingsDimensions } from "./env"

export const zeroVector = (): number[] => new Array<number>(getEmbeddingsDimensions()).fill(0)
