import { callAndParse } from "../../client/call-parse"
import type { Entry } from "~/lib/calls/entry"
import { ScoutFilterResponse, SCOUT_FILTER_ENDPOINT } from "./def"
import { buildScoutFilterMessages } from "./messages"

// Ranges are model-authored: an unbounded "to" would loop the tab to death,
// so both ends clip to the call's entry ids before expanding.
const expandRanges = (ranges: ScoutFilterResponse["exclude"], entryCount: number): Set<number> => {
  const set = new Set<number>()
  for (const { from, to } of ranges) {
    for (let i = Math.max(1, from); i <= Math.min(to, entryCount); i++) set.add(i)
  }
  return set
}

export const filterEntries = async (
  framework: string,
  entries: readonly Entry<unknown>[],
  parse: typeof callAndParse = callAndParse
): Promise<Set<number>> => {
  if (entries.length === 0 || framework.length === 0) return new Set()

  const messages = buildScoutFilterMessages(framework, entries)
  const result = await parse(SCOUT_FILTER_ENDPOINT, messages, ScoutFilterResponse)
  if (!result.ok) throw new Error(`scout-filter failed: ${result.error}`)

  return expandRanges(result.data.exclude, entries.length)
}
