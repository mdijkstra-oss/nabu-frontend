import { callLlm } from "~/lib/agent/client/fetch"
import { extractText, toSystem } from "~/lib/agent/client/convert"
import type { CorpusDescription } from "~/domain/corpus/types"

const HYDE_GENERATOR_ENDPOINT = "/hyde-generator"
const GENERIC_HYDE_ENDPOINT = "/generic-hyde"
const EXPECTED_HYDE_COUNT = 3
const SEPARATOR = "---"

const formatCallToAction = (language: string): string =>
  `Generate the 3 passages now in ${language}. Separate with ---`

const parseHydes = (text: string): string[] =>
  text
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

export const generateHydesForDescription = async (
  description: CorpusDescription,
  query: string
): Promise<string[]> => {
  const blocks = await callLlm({
    endpoint: HYDE_GENERATOR_ENDPOINT,
    messages: [
      toSystem(`[${description.corpus}] ${description.description}`),
      toSystem(`language: ${description.language}\nquery: ${query}`),
      toSystem(formatCallToAction(description.language)),
    ],
  })

  const text = extractText(blocks)
  if (!text) throw new Error("HyDE generator returned empty response")

  const hydes = parseHydes(text)
  if (hydes.length !== EXPECTED_HYDE_COUNT)
    throw new Error(
      `HyDE generator returned ${hydes.length} passages, expected ${EXPECTED_HYDE_COUNT}`
    )

  return hydes
}

export const generateGenericHydes = async (language: string, query: string): Promise<string[]> => {
  const blocks = await callLlm({
    endpoint: GENERIC_HYDE_ENDPOINT,
    messages: [
      toSystem(`language: ${language}\nquery: ${query}`),
      toSystem(formatCallToAction(language)),
    ],
  })

  const text = extractText(blocks)
  if (!text) throw new Error("Generic HyDE generator returned empty response")

  const hydes = parseHydes(text)
  if (hydes.length !== EXPECTED_HYDE_COUNT)
    throw new Error(
      `Generic HyDE generator returned ${hydes.length} passages, expected ${EXPECTED_HYDE_COUNT}`
    )

  return hydes
}
