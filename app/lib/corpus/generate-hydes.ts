import { z } from "zod"
import { callAndParse } from "~/lib/agent/client/call-parse"
import { toSystem } from "~/lib/agent/client/convert"
import { HydeListSchema, HYDE_COUNT } from "./hyde-schema"
import type { CorpusDescription } from "~/domain/corpus/types"

const HYDE_GENERATOR_ENDPOINT = "/hyde-generator"
const GENERIC_HYDE_ENDPOINT = "/generic-hyde"

const HydeResponseSchema = z.object({
  hydes: HydeListSchema,
})

interface HydeMessage { type: "message"; role: "system" | "user"; content: string }

const formatCallToAction = (language: string): string =>
  `Generate the ${HYDE_COUNT} passages now in ${language}. Return valid JSON only.`

const callHydeEndpoint = async (endpoint: string, messages: HydeMessage[]): Promise<string[]> => {
  const result = await callAndParse(endpoint, messages, HydeResponseSchema)
  if (!result.ok) throw new Error(`HyDE generation failed (${endpoint}): ${result.error}`)
  return result.data.hydes.map((h) => h.text)
}

export const generateHydesForDescription = async (
  description: CorpusDescription,
  query: string
): Promise<string[]> =>
  callHydeEndpoint(HYDE_GENERATOR_ENDPOINT, [
    toSystem(`[${description.corpus}] ${description.description}`),
    toSystem(`language: ${description.language}\nquery: ${query}`),
    toSystem(formatCallToAction(description.language)),
  ])

export const generateGenericHydes = async (language: string, query: string): Promise<string[]> =>
  callHydeEndpoint(GENERIC_HYDE_ENDPOINT, [
    toSystem(`language: ${language}\nquery: ${query}`),
    toSystem(formatCallToAction(language)),
  ])
