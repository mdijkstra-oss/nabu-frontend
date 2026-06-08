import { callAndParse } from "../../client/call-parse"
import { ScoutFilterResponse, SCOUT_FILTER_ENDPOINT } from "./def"
import { buildScoutFilterMessages, type NumberedEntry } from "./messages"

const expandRanges = (ranges: ScoutFilterResponse["exclude"]): Set<number> => {
  const set = new Set<number>()
  for (const { from, to } of ranges) {
    for (let i = from; i <= to; i++) set.add(i)
  }
  return set
}

export const filterEntries = async (
  framework: string,
  entries: NumberedEntry[]
): Promise<Set<number>> => {
  if (entries.length === 0 || framework.length === 0) return new Set()

  const messages = buildScoutFilterMessages(framework, entries)
  const result = await callAndParse(SCOUT_FILTER_ENDPOINT, messages, ScoutFilterResponse)
  if (!result.ok) throw new Error(`scout-filter failed: ${result.error}`)

  return expandRanges(result.data.exclude)
}
