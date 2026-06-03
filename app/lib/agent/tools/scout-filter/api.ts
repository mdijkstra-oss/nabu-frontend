import type { Splitter } from "~/lib/text/types"
import { splitByParagraphs } from "~/lib/text/split"
import { callAndParse } from "../../client/call-parse"
import { ScoutFilterResponse, SCOUT_FILTER_ENDPOINT } from "./def"
import { numberParagraphs, buildScoutFilterMessages, type NumberedParagraph } from "./messages"

export interface FilterResult {
  surviving: NumberedParagraph[]
  excludedIndices: Set<number>
}

const expandRanges = (ranges: ScoutFilterResponse["exclude"]): Set<number> => {
  const set = new Set<number>()
  for (const { from, to } of ranges) {
    for (let i = from; i <= to; i++) set.add(i)
  }
  return set
}

export const filterTarget = async (
  framework: string,
  content: string,
  splitter: Splitter = splitByParagraphs
): Promise<FilterResult> => {
  const paragraphs = numberParagraphs(content, splitter)

  if (paragraphs.length === 0) {
    return { surviving: [], excludedIndices: new Set() }
  }

  const messages = buildScoutFilterMessages(framework, paragraphs)
  const result = await callAndParse(SCOUT_FILTER_ENDPOINT, messages, ScoutFilterResponse)

  if (!result.ok) {
    throw new Error(`scout-filter failed: ${result.error}`)
  }

  const excludedIndices = expandRanges(result.data.exclude)
  const surviving = paragraphs.filter((p) => !excludedIndices.has(p.index))

  return { surviving, excludedIndices }
}
