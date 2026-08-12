import { callAndParse } from "~/lib/agent/client/call-parse"
import { errorMessage } from "~/lib/utils/error"
import type { KindDescriptor } from "~/lib/regions/kinds/registry"
import { gateResults } from "./hits"
import { buildFindMessages } from "./messages"
import { buildFindSchema } from "./schema"
import type { ParseCall } from "./seam"
import type { FindInput, FindOutcome, ScanUnit } from "./types"

export const FIND_ENDPOINT = "/region-finder"

export const toFindInput = (
  kind: KindDescriptor,
  unit: ScanUnit,
  knownValues: string[]
): FindInput => ({
  kind: kind.id,
  rules: kind.rules,
  knownValues,
  valueType: kind.valueType,
  firstSentence: unit.firstSentence,
  sentences: unit.sentences,
})

export const runFind = async (
  scan: FindInput,
  parse: ParseCall = callAndParse
): Promise<FindOutcome> => {
  try {
    const result = await parse(
      FIND_ENDPOINT,
      buildFindMessages(scan),
      buildFindSchema(scan.valueType)
    )
    if (!result.ok) return { hits: [], errors: [result.error], dropped: 0 }

    const { hits, dropped } = gateResults(scan, result.data.results)
    return { hits, errors: [], dropped }
  } catch (e) {
    return { hits: [], errors: [errorMessage(e)], dropped: 0 }
  }
}
