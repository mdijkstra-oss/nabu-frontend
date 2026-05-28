import { callLlm } from "~/lib/agent/client/fetch"
import { extractText, toSystem, toUser } from "~/lib/agent/client/convert"
import { getFiles } from "~/lib/files/store"
import { PREFERENCES_FILE } from "~/lib/files/filename"

const INTENT_GENERATOR_ENDPOINT = "/intent-generator"

const CALL_TO_ACTION = "Write the search query now. Output only the query, nothing else."

const buildMessages = (input: string) => {
  const messages = []
  const preferences = getFiles()[PREFERENCES_FILE]
  if (preferences) messages.push(toSystem(`<preferences>\n${preferences}\n</preferences>`))
  messages.push(toUser(`<input>\n${input}\n</input>`))
  messages.push(toSystem(CALL_TO_ACTION))
  return messages
}

export const generateSearchIntent = async (input: string): Promise<string> => {
  const blocks = await callLlm({
    endpoint: INTENT_GENERATOR_ENDPOINT,
    messages: buildMessages(input),
  })

  const text = extractText(blocks)
  if (!text) throw new Error("Intent generator returned empty response")

  return text.trim()
}
