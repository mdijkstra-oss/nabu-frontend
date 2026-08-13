import { callLlm } from "~/lib/agent/client/fetch"
import { extractText, toSystem, toUser } from "~/lib/agent/client/convert"
import { fnvHash } from "~/lib/utils/hash"
import type { CorpusDescription } from "~/domain/corpus/types"

const ENDPOINT = "/corpus-describer"
const MIN_WORDS_FOR_LLM = 500

const wordCount = (texts: string[]): number =>
  texts.reduce((sum, t) => sum + t.split(/\s+/).length, 0)

const formatSamples = (samples: string[]): string =>
  samples.map((s, i) => `[${i + 1}] ${s}`).join("\n\n")

const callToAction = (language: string): string =>
  `Describe this corpus in 2-3 sentences. Cover what the content is about, its typical structure, and its tone or register. Write in '${language}'.`

const buildDescription = async (
  samples: string[],
  language: string,
  corpus: string
): Promise<string> => {
  const blocks = await callLlm({
    endpoint: ENDPOINT,
    messages: [
      toSystem(`corpus: ${corpus}\nlanguage: ${language}`),
      toUser(formatSamples(samples)),
      toUser(callToAction(language)),
    ],
  })

  const text = extractText(blocks)
  if (!text) throw new Error(`[corpus-describe] empty LLM response for ${corpus}/${language}`)

  return text.trim()
}

export const describeGroup = async (
  samples: string[],
  language: string,
  corpus: string
): Promise<CorpusDescription> => {
  const isBelowThreshold = wordCount(samples) < MIN_WORDS_FOR_LLM
  const description = isBelowThreshold
    ? samples.join(" ")
    : await buildDescription(samples, language, corpus)

  return {
    language,
    corpus,
    description,
    hash: fnvHash(description),
  }
}
