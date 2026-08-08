import { ok, err, type Result } from "~/lib/fp/result"
import { getLlmHeaders } from "~/lib/agent/env"
import { getEmbeddingsModel, getEmbeddingsDimensions } from "./env"

export interface EmbeddingError {
  type: "network" | "api"
  message: string
  status?: number
}

interface EmbeddingData {
  index: number
  embedding: number[]
}

interface EmbeddingsApiResponse {
  data: EmbeddingData[]
  usage: { total_tokens: number }
}

const buildRequestBody = (input: string[]): string =>
  JSON.stringify({
    input,
    model: getEmbeddingsModel(),
    dimensions: getEmbeddingsDimensions(),
  })

const sortByIndex = (data: EmbeddingData[]): number[][] =>
  data.sort((a, b) => a.index - b.index).map((d) => d.embedding)

export const fetchEmbeddingBatch = async (
  texts: string[],
  url: string
): Promise<Result<number[][], EmbeddingError>> => {
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: getLlmHeaders(),
      body: buildRequestBody(texts),
    })
  } catch (e) {
    return err({ type: "network", message: e instanceof Error ? e.message : String(e) })
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    return err({ type: "api", message: body, status: response.status })
  }

  const json = (await response.json()) as EmbeddingsApiResponse
  return ok(sortByIndex(json.data))
}
