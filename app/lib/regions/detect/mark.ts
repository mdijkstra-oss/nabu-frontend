import { callAndParse } from "~/lib/agent/client/call-parse"
import { errorMessage } from "~/lib/utils/error"
import { buildMarkMessages } from "./messages"
import { repairRange, type RepairedRange } from "./repair"
import { markSchema } from "./schema"
import type { ParseCall } from "./seam"
import type { Mark, MarkInput, MarkOutcome, WindowedHit } from "./types"
import { sliceWindow } from "./window"

export const MARK_ENDPOINT = "/region-marker"

export const toMarkInput = (
  { hit, window }: WindowedHit,
  rules: string,
  sentences: string[]
): MarkInput => ({
  kind: hit.kind,
  rules,
  quote: hit.quote,
  hitSentence: hit.hitSentence,
  value: hit.value,
  windowStart: window.start,
  windowEnd: window.end,
  sentences: sliceWindow(sentences, window),
})

const toMark = (target: MarkInput, range: RepairedRange): Mark => ({
  kind: target.kind,
  quote: target.quote,
  hitSentence: target.hitSentence,
  value: target.value,
  ...range,
})

export const runMark = async (
  target: MarkInput,
  parse: ParseCall = callAndParse
): Promise<MarkOutcome> => {
  try {
    const result = await parse(MARK_ENDPOINT, buildMarkMessages(target), markSchema)
    if (!result.ok) return { mark: null, error: result.error }

    const [entry] = result.data.results
    if (!entry) return { mark: null, error: `no range returned for "${target.quote}"` }

    return { mark: toMark(target, repairRange(target, entry)) }
  } catch (e) {
    return { mark: null, error: errorMessage(e) }
  }
}
